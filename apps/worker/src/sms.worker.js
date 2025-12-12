// apps/worker/src/sms.worker.js
require('dotenv').config();

const pino = require('pino');
const logger = pino({ name: 'sms-worker' });

if (process.env.QUEUE_DISABLED === '1') {
  logger.warn('Disabled via QUEUE_DISABLED=1');
  process.exit(0);
}

// Dependencies are resolved from apps/api/node_modules because worker runs with cwd=apps/api
const { Worker } = require('bullmq');
const { getRedisClient } = require('../../api/src/lib/redis');
const prisma = require('../../api/src/lib/prisma');
const { sendSingle } = require('../../api/src/services/mitto.service');
const { sendBulkSMSWithCredits } = require('../../api/src/services/smsBulk.service');
const { debit } = require('../../api/src/services/wallet.service');
const { generateUnsubscribeToken } = require('../../api/src/services/token.service');
const { shortenUrl, shortenUrlsInText } = require('../../api/src/services/urlShortener.service');

// Helper function to ensure base URL includes /retail path
function ensureRetailPath(url) {
  if (!url) return url;
  const trimmed = url.trim().replace(/\/$/, ''); // Remove trailing slash
  // If URL doesn't end with /retail, add it
  if (!trimmed.endsWith('/retail')) {
    return `${trimmed}/retail`;
  }
  return trimmed;
}

// Base URL for unsubscribe links (from env or default)
const baseFrontendUrl = process.env.UNSUBSCRIBE_BASE_URL || process.env.FRONTEND_URL || 'https://astronote-retail-frontend.onrender.com';
const UNSUBSCRIBE_BASE_URL = ensureRetailPath(baseFrontendUrl);

const connection = getRedisClient();

if (!connection) {
  logger.warn('Redis client could not be created, SMS worker disabled');
  process.exit(0);
}

// With lazyConnect: true, Redis connects on first command
// BullMQ will handle the connection, so we don't need to wait for 'ready' here
// Just ensure we have a client instance
logger.info('Starting SMS worker (Redis will connect on first use)...');

const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);

function isRetryable(err) {
  // Check for rate limit errors from our rate limiter (Phase 2.1)
  if (err?.reason === 'rate_limit_exceeded' || 
      err?.message?.includes('rate limit exceeded')) {
    return true; // Retryable - transient condition
  }
  
  const status = err?.status;
  if (!status) return true;      // network/timeout
  if (status >= 500) return true; // provider/server error
  if (status === 429) return true; // rate limited (HTTP 429)
  return false;                    // 4xx hard fail
}

const worker = new Worker(
  'smsQueue',
  async (job) => {
    // Campaigns always use bulk SMS (sendBulkSMS job type)
    // Individual jobs (sendSMS) are only for automations and test messages
    if (job.name === 'sendBulkSMS') {
      // Process campaign batch job
      const { campaignId, ownerId, messageIds } = job.data;
      
      if (!campaignId || !ownerId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        logger.error({ jobId: job.id, data: job.data }, 'Invalid batch job data');
        return;
      }

      await processBatchJob(campaignId, ownerId, messageIds, job);
    } else if (job.name === 'sendSMS') {
      // Process individual job (for automations and test messages only)
    const { messageId } = job.data;
      await processIndividualJob(messageId, job);
    } else {
      logger.warn({ jobId: job.id, jobName: job.name }, 'Unknown job type, skipping');
    }
  },
  { connection, concurrency }
);

/**
 * Process individual message job (legacy)
 */
async function processIndividualJob(messageId, job) {
    const msg = await prisma.campaignMessage.findUnique({
      where: { id: messageId },
      include: {
        campaign: { select: { id: true, ownerId: true, createdById: true } },
        contact:  { select: { id: true, phone: true, unsubscribeTokenHash: true } }
      }
    });
    if (!msg) return;

    try {
      // Ensure unsubscribe link and offer link are present (safety check - should already be added in enqueue)
      let finalText = await shortenUrlsInText(msg.text); // Shorten any URLs in message
      let needsUnsubscribeLink = !finalText.includes('/unsubscribe/');
      let needsOfferLink = !finalText.includes('/o/');

      if (needsUnsubscribeLink) {
        // Generate unsubscribe token if not present
        try {
          const unsubscribeToken = generateUnsubscribeToken(msg.contact.id, msg.campaign.ownerId, msg.campaign.id);
          const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${unsubscribeToken}`;
          const shortenedUnsubscribeUrl = await shortenUrl(unsubscribeUrl);
          finalText += `\n\nTo unsubscribe, tap: ${shortenedUnsubscribeUrl}`;
          logger.warn({ messageId: msg.id }, 'Unsubscribe link was missing, appended before send');
        } catch (tokenErr) {
          logger.error({ messageId: msg.id, err: tokenErr.message }, 'Failed to generate unsubscribe token, sending without link');
          // Continue without unsubscribe link if token generation fails
        }
      }

      if (needsOfferLink && msg.trackingId) {
        // Generate offer link if not present (should already be there, but safety check)
        try {
          const baseOfferUrl = process.env.OFFER_BASE_URL || process.env.FRONTEND_URL || 'https://astronote-retail-frontend.onrender.com';
          const OFFER_BASE_URL = ensureRetailPath(baseOfferUrl);
          const offerUrl = `${OFFER_BASE_URL}/o/${msg.trackingId}`;
          const shortenedOfferUrl = await shortenUrl(offerUrl);
          finalText += `\n\nView offer: ${shortenedOfferUrl}`;
          logger.warn({ messageId: msg.id }, 'Offer link was missing, appended before send');
        } catch (err) {
          logger.error({ messageId: msg.id, err: err.message }, 'Failed to append offer link');
          // Continue without offer link if generation fails
        }
      }

      const resp = await sendSingle({
        userId: msg.campaign.createdById,
        destination: msg.to,
        text: finalText
      });

      // Response format: { messageId, trafficAccountId, rawResponse }
      const providerId = resp?.messageId || null;

      // Only debit credits AFTER successful send (when we have messageId)
      if (providerId) {
        try {
          await debit(msg.campaign.ownerId, 1, {
            reason: `sms:send:campaign:${msg.campaign.id}`,
            campaignId: msg.campaign.id,
            messageId: msg.id,
            meta: { providerMessageId: providerId }
          });
          logger.debug({ messageId: msg.id, ownerId: msg.campaign.ownerId }, 'Credits debited after successful send');
        } catch (debitErr) {
          // Log error but don't fail the message - it was already sent
          logger.error({ 
            messageId: msg.id, 
            ownerId: msg.campaign.ownerId, 
            err: debitErr.message 
          }, 'Failed to debit credits after successful send');
        }
      }

      await prisma.campaignMessage.update({
        where: { id: msg.id },
        data: {
          providerMessageId: providerId,
          sentAt: new Date(),
          status: 'sent'
        }
      });

      // Update campaign aggregates (non-blocking)
      try {
        const { updateCampaignAggregates } = require('../../api/src/services/campaignAggregates.service');
        await updateCampaignAggregates(msg.campaign.id, msg.campaign.ownerId);
      } catch (aggErr) {
        logger.warn({ campaignId: msg.campaign.id, err: aggErr.message }, 'Failed to update campaign aggregates');
      }
    } catch (e) {
      const retryable = isRetryable(e);
      logger.warn({ 
        messageId: msg.id, 
        campaignId: msg.campaign.id, 
        retryable, 
        err: e.message 
      }, 'SMS send failed');

      await prisma.campaignMessage.update({
        where: { id: msg.id },
        data: {
          failedAt: retryable ? null : new Date(),
          status: retryable ? 'queued' : 'failed',
          error: e.message
        }
      });

      // No credit refund needed - credits are only debited after successful send
      // If send failed, no credits were debited, so nothing to refund

      // Update campaign aggregates for failed message (non-blocking)
      try {
        const { updateCampaignAggregates } = require('../../api/src/services/campaignAggregates.service');
        await updateCampaignAggregates(msg.campaign.id, msg.campaign.ownerId);
      } catch (aggErr) {
        logger.warn({ campaignId: msg.campaign.id, err: aggErr.message }, 'Failed to update campaign aggregates');
      }

      if (retryable) throw e;
    }
}

/**
 * Process batch job (new bulk sending)
 */
async function processBatchJob(campaignId, ownerId, messageIds, job) {
  try {
    // Fetch all messages in batch
    // Idempotency check: Only process messages that haven't been sent yet
    const messages = await prisma.campaignMessage.findMany({
      where: {
        id: { in: messageIds },
        campaignId,
        ownerId,
        status: 'queued',
        providerMessageId: null  // Only process unsent messages
      },
      include: {
        campaign: { select: { id: true, ownerId: true, createdById: true } },
        contact: { select: { id: true, phone: true } }
      }
    });
    
    // Idempotency: Skip messages that were already sent (in case of retry)
    const alreadySent = messageIds.length - messages.length;
    if (alreadySent > 0) {
      logger.warn({ 
        campaignId, 
        ownerId, 
        alreadySent,
        totalRequested: messageIds.length 
      }, 'Some messages already sent, skipping (idempotency)');
    }

    if (messages.length === 0) {
      logger.warn({ campaignId, ownerId, messageIds }, 'No queued messages found for batch');
      return;
    }

    const startTime = Date.now();
    logger.info({ 
      campaignId, 
      ownerId, 
      batchSize: messages.length,
      requestedCount: messageIds.length,
      jobId: job.id,
      retryAttempt: job.attemptsMade || 0
    }, 'Processing batch job');

    // Prepare messages for bulk sending
    const bulkMessages = await Promise.all(messages.map(async (msg) => {
      // Ensure unsubscribe link and offer link are present
      let finalText = await shortenUrlsInText(msg.text); // Shorten any URLs in message
      let needsUnsubscribeLink = !finalText.includes('/unsubscribe/');
      let needsOfferLink = !finalText.includes('/o/');

      if (needsUnsubscribeLink) {
        try {
          const unsubscribeToken = generateUnsubscribeToken(msg.contact.id, msg.campaign.ownerId, msg.campaign.id);
          const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${unsubscribeToken}`;
          const shortenedUnsubscribeUrl = await shortenUrl(unsubscribeUrl);
          finalText += `\n\nTo unsubscribe, tap: ${shortenedUnsubscribeUrl}`;
        } catch (tokenErr) {
          logger.warn({ messageId: msg.id, err: tokenErr.message }, 'Failed to generate unsubscribe token');
        }
      }

      if (needsOfferLink && msg.trackingId) {
        try {
          const baseOfferUrl = process.env.OFFER_BASE_URL || process.env.FRONTEND_URL || 'https://astronote-retail-frontend.onrender.com';
          const OFFER_BASE_URL = ensureRetailPath(baseOfferUrl);
          const offerUrl = `${OFFER_BASE_URL}/o/${msg.trackingId}`;
          const shortenedOfferUrl = await shortenUrl(offerUrl);
          finalText += `\n\nView offer: ${shortenedOfferUrl}`;
        } catch (err) {
          logger.warn({ messageId: msg.id, err: err.message }, 'Failed to append offer link');
        }
      }

      return {
        ownerId: msg.campaign.ownerId,
        destination: msg.to,
        text: finalText,
        contactId: msg.contact.id,
        createdById: msg.campaign.createdById,
        internalMessageId: msg.id,
        meta: {
          reason: `sms:send:campaign:${msg.campaign.id}`,
          campaignId: msg.campaign.id,
          messageId: msg.id
        }
      };
    }));

    // Send bulk SMS
    const result = await sendBulkSMSWithCredits(bulkMessages);

    // Update messages with results
    const updatePromises = [];
    const successfulIds = [];
    const failedIds = [];

    for (const res of result.results) {
      const updateData = {
        updatedAt: new Date()
      };

      if (res.sent && res.messageId) {
        updateData.providerMessageId = res.messageId;
        updateData.bulkId = result.bulkId;
        updateData.sentAt = new Date();
        updateData.status = 'sent';
        updateData.error = null;
        successfulIds.push(res.internalMessageId);
      } else {
        updateData.status = 'failed';
        updateData.failedAt = new Date();
        updateData.error = res.error || res.reason || 'Send failed';
        failedIds.push(res.internalMessageId);
      }

      updatePromises.push(
        prisma.campaignMessage.update({
          where: { id: res.internalMessageId },
          data: updateData
        })
      );
    }

    await Promise.all(updatePromises);

    const duration = Date.now() - startTime;
    logger.info({ 
      campaignId, 
      ownerId,
      bulkId: result.bulkId,
      successful: successfulIds.length,
      failed: failedIds.length,
      total: result.results.length,
      duration,
      jobId: job.id,
      retryAttempt: job.attemptsMade || 0
    }, 'Batch job completed');

    // Update campaign aggregates (non-blocking)
    try {
      const { updateCampaignAggregates } = require('../../api/src/services/campaignAggregates.service');
      await updateCampaignAggregates(campaignId, ownerId);
    } catch (aggErr) {
      logger.warn({ campaignId, err: aggErr.message }, 'Failed to update campaign aggregates');
    }

    // If there were failures, log them but don't throw (partial success is acceptable)
    if (failedIds.length > 0) {
      logger.warn({ 
        campaignId, 
        failedCount: failedIds.length,
        failedIds: failedIds.slice(0, 10) // Log first 10 failed IDs
      }, 'Some messages in batch failed');
    }

  } catch (e) {
    const retryable = isRetryable(e);
    logger.error({ 
      campaignId, 
      ownerId, 
      messageIds,
      retryable, 
      err: e.message 
    }, 'Batch job failed');

      // Mark all messages in batch as failed or queued (for retry)
      // Increment retry count for idempotency tracking
      await prisma.campaignMessage.updateMany({
        where: {
          id: { in: messageIds },
          campaignId,
          ownerId,
          status: 'queued'  // Only update queued messages (idempotency)
        },
        data: {
          failedAt: retryable ? null : new Date(),
          status: retryable ? 'queued' : 'failed',
          error: e.message,
          retryCount: { increment: 1 }  // Track retry attempts
        }
      });

    // Update campaign aggregates
    try {
      const { updateCampaignAggregates } = require('../../api/src/services/campaignAggregates.service');
      await updateCampaignAggregates(campaignId, ownerId);
    } catch (aggErr) {
      logger.warn({ campaignId, err: aggErr.message }, 'Failed to update campaign aggregates');
    }

    if (retryable) throw e;
  }
}

worker.on('ready', () => {
  logger.info('Ready and listening for jobs');
});

worker.on('active', (job) => {
  if (job.name === 'sendBulkSMS') {
    logger.info({ jobId: job.id, campaignId: job.data.campaignId, messageCount: job.data.messageIds?.length }, `Processing ${job.name}`);
  } else {
  logger.info({ jobId: job.id, messageId: job.data.messageId }, `Processing ${job.name}`);
  }
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, `Completed ${job.name}`);
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err?.message }, `Failed ${job?.name}`);
});

worker.on('error', (err) => {
  logger.error({ err: err.message }, 'Worker error');
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing worker...');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
