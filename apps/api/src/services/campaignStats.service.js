const prisma = require('../lib/prisma');

// Utility: safe division
function rate(numer, denom) {
  return denom > 0 ? Number((numer / denom).toFixed(4)) : 0;
}

async function getFirstSentAt(campaignId, ownerId) {
  const first = await prisma.campaignMessage.findFirst({
    where: { ownerId, campaignId, sentAt: { not: null } },
    orderBy: { sentAt: 'asc' },
    select: { sentAt: true }
  });
  return first?.sentAt || null;
}

/**
 * Scoped stats for a single campaign that belongs to `ownerId`.
 * Throws { code: 'NOT_FOUND' } if the campaign doesn't belong to owner.
 */
exports.getCampaignStats = async (campaignId, ownerId) => {
  if (!ownerId) {throw new Error('ownerId is required');}

  // Ensure the campaign belongs to owner and get aggregates (avoid leaking existence)
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, ownerId },
    select: { 
      id: true,
      total: true,
      sent: true,
      failed: true,
      updatedAt: true
    }
  });
  if (!campaign) {
    const err = new Error('campaign not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Use Campaign aggregates (more efficient and consistent)
  const { total, sent, failed } = campaign;

  // Get conversions count from Redemption table (this is our conversion tracking)
  const conversions = await prisma.redemption.count({
    where: { ownerId, campaignId }
  });

  // recipients (distinct contacts) — scoped via campaignMessage.ownerId
  const recipients = await prisma.campaignMessage.groupBy({
    by: ['contactId'],
    where: { ownerId, campaignId }
  });
  const recipientIds = recipients.map(r => r.contactId);

  // firstSentAt for unsubscribe window
  const firstSentAt = await getFirstSentAt(campaignId, ownerId);

  // unsubscribes among recipients since the campaign started sending
  let unsubscribes = 0;
  if (recipientIds.length && firstSentAt) {
    unsubscribes = await prisma.contact.count({
      where: {
        ownerId,                          // << scope
        id: { in: recipientIds },
        unsubscribedAt: { gte: firstSentAt }
      }
    });
  }

  return {
    total,
    sent,
    failed,
    conversions,
    unsubscribes,
    failureRate: rate(failed, sent),
    conversionRate: rate(conversions, sent), // Conversion rate = conversions / sent
    firstSentAt,
    updatedAt: campaign.updatedAt
  };
};

/**
 * Optional: bulk scoped stats for multiple campaignIds
 * Uses Campaign aggregates for consistency and performance
 */
exports.getManyCampaignsStats = async (campaignIds, ownerId) => {
  if (!ownerId) {throw new Error('ownerId is required');}
  if (!campaignIds?.length) {return [];}

  // Get campaigns with aggregates (more efficient than counting messages)
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: campaignIds }, ownerId },
    select: {
      id: true,
      total: true,
      sent: true,
      failed: true
    }
  });

  // Get conversions count per campaign (from Redemption table)
  const conversions = await prisma.redemption.groupBy({
    by: ['campaignId'],
    where: { ownerId, campaignId: { in: campaignIds } },
    _count: { _all: true }
  });

  // Create a map for quick lookup
  const conversionsMap = new Map(conversions.map(c => [c.campaignId, c._count._all]));

  // Shape into per-campaign summary with rates
  const out = campaigns.map(c => {
    const conversionsCount = conversionsMap.get(c.id) || 0;
    return {
      campaignId: c.id,
      total: c.total,
      sent: c.sent,
      failed: c.failed,
      conversions: conversionsCount,
      failureRate: rate(c.failed, c.sent),
      conversionRate: rate(conversionsCount, c.sent) // Conversion rate = conversions / sent
    };
  });

  return out;
};
