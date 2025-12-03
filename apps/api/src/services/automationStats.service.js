// apps/api/src/services/automationStats.service.js
// Automation statistics service

const prisma = require('../lib/prisma');
// const pino = require('pino'); // Unused for now
// const logger = pino({ name: 'automation-stats-service' }); // Unused for now

/**
 * Helper function to calculate rate (percentage)
 */
function rate(numerator, denominator) {
  if (!denominator || denominator === 0) {return 0;}
  return numerator / denominator;
}

/**
 * Get stats for a single automation
 * Scoped to ownerId to prevent data leakage
 * 
 * @param {number} automationId - Automation ID
 * @param {number} ownerId - Store owner ID (for scoping)
 * @returns {Promise<Object>} Stats object
 */
async function getAutomationStats(automationId, ownerId) {
  if (!ownerId) {throw new Error('ownerId is required');}

  // Ensure the automation belongs to owner
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, ownerId },
    select: { 
      id: true,
      type: true,
      updatedAt: true
    }
  });
  
  if (!automation) {
    const err = new Error('automation not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Count messages by status
  const [total, sent, failed] = await Promise.all([
    prisma.automationMessage.count({
      where: { automationId, ownerId }
    }),
    prisma.automationMessage.count({
      where: {
        automationId,
        ownerId,
        status: 'sent'
      }
    }),
    prisma.automationMessage.count({
      where: {
        automationId,
        ownerId,
        status: 'failed'
      }
    })
  ]);

  // Get conversions count from AutomationRedemption table
  const conversions = await prisma.automationRedemption.count({
    where: { ownerId, automationId }
  });

  return {
    automationId: automation.id,
    type: automation.type,
    total,
    sent,
    failed,
    conversions,
    conversionRate: rate(conversions, sent),
    failureRate: rate(failed, sent),
    updatedAt: automation.updatedAt
  };
}

/**
 * Bulk stats for multiple automations
 * Uses groupBy for efficiency
 * 
 * @param {Array<number>} automationIds - Array of automation IDs
 * @param {number} ownerId - Store owner ID (for scoping)
 * @returns {Promise<Array>} Array of stats objects
 */
async function getManyAutomationsStats(automationIds, ownerId) {
  if (!ownerId) {throw new Error('ownerId is required');}
  if (!automationIds?.length) {return [];}

  // Get automations with basic info (scoped by ownerId)
  const automations = await prisma.automation.findMany({
    where: { id: { in: automationIds }, ownerId },
    select: {
      id: true,
      type: true,
      updatedAt: true
    }
  });

  const ids = automations.map(a => a.id);

  // Aggregations scoped by ownerId
  const msgs = await prisma.automationMessage.groupBy({
    by: ['automationId', 'status'],
    where: { ownerId, automationId: { in: ids } },
    _count: { _all: true }
  });

  const reds = await prisma.automationRedemption.groupBy({
    by: ['automationId'],
    where: { ownerId, automationId: { in: ids } },
    _count: { _all: true }
  });

  // Build stats map
  const statsMap = new Map();
  for (const id of ids) {statsMap.set(id, { sent: 0, failed: 0, total: 0, redemptions: 0 });}

  for (const row of msgs) {
    const s = statsMap.get(row.automationId);
    if (!s) {continue;}
    s.total += row._count._all;
    if (row.status === 'sent') {
      s.sent += row._count._all;
    } else if (row.status === 'failed') {
      s.failed += row._count._all;
    }
  }
  
  for (const row of reds) {
    const s = statsMap.get(row.automationId);
    if (s) {s.redemptions = row._count._all;}
  }

  // Shape into per-automation summary with rates
  const out = automations.map(a => {
    const s = statsMap.get(a.id) || { sent: 0, failed: 0, total: 0, redemptions: 0 };
    return {
      automationId: a.id,
      type: a.type,
      total: s.total,
      sent: s.sent,
      failed: s.failed,
      conversions: s.redemptions,
      conversionRate: rate(s.redemptions, s.sent),
      failureRate: rate(s.failed, s.sent),
      updatedAt: a.updatedAt
    };
  });

  return out;
}

module.exports = {
  getAutomationStats,
  getManyAutomationsStats
};

