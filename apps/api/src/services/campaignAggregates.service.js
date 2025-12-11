// apps/api/src/services/campaignAggregates.service.js
const prisma = require('../lib/prisma');
const pino = require('pino');

const logger = pino({ name: 'campaign-aggregates-service' });

/**
 * Update campaign aggregates (total, sent, failed, processed) from CampaignMessage counts
 * Phase 2.2: sent = only actually sent (status='sent'), processed = sent + failed
 * Note: "delivered" status is mapped to "sent" - we only track sent/failed
 * 
 * @param {number} campaignId - Campaign ID
 * @param {number} ownerId - Owner ID for scoping
 * @returns {Promise<Object>} Updated aggregate counts
 */
async function updateCampaignAggregates(campaignId, ownerId) {
  try {
    // Verify campaign exists and belongs to owner
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, ownerId },
      select: { id: true }
    });

    if (!campaign) {
      logger.warn({ campaignId, ownerId }, 'Campaign not found or not owned by user');
      return null;
    }

    // Count messages by status (Phase 2.2: sent = only actually sent, not processed)
    const [total, success, failed] = await Promise.all([
      prisma.campaignMessage.count({
        where: { campaignId, ownerId }
      }),
      prisma.campaignMessage.count({
        where: {
          campaignId,
          ownerId,
          status: 'sent' // Only actually sent messages (Phase 2.2)
        }
      }),
      prisma.campaignMessage.count({
        where: {
          campaignId,
          ownerId,
          status: 'failed'
        }
      })
    ]);

    // Calculate processed (sent + failed) - Phase 2.2
    const processed = success + failed;

    // Check if all messages are processed (no queued messages remaining)
    const queuedCount = await prisma.campaignMessage.count({
      where: {
        campaignId,
        ownerId,
        status: 'queued'
      }
    });

    // Determine campaign status based on message states
    let campaignStatus = null;
    if (queuedCount > 0) {
      // Still has queued messages - keep as 'sending'
      campaignStatus = 'sending';
    } else if (total > 0 && processed === total) {
      // All messages have been processed (sent or failed) - Phase 2.2
      campaignStatus = 'completed';
    }
    // If total === 0, don't change status (campaign might be in draft)

    // Update campaign aggregates and status (Phase 2.2: sent = success, add processed)
    const updateData = {
      total,
      sent: success,        // Actually sent (not processed) - Phase 2.2
      failed,
      processed,            // New: sent + failed - Phase 2.2
      updatedAt: new Date()
    };

    // Only update status if we determined a new status
    if (campaignStatus) {
      updateData.status = campaignStatus;
      if (campaignStatus === 'completed') {
        updateData.finishedAt = new Date();
      }
    }

    await prisma.campaign.updateMany({
      where: { id: campaignId, ownerId },
      data: updateData
    });

    logger.info({ 
      campaignId, 
      total, 
      sent: success,        // Actually sent - Phase 2.2
      processed,           // New: sent + failed - Phase 2.2
      failed, 
      queuedCount,
      campaignStatus: campaignStatus || 'unchanged'
    }, 'Campaign aggregates updated (Phase 2.2)');

    return { total, sent: success, processed, failed, campaignStatus };
  } catch (err) {
    logger.error({ campaignId, ownerId, err: err.message }, 'Failed to update campaign aggregates');
    // Don't throw - aggregates can be recalculated later
    return null;
  }
}

/**
 * Recalculate aggregates for all campaigns owned by a user
 * Useful for bulk updates or data consistency checks
 * 
 * @param {number} ownerId - Owner ID
 * @returns {Promise<Object>} Summary of updates
 */
async function recalculateAllCampaignAggregates(ownerId) {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { ownerId },
      select: { id: true }
    });

    let updated = 0;
    let errors = 0;

    for (const campaign of campaigns) {
      const result = await updateCampaignAggregates(campaign.id, ownerId);
      if (result) {
        updated++;
      } else {
        errors++;
      }
    }

    logger.info({ ownerId, updated, errors, total: campaigns.length }, 'Bulk campaign aggregates update completed');

    return { updated, errors, total: campaigns.length };
  } catch (err) {
    logger.error({ ownerId, err: err.message }, 'Failed to recalculate all campaign aggregates');
    throw err;
  }
}

module.exports = {
  updateCampaignAggregates,
  recalculateAllCampaignAggregates
};

