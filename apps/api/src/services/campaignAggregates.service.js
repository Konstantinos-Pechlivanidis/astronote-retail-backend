// apps/api/src/services/campaignAggregates.service.js
const prisma = require('../lib/prisma');
const pino = require('pino');

const logger = pino({ name: 'campaign-aggregates-service' });

/**
 * Update campaign aggregates (total, sent, failed) from CampaignMessage counts
 * Note: We only track "sent" and "failed" - "delivered" is mapped to "sent"
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

    // Count messages by status
    // sent = all processed messages (sent or failed), failed = only failed
    const [total, sent, failed] = await Promise.all([
      prisma.campaignMessage.count({
        where: { campaignId, ownerId }
      }),
      prisma.campaignMessage.count({
        where: {
          campaignId,
          ownerId,
          status: { in: ['sent', 'failed'] }
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
    } else if (total > 0 && sent === total) {
      // All messages have been processed (sent or failed)
      campaignStatus = 'completed';
    }
    // If total === 0, don't change status (campaign might be in draft)

    // Update campaign aggregates and status
    const updateData = {
      total,
      sent,
      failed,
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
      sent, 
      failed, 
      queuedCount,
      campaignStatus: campaignStatus || 'unchanged'
    }, 'Campaign aggregates updated');

    return { total, sent, failed, campaignStatus };
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

