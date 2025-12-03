const prisma = require('../lib/prisma');

function rate(numer, denom) {
  return denom > 0 ? Number((numer / denom).toFixed(4)) : 0;
}

/**
 * List campaigns for a specific owner, with optional aggregated KPIs.
 *
 * @param {Object} params
 * @param {number} params.ownerId            // << REQUIRED for scoping
 * @param {number} [params.page=1]
 * @param {number} [params.pageSize=10]
 * @param {string} [params.q]
 * @param {string} [params.status]
 * @param {string} [params.dateFrom]
 * @param {string} [params.dateTo]
 * @param {string} [params.orderBy='createdAt']  // createdAt|scheduledAt|startedAt|finishedAt|name|status
 * @param {string} [params.order='desc']         // asc|desc
 * @param {boolean} [params.withStats=true]
 */
exports.listCampaigns = async ({
  ownerId,                           // << NEW (required)
  page = 1,
  pageSize = 10,
  q,
  status,
  dateFrom,
  dateTo,
  orderBy = 'createdAt',
  order = 'desc',
  withStats = true
}) => {
  if (!ownerId) {throw new Error('ownerId is required');}

  page = Math.max(1, Number(page));
  pageSize = Math.min(100, Math.max(1, Number(pageSize)));

  // Base scope per owner
  const where = { ownerId };

  if (q) {where.name = { contains: q, mode: 'insensitive' };}
  if (status) {where.status = status;}
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) {where.createdAt.gte = new Date(dateFrom);}
    if (dateTo) {where.createdAt.lte = new Date(dateTo);}
  }

  const [total, campaigns] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      orderBy: { [orderBy]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        scheduledAt: true,
        startedAt: true,
        finishedAt: true
      }
    })
  ]);

  if (!withStats || campaigns.length === 0) {
    return { total, items: campaigns };
  }

  const ids = campaigns.map(c => c.id);

  // Aggregations scoped by ownerId
  const msgs = await prisma.campaignMessage.groupBy({
    by: ['campaignId', 'status'],
    where: { ownerId, campaignId: { in: ids } },   // << SCOPE
    _count: { _all: true }
  });

  const reds = await prisma.redemption.groupBy({
    by: ['campaignId'],
    where: { ownerId, campaignId: { in: ids } },   // << SCOPE
    _count: { _all: true }
  });

  // Note: "delivered" status is mapped to "sent" - we only track sent/failed
  const statsMap = new Map();
  for (const id of ids) {statsMap.set(id, { sent: 0, failed: 0, redemptions: 0 });}

  for (const row of msgs) {
    const s = statsMap.get(row.campaignId);
    if (row.status === 'sent') {
      s.sent += row._count._all;
    } else if (row.status === 'failed') {
      s.failed += row._count._all;
    }
  }
  for (const row of reds) {
    statsMap.get(row.campaignId).redemptions = row._count._all;
  }

  // Note: "delivered" status is mapped to "sent" - deliveredRate is same as sent rate
  const items = campaigns.map(c => {
    const s = statsMap.get(c.id) || { sent:0, failed:0, redemptions:0 };
    return {
      ...c,
      stats: {
        ...s,
        delivered: s.sent, // delivered is same as sent since delivered maps to sent
        deliveredRate: rate(s.sent, s.sent), // Always 1.0 since delivered maps to sent
        conversionRate: rate(s.redemptions, s.sent) // Use sent for conversion rate
      }
    };
  });

  return { total, items };
};
