// apps/api/src/routes/automations.js
// Automation routes for welcome and birthday messages

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getAutomations, updateAutomation, AUTOMATION_TYPES } = require('../services/automation.service');
const { getAutomationStats, getManyAutomationsStats } = require('../services/automationStats.service');
// const { validateRouteId } = require('../lib/routeHelpers'); // Unused for now
// const { handleError } = require('../lib/errors'); // Unused for now

const router = express.Router();

/**
 * GET /api/automations
 * Get all automations for the authenticated store
 * Returns welcome and birthday automations (creates if missing) with stats
 */
router.get('/automations', requireAuth, async (req, res, next) => {
  try {
    const automations = await getAutomations(req.user.id);
    
    // Get stats for both automations
    const automationIds = [];
    if (automations.welcome) {
      automationIds.push(automations.welcome.id);
    }
    if (automations.birthday) {
      automationIds.push(automations.birthday.id);
    }
    
    const statsArray = automationIds.length > 0 
      ? await getManyAutomationsStats(automationIds, req.user.id)
      : [];
    
    const statsMap = new Map(statsArray.map(s => [s.automationId, s]));
    
    // Add stats to response
    const response = {};
    if (automations.welcome) {
      const stats = statsMap.get(automations.welcome.id);
      response.welcome = {
        ...automations.welcome,
        stats: stats ? {
          total: stats.total,
          sent: stats.sent,
          conversions: stats.conversions,
          conversionRate: stats.conversionRate
        } : { total: 0, sent: 0, conversions: 0, conversionRate: 0 }
      };
    }
    if (automations.birthday) {
      const stats = statsMap.get(automations.birthday.id);
      response.birthday = {
        ...automations.birthday,
        stats: stats ? {
          total: stats.total,
          sent: stats.sent,
          conversions: stats.conversions,
          conversionRate: stats.conversionRate
        } : { total: 0, sent: 0, conversions: 0, conversionRate: 0 }
      };
    }
    
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/automations/:type
 * Get a specific automation by type
 * Types: welcome_message, birthday_message
 */
router.get('/automations/:type', requireAuth, async (req, res, next) => {
  try {
    const { type } = req.params;

    if (![AUTOMATION_TYPES.WELCOME, AUTOMATION_TYPES.BIRTHDAY].includes(type)) {
      return res.status(400).json({ 
        message: 'Invalid automation type. Must be welcome_message or birthday_message.', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const automation = await getAutomations(req.user.id);
    const result = type === AUTOMATION_TYPES.WELCOME ? automation.welcome : automation.birthday;

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/automations/:type
 * Update automation (enable/disable or edit message)
 * Body: { isActive?: boolean, messageBody?: string }
 */
router.put('/automations/:type', requireAuth, async (req, res, next) => {
  try {
    const { type } = req.params;
    const { isActive, messageBody } = req.body || {};

    if (![AUTOMATION_TYPES.WELCOME, AUTOMATION_TYPES.BIRTHDAY].includes(type)) {
      return res.status(400).json({ 
        message: 'Invalid automation type. Must be welcome_message or birthday_message.', 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Validate updates
    const updates = {};
    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ 
          message: 'isActive must be a boolean value', 
          code: 'VALIDATION_ERROR' 
        });
      }
      updates.isActive = isActive;
    }

    if (messageBody !== undefined) {
      if (typeof messageBody !== 'string' || !messageBody.trim()) {
        return res.status(400).json({ 
          message: 'Message body must be a non-empty string', 
          code: 'VALIDATION_ERROR' 
        });
      }
      const { sanitizeString } = require('../lib/sanitize');
      // SMS messages are limited to 160 characters, but we allow up to 500 for template variables
      updates.messageBody = sanitizeString(messageBody.trim(), { maxLength: 500 });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ 
        message: 'No updates provided. Please provide isActive or messageBody.', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const automation = await updateAutomation(req.user.id, type, updates);

    res.json({
      id: automation.id,
      type: automation.type,
      isActive: automation.isActive,
      messageBody: automation.messageBody,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/automations (blocked)
 * Users cannot create automations
 */
router.post('/automations', requireAuth, (_req, res) => {
  res.status(403).json({ 
    message: 'Automations are system-defined. You can only enable/disable and edit messages.', 
    code: 'FORBIDDEN' 
  });
});

/**
 * GET /api/automations/:type/stats
 * Get statistics for a specific automation
 */
router.get('/automations/:type/stats', requireAuth, async (req, res, next) => {
  try {
    const { type } = req.params;

    if (![AUTOMATION_TYPES.WELCOME, AUTOMATION_TYPES.BIRTHDAY].includes(type)) {
      return res.status(400).json({ 
        message: 'Invalid automation type. Must be welcome_message or birthday_message.', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const automations = await getAutomations(req.user.id);
    const automation = type === AUTOMATION_TYPES.WELCOME ? automations.welcome : automations.birthday;

    if (!automation) {
      return res.status(404).json({ 
        message: 'Automation not found', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    const stats = await getAutomationStats(automation.id, req.user.id);
    res.json(stats);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ 
        message: err.message || 'Automation not found', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }
    next(err);
  }
});

/**
 * DELETE /api/automations/:type (blocked)
 * Users cannot delete automations
 */
router.delete('/automations/:type', requireAuth, (_req, res) => {
  res.status(403).json({ 
    message: 'Automations cannot be deleted. You can only disable them.', 
    code: 'FORBIDDEN' 
  });
});

module.exports = router;

