// apps/api/src/routes/dashboard.js
const { Router } = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
// const { handleError } = require('../lib/errors'); // Unused - using next() pattern

const r = Router();

/**
 * GET /dashboard/kpis
 * Returns aggregated KPI data for the authenticated user's store
 */
r.get('/dashboard/kpis', requireAuth, async (req, res, next) => {
  try {
    const ownerId = req.user.id;

    // Aggregate campaign counts
    const totalCampaigns = await prisma.campaign.count({
      where: { ownerId }
    });

    // Use Campaign aggregates for total (includes queued messages)
    // But count CampaignMessage directly for accurate sent/failed counts
    const campaignAggregates = await prisma.campaign.aggregate({
      where: { ownerId },
      _sum: {
        total: true  // Total includes queued + sent + failed
      }
    });

    // Count messages by status for accurate sent/failed counts
    const messageStats = await prisma.campaignMessage.groupBy({
      by: ['status'],
      where: {
        ownerId
      },
      _count: {
        id: true
      }
    });

    // Get totals
    const totalMessages = Number(campaignAggregates._sum.total ?? 0);
    let sent = 0;
    let failed = 0;

    messageStats.forEach(stat => {
      const count = Number(stat._count.id);
      if (stat.status === 'sent') {
        sent += count;
      } else if (stat.status === 'failed') {
        failed += count;
      }
      // Note: queued messages are included in totalMessages but not in sent/failed
    });

    // Calculate rates (deliveredRate is same as sent rate since delivered maps to sent)
    const sentRate = totalMessages > 0 ? sent / totalMessages : 0; // Sent rate = sent / total (protect against division by zero)
    const deliveredRate = sentRate; // Same as sent rate since delivered maps to sent

    // Aggregate conversions (redemptions) - count from Redemption table
    const conversion = await prisma.redemption.count({
      where: {
        ownerId
      }
    });

    const conversionRate = sent > 0 ? conversion / sent : 0;

    // Ensure all values are numbers (not BigInt from Prisma)
    const kpis = {
      totalCampaigns: Number(totalCampaigns),
      totalMessages: Number(totalMessages),
      sent: Number(sent), // Includes both "sent" and "delivered" (delivered maps to sent)
      delivered: Number(sent), // For backward compatibility (delivered = sent in our system)
      failed: Number(failed),
      sentRate: Number(sentRate), // Sent rate = sent / total (0 if no messages)
      deliveredRate: Number(deliveredRate), // Same as sent rate since delivered maps to sent
      conversion: Number(conversion),
      conversionRate: Number(conversionRate)
    };

    res.json(kpis);
  } catch (e) {
    // Pass to centralized error handler
    next(e);
  }
});

module.exports = r;

