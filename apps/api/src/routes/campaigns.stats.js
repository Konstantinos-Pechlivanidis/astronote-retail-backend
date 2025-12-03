const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getCampaignStats, getManyCampaignsStats } = require('../services/campaignStats.service');

const r = Router();

// GET /campaigns/:id/stats
r.get('/campaigns/:id/stats', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        message: 'Invalid campaign ID', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const ownerId = req.user.id;

    const stats = await getCampaignStats(id, ownerId);
    const payload = { campaignId: id, ...stats };

    res.json(payload);
  } catch (e) {
    if (e?.code === 'NOT_FOUND') {
      return res.status(404).json({ 
        message: 'Campaign not found', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }
    next(e);
  }
});

// (optional) GET /campaigns/stats?ids=1,2,3
r.get('/campaigns/stats', requireAuth, async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const ids = (req.query.ids || '').toString()
      .split(',').map(x => Number(x.trim())).filter(x => x && !isNaN(x));

    if (!ids.length) {
      return res.json([]);
    }

    // You could add caching here with a combined key if needed
    const arr = await getManyCampaignsStats(ids, ownerId);
    res.json(arr);
  } catch (e) { next(e); }
});

module.exports = r;
