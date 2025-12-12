// apps/api/src/services/statusRefresh.service.js
const prisma = require('../lib/prisma');
const { getMessageStatus } = require('./mitto.service');
const { updateCampaignAggregates } = require('./campaignAggregates.service');
const pino = require('pino');

const logger = pino({ name: 'status-refresh-service' });

/**
 * Map Mitto deliveryStatus to internal status (case-insensitive)
 * Mitto sends: "Sent", "Delivered", "Failure" (capitalized)
 * We only use "sent" and "failed" - map "Delivered" to "sent"
 */
function mapMittoStatus(deliveryStatus) {
  if (!deliveryStatus) {
    logger.warn({ deliveryStatus }, 'Empty deliveryStatus from Mitto, defaulting to sent');
    return 'sent';
  }
  
  const status = String(deliveryStatus).toLowerCase().trim();
  
  // Mitto's exact values (case-insensitive)
  // Map "Delivered" to "sent" - we don't track delivered separately
  if (status === 'delivered' || status === 'delivrd' || status === 'completed' || status === 'ok') {
    return 'sent';
  } else if (status === 'failure' || status === 'failed') {
    return 'failed';
  } else if (status === 'sent') {
    return 'sent';
  }
  
  // Unknown status - log warning and default to 'sent'
  logger.warn({ deliveryStatus, normalized: status }, 'Unknown Mitto deliveryStatus, defaulting to sent');
  return 'sent';
}

/**
 * Refresh statuses for all messages in a campaign
 * 
 * @param {number} campaignId - Campaign ID
 * @param {number} ownerId - Owner ID for scoping
 * @returns {Promise<Object>} Summary of refresh operation
 */
async function refreshCampaignStatuses(campaignId, ownerId) {
  try {
    // Verify campaign exists and belongs to owner
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, ownerId },
      select: { id: true }
    });

    if (!campaign) {
      logger.warn({ campaignId, ownerId }, 'Campaign not found or not owned by user');
      return { refreshed: 0, updated: 0, errors: 0 };
    }

    // Find messages that need status refresh (queued or sent, with providerMessageId)
    // Note: We refresh 'sent' messages because they might have been delivered since
    const messages = await prisma.campaignMessage.findMany({
      where: {
        campaignId,
        ownerId,
        AND: [
          {
            OR: [
              { status: 'queued' },
              { status: 'sent' },
            ],
          },
          { providerMessageId: { not: null } },
        ],
      },
      select: {
        id: true,
        providerMessageId: true,
        status: true
      }
    });

    if (messages.length === 0) {
      logger.info({ campaignId }, 'No messages to refresh');
      return { refreshed: 0, updated: 0, errors: 0 };
    }

    let refreshed = 0;
    let updated = 0;
    let errors = 0;
    const statusUpdates = [];

    // Refresh each message status
    for (const msg of messages) {
      try {
        const mittoStatus = await getMessageStatus(msg.providerMessageId);
        const newStatus = mapMittoStatus(mittoStatus.deliveryStatus);

        // Only update if status changed
        if (newStatus !== msg.status) {
          const updateData = {
            status: newStatus,
            updatedAt: new Date()
          };

          if (newStatus === 'sent') {
            // Update sentAt timestamp if not already set
            updateData.sentAt = mittoStatus.updatedAt 
              ? new Date(mittoStatus.updatedAt) 
              : new Date();
          } else if (newStatus === 'failed') {
            updateData.failedAt = mittoStatus.updatedAt 
              ? new Date(mittoStatus.updatedAt) 
              : new Date();
            updateData.error = `Mitto status: ${mittoStatus.deliveryStatus}`;
          }

          statusUpdates.push({
            id: msg.id,
            data: updateData
          });
          updated++;
        }

        refreshed++;
      } catch (err) {
        errors++;
        logger.error({ 
          messageId: msg.id, 
          providerMessageId: msg.providerMessageId,
          err: err.message 
        }, 'Failed to refresh message status from Mitto');
        // Continue processing other messages
      }
    }

    // Batch update all changed messages
    if (statusUpdates.length > 0) {
      await Promise.all(
        statusUpdates.map(update =>
          prisma.campaignMessage.update({
            where: { id: update.id },
            data: update.data
          })
        )
      );
    }

    // Update campaign aggregates
    try {
      await updateCampaignAggregates(campaignId, ownerId);
    } catch (aggErr) {
      logger.error({ campaignId, err: aggErr.message }, 'Failed to update campaign aggregates after refresh');
      // Don't fail the entire operation
    }

    logger.info({ 
      campaignId, 
      refreshed, 
      updated, 
      errors 
    }, 'Campaign status refresh completed');

    return { refreshed, updated, errors };
  } catch (err) {
    logger.error({ campaignId, ownerId, err: err.message }, 'Failed to refresh campaign statuses');
    throw err;
  }
}

/**
 * Refresh statuses for pending messages across all campaigns
 * 
 * @param {number} limit - Maximum number of messages to refresh
 * @returns {Promise<Object>} Summary of refresh operation
 */
async function refreshPendingStatuses(limit = 100) {
  try {
    // Find messages that need status refresh
    const messages = await prisma.campaignMessage.findMany({
      where: {
        AND: [
          {
            OR: [
              { status: 'queued' },
              { status: 'sent' },
            ],
          },
          { providerMessageId: { not: null } },
        ],
      },
      select: {
        id: true,
        campaignId: true,
        ownerId: true,
        providerMessageId: true,
        status: true
      },
      take: limit,
      orderBy: { createdAt: 'asc' } // Process oldest first
    });

    if (messages.length === 0) {
      logger.info('No pending messages to refresh');
      return { refreshed: 0, updated: 0, errors: 0, campaignsUpdated: 0 };
    }

    let refreshed = 0;
    let updated = 0;
    let errors = 0;
    const affectedCampaigns = new Set();
    const statusUpdates = [];

    // Refresh each message status
    for (const msg of messages) {
      try {
        logger.debug({ 
          messageId: msg.id, 
          providerMessageId: msg.providerMessageId,
          currentStatus: msg.status 
        }, 'Refreshing message status from Mitto');
        
        const mittoStatus = await getMessageStatus(msg.providerMessageId);
        const newStatus = mapMittoStatus(mittoStatus.deliveryStatus);

        logger.debug({ 
          messageId: msg.id, 
          providerMessageId: msg.providerMessageId,
          mittoDeliveryStatus: mittoStatus.deliveryStatus,
          currentStatus: msg.status,
          newStatus 
        }, 'Mitto status retrieved');

        // Only update if status changed
        if (newStatus !== msg.status) {
          const updateData = {
            status: newStatus,
            updatedAt: new Date()
          };

          if (newStatus === 'sent') {
            // Update sentAt timestamp if not already set
            updateData.sentAt = mittoStatus.updatedAt 
              ? new Date(mittoStatus.updatedAt) 
              : new Date();
            logger.info({ 
              messageId: msg.id, 
              providerMessageId: msg.providerMessageId,
              originalMittoStatus: mittoStatus.deliveryStatus
            }, 'Message status updated to sent');
          } else if (newStatus === 'failed') {
            updateData.failedAt = mittoStatus.updatedAt 
              ? new Date(mittoStatus.updatedAt) 
              : new Date();
            updateData.error = `Mitto status: ${mittoStatus.deliveryStatus}`;
            logger.info({ 
              messageId: msg.id, 
              providerMessageId: msg.providerMessageId 
            }, 'Message status updated to failed');
            logger.info({ 
              messageId: msg.id, 
              providerMessageId: msg.providerMessageId 
            }, 'Message status updated to sent');
          }

          statusUpdates.push({
            id: msg.id,
            campaignId: msg.campaignId,
            ownerId: msg.ownerId,
            data: updateData
          });
          affectedCampaigns.add(`${msg.campaignId}:${msg.ownerId}`);
          updated++;
        } else {
          logger.debug({ 
            messageId: msg.id, 
            status: msg.status 
          }, 'Message status unchanged');
        }

        refreshed++;
      } catch (err) {
        errors++;
        logger.error({ 
          messageId: msg.id, 
          providerMessageId: msg.providerMessageId,
          err: err.message,
          stack: err.stack 
        }, 'Failed to refresh message status from Mitto');
        // Continue processing other messages
      }
    }

    // Batch update all changed messages
    if (statusUpdates.length > 0) {
      await Promise.all(
        statusUpdates.map(update =>
          prisma.campaignMessage.update({
            where: { id: update.id },
            data: update.data
          })
        )
      );
    }

    // Update campaign aggregates for affected campaigns
    let campaignsUpdated = 0;
    for (const key of affectedCampaigns) {
      try {
        const [campaignId, ownerId] = key.split(':').map(Number);
        await updateCampaignAggregates(campaignId, ownerId);
        campaignsUpdated++;
      } catch (aggErr) {
        logger.error({ key, err: aggErr.message }, 'Failed to update campaign aggregates');
        // Continue with other campaigns
      }
    }

    logger.info({ 
      refreshed, 
      updated, 
      errors, 
      campaignsUpdated 
    }, 'Pending status refresh completed');

    return { refreshed, updated, errors, campaignsUpdated };
  } catch (err) {
    logger.error({ limit, err: err.message }, 'Failed to refresh pending statuses');
    throw err;
  }
}

/**
 * Refresh statuses for all messages in a bulk batch (by bulkId)
 * 
 * @param {string} bulkId - Mitto bulkId
 * @param {number} [ownerId] - Optional owner ID for scoping
 * @returns {Promise<Object>} Summary of refresh operation
 */
async function refreshBulkStatuses(bulkId, ownerId = null) {
  try {
    if (!bulkId) {
      throw new Error('bulkId is required');
    }

    // Find all messages with this bulkId
    const where = {
      bulkId,
      AND: [
        {
          OR: [
            { status: 'queued' },
            { status: 'sent' },
          ],
        },
        { providerMessageId: { not: null } },
      ],
    };
    
    if (ownerId) {
      where.AND.push({ ownerId });
    }

    const messages = await prisma.campaignMessage.findMany({
      where,
      select: {
        id: true,
        campaignId: true,
        ownerId: true,
        providerMessageId: true,
        status: true
      }
    });

    if (messages.length === 0) {
      logger.info({ bulkId, ownerId }, 'No messages found for bulkId');
      return { refreshed: 0, updated: 0, errors: 0, campaignsUpdated: 0 };
    }

    logger.info({ bulkId, ownerId, messageCount: messages.length }, 'Refreshing bulk statuses');

    let refreshed = 0;
    let updated = 0;
    let errors = 0;
    const affectedCampaigns = new Set();
    const statusUpdates = [];

    // Refresh each message status
    for (const msg of messages) {
      try {
        const mittoStatus = await getMessageStatus(msg.providerMessageId);
        const newStatus = mapMittoStatus(mittoStatus.deliveryStatus);

        // Only update if status changed
        if (newStatus !== msg.status) {
          const updateData = {
            status: newStatus,
            updatedAt: new Date()
          };

          if (newStatus === 'sent') {
            updateData.sentAt = mittoStatus.updatedAt 
              ? new Date(mittoStatus.updatedAt) 
              : new Date();
          } else if (newStatus === 'failed') {
            updateData.failedAt = mittoStatus.updatedAt 
              ? new Date(mittoStatus.updatedAt) 
              : new Date();
            updateData.error = `Mitto status: ${mittoStatus.deliveryStatus}`;
          }

          statusUpdates.push({
            id: msg.id,
            campaignId: msg.campaignId,
            ownerId: msg.ownerId,
            data: updateData
          });
          affectedCampaigns.add(`${msg.campaignId}:${msg.ownerId}`);
          updated++;
        }

        refreshed++;
      } catch (err) {
        errors++;
        logger.error({ 
          messageId: msg.id, 
          providerMessageId: msg.providerMessageId,
          bulkId,
          err: err.message 
        }, 'Failed to refresh message status from Mitto');
        // Continue processing other messages
      }
    }

    // Batch update all changed messages
    if (statusUpdates.length > 0) {
      await Promise.all(
        statusUpdates.map(update =>
          prisma.campaignMessage.update({
            where: { id: update.id },
            data: update.data
          })
        )
      );
    }

    // Update campaign aggregates for affected campaigns
    let campaignsUpdated = 0;
    for (const key of affectedCampaigns) {
      try {
        const [campaignId, ownerId] = key.split(':').map(Number);
        await updateCampaignAggregates(campaignId, ownerId);
        campaignsUpdated++;
      } catch (aggErr) {
        logger.error({ key, err: aggErr.message }, 'Failed to update campaign aggregates');
        // Continue with other campaigns
      }
    }

    logger.info({ 
      bulkId,
      ownerId,
      refreshed, 
      updated, 
      errors,
      campaignsUpdated 
    }, 'Bulk status refresh completed');

    return { refreshed, updated, errors, campaignsUpdated };
  } catch (err) {
    logger.error({ bulkId, ownerId, err: err.message }, 'Failed to refresh bulk statuses');
    throw err;
  }
}

module.exports = {
  refreshCampaignStatuses,
  refreshPendingStatuses,
  refreshBulkStatuses
};

