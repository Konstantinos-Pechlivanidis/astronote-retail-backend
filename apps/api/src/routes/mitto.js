// apps/api/src/routes/mitto.js
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getMessageStatus, refreshMessageStatus } = require('../services/mitto.service');
// const { sendSingle, sendBulkStatic } = require('../services/mitto.service'); // Unused - kept for potential future use
const router = express.Router();

/**
 * POST /api/mitto/refresh-status
 * Refresh message status from Mitto API
 * Body: { providerMessageId, ownerId? }
 */
router.post('/mitto/refresh-status', requireAuth, async (req, res, next) => {
  try {
    const { providerMessageId } = req.body || {};
    if (!providerMessageId) {
      return res.status(400).json({ 
        message: 'Provider message ID is required', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const result = await refreshMessageStatus(providerMessageId, req.user.id);
    res.json(result);
  } catch (e) {
    if (e.message.includes('not found')) {
      return res.status(404).json({ 
        message: e.message || 'Message not found', 
        code: 'MESSAGE_NOT_FOUND' 
      });
    }
    next(e);
  }
});

/**
 * GET /api/mitto/message/:messageId
 * Get message status from Mitto API
 */
router.get('/mitto/message/:messageId', requireAuth, async (req, res, next) => {
  try {
    const { messageId } = req.params;
    if (!messageId) {
      return res.status(400).json({ 
        message: 'Message ID is required', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const status = await getMessageStatus(messageId);
    res.json(status);
  } catch (e) {
    if (e.message.includes('not found')) {
      return res.status(404).json({ 
        message: e.message || 'Message not found', 
        code: 'MESSAGE_NOT_FOUND' 
      });
    }
    next(e);
  }
});

/**
 * POST /api/mitto/refresh-status-bulk
 * Refresh status for multiple messages (for campaigns)
 * Body: { campaignId } or { providerMessageIds: [...] }
 */
router.post('/mitto/refresh-status-bulk', requireAuth, async (req, res, next) => {
  try {
    const { campaignId, providerMessageIds } = req.body || {};
    const prisma = require('../lib/prisma');

    let messageIds = [];

    if (campaignId) {
      // Get all messages for campaign that have providerMessageId
      const messages = await prisma.campaignMessage.findMany({
        where: {
          campaignId: Number(campaignId),
          ownerId: req.user.id,
          providerMessageId: { not: null }
        },
        select: { providerMessageId: true }
      });
      messageIds = messages.map(m => m.providerMessageId).filter(Boolean);
    } else if (Array.isArray(providerMessageIds) && providerMessageIds.length > 0) {
      messageIds = providerMessageIds.filter(Boolean);
    } else {
      return res.status(400).json({ 
        message: 'Either campaignId or providerMessageIds array is required', 
        code: 'VALIDATION_ERROR' 
      });
    }

    if (messageIds.length === 0) {
      return res.json({ updated: 0, results: [] });
    }

    // Limit to 100 messages per request
    const limitedIds = messageIds.slice(0, 100);
    const results = [];

    for (const providerMessageId of limitedIds) {
      try {
        const result = await refreshMessageStatus(providerMessageId, req.user.id);
        results.push({ providerMessageId, success: true, ...result });
      } catch (e) {
        results.push({ 
          providerMessageId, 
          success: false, 
          code: 'REFRESH_FAILED',
          message: e.message 
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      total: limitedIds.length,
      updated: successCount,
      failed: limitedIds.length - successCount,
      results
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

