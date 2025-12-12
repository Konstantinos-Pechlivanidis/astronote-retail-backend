// apps/api/src/services/campaignEnqueue.service.js
const prisma = require('../lib/prisma');
const { render } = require('../lib/template');
const { generateUnsubscribeToken } = require('./token.service');
const { shortenUrl, shortenUrlsInText } = require('./urlShortener.service');
const crypto = require('node:crypto');
const pino = require('pino');

const logger = pino({ name: 'campaign-enqueue-service' });

// Helper function to ensure base URL includes /retail path
function ensureRetailPath(url) {
  if (!url) {
    return url;
  }
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

// Base URL for offer links (from env or default)
const baseOfferUrl = process.env.OFFER_BASE_URL || process.env.FRONTEND_URL || 'https://astronote-retail-frontend.onrender.com';
const OFFER_BASE_URL = ensureRetailPath(baseOfferUrl);

function newTrackingId() {
  return crypto.randomBytes(9).toString('base64url');
}

exports.enqueueCampaign = async (campaignId) => {
  // 0) Fetch campaign and build audience OUTSIDE transaction (heavy work)
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true }
  });
  if (!camp) {return { ok: false, reason: 'not_found', enqueuedJobs: 0 };}

  if (!['draft', 'scheduled', 'paused'].includes(camp.status)) {
    return { ok: false, reason: `invalid_status:${camp.status}`, enqueuedJobs: 0 };
  }

  // Build audience OUTSIDE transaction (this can be slow with many contacts)
  let contacts = [];
  
  // Use new system-defined segmentation (allows both filters to be null = all eligible contacts)
  if (camp.filterGender !== null || camp.filterAgeGroup !== null || camp.listId === null) {
    const { buildAudience } = require('./audience.service');
    
    // Map Prisma enum back to normalized format
    const { mapAgeGroupToApi } = require('../lib/routeHelpers');
    const ageGroup = mapAgeGroupToApi(camp.filterAgeGroup);
    
    contacts = await buildAudience(
      camp.ownerId,
      camp.filterGender,
      ageGroup,
      null // No name search when enqueuing
    );
  } else if (camp.listId) {
    // Legacy: use list memberships (only if filters are not set and listId exists)
    const members = await prisma.listMembership.findMany({
      where: { listId: camp.listId, contact: { isSubscribed: true } },
      include: { contact: true }
    });
    contacts = members.map(m => m.contact);
  } else {
    // No filters and no list - invalid campaign
    await prisma.campaign.updateMany({
      where: { id: camp.id, ownerId: camp.ownerId },
      data: { status: 'failed', finishedAt: new Date(), total: 0 }
    });
    return { ok: false, reason: 'no_filters_or_list', enqueuedJobs: 0 };
  }

  if (!contacts.length) {
    logger.warn({ campaignId: camp.id, ownerId: camp.ownerId }, 'No eligible recipients found');
    await prisma.campaign.updateMany({
      where: { id: camp.id, ownerId: camp.ownerId },
      data: { status: 'failed', finishedAt: new Date(), total: 0 }
    });
    return { ok: false, reason: 'no_recipients', enqueuedJobs: 0 };
  }

  logger.info({ campaignId: camp.id, ownerId: camp.ownerId, recipientCount: contacts.length }, 'Audience built, checking subscription and credits');

  // 1) Check subscription status BEFORE starting any transaction
  const { isSubscriptionActive } = require('./subscription.service');
  const subscriptionActive = await isSubscriptionActive(camp.ownerId);
  if (!subscriptionActive) {
    logger.warn({ campaignId: camp.id, ownerId: camp.ownerId }, 'Inactive subscription - campaign enqueue blocked');
    return { ok: false, reason: 'inactive_subscription', enqueuedJobs: 0 };
  }

  // 2) Check credits BEFORE starting any transaction
  const { getBalance } = require('./wallet.service');
  const currentBalance = await getBalance(camp.ownerId);
  const requiredCredits = contacts.length;
  
  if (currentBalance < requiredCredits) {
    logger.warn({ campaignId: camp.id, ownerId: camp.ownerId, currentBalance, requiredCredits }, 'Insufficient credits');
    return { ok: false, reason: 'insufficient_credits', enqueuedJobs: 0 };
  }

  // 3) Short transaction: only update campaign status (fast, no heavy work)
  const txResult = await prisma.$transaction(async (tx) => {
    // Double-check status hasn't changed (optimistic locking)
    const currentCamp = await tx.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true, ownerId: true }
    });
    
    if (!currentCamp) {
      return { ok: false, reason: 'not_found' };
    }

    if (!['draft', 'scheduled', 'paused'].includes(currentCamp.status)) {
      return { ok: false, reason: `invalid_status:${currentCamp.status}` };
    }

    // Update status atomically
    const upd = await tx.campaign.updateMany({
      where: { id: campaignId, status: { in: ['draft', 'scheduled', 'paused'] } },
      data: { status: 'sending', startedAt: new Date() }
    });
    
    if (upd.count === 0) {
      return { ok: false, reason: 'already_sending' };
    }

    return { ok: true };
  }, {
    timeout: 5000, // 5 second timeout (should be fast now)
    maxWait: 5000
  });

  if (!txResult.ok) {return { ...txResult, enqueuedJobs: 0 };}

  // 3) Create messages and set totals (short transaction, no heavy work)
  // Note: Credits are NOT debited here - they will be debited per message after successful send
  const ownerId = camp.ownerId;
  // Use custom messageText if provided, otherwise use template text
  const messageTemplate = camp.messageText || camp.template?.text;
  
  if (!messageTemplate || !messageTemplate.trim()) {
    logger.error({ campaignId: camp.id }, 'Campaign has no message text');
    await prisma.campaign.updateMany({
      where: { id: camp.id, ownerId },
      data: { status: 'failed', finishedAt: new Date() }
    });
    return { ok: false, reason: 'no_message_text', enqueuedJobs: 0 };
  }
  
  logger.debug({ campaignId: camp.id, contactCount: contacts.length }, 'Generating messages with tracking IDs and links');

  // Generate messages with offer and unsubscribe links appended
  const messagesData = await Promise.all(contacts.map(async (contact) => {
    // Render message template
    let messageText = render(messageTemplate, contact);
    
    // Shorten any URLs in the message text first
    messageText = await shortenUrlsInText(messageText);
    
    // Generate tracking ID for offer link
    const trackingId = newTrackingId();
    const offerUrl = `${OFFER_BASE_URL}/o/${trackingId}`;
    const shortenedOfferUrl = await shortenUrl(offerUrl);
    
    // Generate unsubscribe token
    const unsubscribeToken = generateUnsubscribeToken(contact.id, ownerId, camp.id);
    const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${unsubscribeToken}`;
    const shortenedUnsubscribeUrl = await shortenUrl(unsubscribeUrl);
    
    // Append offer link and unsubscribe link to message (with shortened URLs)
    // Format: [Personalized message]\n\nView offer: {url}\n\nTo unsubscribe, tap: {unsubscribeUrl}
    messageText += `\n\nView offer: ${shortenedOfferUrl}`;
    messageText += `\n\nTo unsubscribe, tap: ${shortenedUnsubscribeUrl}`;
    
    return {
      ownerId,
      campaignId: camp.id,
      contactId: contact.id,
      to: contact.phone,
      text: messageText,
      trackingId,
      status: 'queued'
    };
  }));

  try {
    // For large campaigns (>10k messages), batch the createMany operation
    const BATCH_SIZE = 10000;
    const messageCount = messagesData.length;

    if (messageCount > BATCH_SIZE) {
      logger.info({ campaignId: camp.id, messageCount }, 'Large campaign detected, using batched inserts');
      
      // Update campaign totals first
      await prisma.campaign.updateMany({
        where: { id: camp.id, ownerId },
        data: { 
          total: contacts.length,
          sent: 0,
          failed: 0
        }
      });

      // Batch create messages
      for (let i = 0; i < messagesData.length; i += BATCH_SIZE) {
        const batch = messagesData.slice(i, i + BATCH_SIZE);
        await prisma.campaignMessage.createMany({
          data: batch,
          skipDuplicates: true
        });
        logger.debug({ campaignId: camp.id, batch: Math.floor(i / BATCH_SIZE) + 1, totalBatches: Math.ceil(messageCount / BATCH_SIZE) }, 'Batch inserted');
      }
    } else {
      // For smaller campaigns, use single transaction
      await prisma.$transaction([
        prisma.campaign.updateMany({
          where: { id: camp.id, ownerId },
          data: { 
            total: contacts.length,
            sent: 0,
            failed: 0
          }
        }),
        prisma.campaignMessage.createMany({
          data: messagesData,
          skipDuplicates: true
        })
      ], {
        timeout: 10000, // 10 seconds for bulk insert (should be fast)
        maxWait: 5000
      });
    }

    // Ensure aggregates are updated after message creation (for consistency)
    try {
      const { updateCampaignAggregates } = require('./campaignAggregates.service');
      await updateCampaignAggregates(camp.id, ownerId);
    } catch (aggErr) {
      logger.warn({ campaignId: camp.id, err: aggErr.message }, 'Failed to update campaign aggregates after message creation');
      // Don't fail the entire operation - aggregates can be recalculated later
    }
  } catch (e) {
    logger.error({ campaignId: camp.id, err: e.message, contactCount: contacts.length }, 'Failed to create campaign messages');
    // Revert campaign status (no credits to refund since we don't debit upfront)
    await prisma.campaign.updateMany({
      where: { id: camp.id, ownerId },
      data: { status: 'draft', startedAt: null }
    });
    throw e;
  }

  // 5) Enqueue jobs to Redis (OUTSIDE transaction, non-blocking)
  const smsQueue = require('../queues/sms.queue');
  const toEnqueue = await prisma.campaignMessage.findMany({
    where: { ownerId, campaignId: camp.id, status: 'queued', providerMessageId: null },
    select: { id: true }
  });

  let enqueuedJobs = 0;
  if (smsQueue && toEnqueue.length > 0) {
    // Campaigns always use bulk SMS with fixed batch size
    // Mitto's bulk API can handle 1M+ messages, so we use a simple fixed batch size
    // This protects our infrastructure while keeping logic simple and predictable
    const BATCH_SIZE = Number(process.env.SMS_BATCH_SIZE || 5000);
    
    // Group messages into fixed-size batches
    const batches = [];
    for (let i = 0; i < toEnqueue.length; i += BATCH_SIZE) {
      batches.push(toEnqueue.slice(i, i + BATCH_SIZE).map(m => m.id));
    }

    logger.info({ 
      campaignId: camp.id, 
      ownerId: camp.ownerId,
      totalMessages: toEnqueue.length,
      batchCount: batches.length,
      batchSize: BATCH_SIZE
    }, 'Enqueuing bulk SMS batch jobs');

    // Enqueue batch jobs
    const enqueuePromises = batches.map((messageIds, batchIndex) => 
      smsQueue.add('sendBulkSMS', {
        campaignId: camp.id,
        ownerId: camp.ownerId,
        messageIds
      }, { 
        jobId: `batch:${camp.id}:${Date.now()}:${batchIndex}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 }
      })
        .then(() => { 
          enqueuedJobs += messageIds.length; 
          logger.debug({ campaignId: camp.id, batchIndex, messageCount: messageIds.length }, 'Batch job enqueued');
        })
        .catch(err => {
          logger.error({ campaignId: camp.id, batchIndex, err: err.message }, 'Failed to enqueue batch job');
          // Continue even if some batches fail to enqueue
        })
    );
    
    // Wait for initial batches (first 10) to ensure some jobs are enqueued
    try {
      await Promise.all(enqueuePromises.slice(0, Math.min(10, enqueuePromises.length)));
    } catch (err) {
      logger.error({ campaignId: camp.id, err: err.message }, 'Some batch jobs failed to enqueue initially');
    }
    
    // Continue enqueuing remaining batches in background (fire and forget)
    if (enqueuePromises.length > 10) {
      Promise.all(enqueuePromises.slice(10)).catch(err => {
        logger.error({ campaignId: camp.id, err: err.message }, 'Some background batch jobs failed to enqueue');
      });
    }
  } else {
    logger.warn('SMS queue not available — messages created but not enqueued');
  }

    logger.info({ 
      campaignId: camp.id, 
      ownerId: camp.ownerId, 
      created: messagesData.length, 
      enqueuedJobs 
    }, 'Campaign enqueued successfully');

    return { ok: true, created: messagesData.length, enqueuedJobs, campaignId: camp.id };
};
