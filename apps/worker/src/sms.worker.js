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
const { debit } = require('../../api/src/services/wallet.service');
const { generateUnsubscribeToken } = require('../../api/src/services/token.service');

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
  const status = err?.status;
  if (!status) return true;      // network/timeout
  if (status >= 500) return true; // provider/server error
  if (status === 429) return true; // rate limited
  return false;                    // 4xx hard fail
}

const worker = new Worker(
  'smsQueue',
  async (job) => {
    const { messageId } = job.data;

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
      let finalText = msg.text;
      let needsUnsubscribeLink = !finalText.includes('/unsubscribe/');
      let needsOfferLink = !finalText.includes('/o/');

      if (needsUnsubscribeLink) {
        // Generate unsubscribe token if not present
        try {
          const unsubscribeToken = generateUnsubscribeToken(msg.contact.id, msg.campaign.ownerId, msg.campaign.id);
          const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${unsubscribeToken}`;
          finalText += `\n\nTo unsubscribe, tap: ${unsubscribeUrl}`;
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
          finalText += `\n\nView offer: ${offerUrl}`;
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
  },
  { connection, concurrency }
);

worker.on('ready', () => {
  logger.info('Ready and listening for jobs');
});

worker.on('active', (job) => {
  logger.info({ jobId: job.id, messageId: job.data.messageId }, `Processing ${job.name}`);
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
