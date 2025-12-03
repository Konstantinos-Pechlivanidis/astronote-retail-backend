const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
// const pino = require('pino'); // Unused for now
// const logger = pino({ name: 'templates-route' }); // Unused for now

const router = express.Router();

const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

/**
 * NOTE:
 * - Templates are managed by the platform (system user).
 * - Owners can only read & use them in campaigns.
 * - No create/update/delete endpoints for normal users.
 */

// List templates (system-only), with optional search, category filter & pagination
router.get('/templates', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
    const q = (req.query.q || '').toString().trim();
    const category = (req.query.category || '').toString().trim().toLowerCase();
    const language = (req.query.language || '').toString().trim().toLowerCase();

    // Validate language parameter (required: "en" or "gr")
    if (!language || !['en', 'gr'].includes(language)) {
      return res.status(400).json({ 
        message: 'Language parameter is required and must be "en" or "gr"', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const where = { ownerId: SYSTEM_USER_ID, language };
    
    if (q) {where.name = { contains: q, mode: 'insensitive' };}
    if (category && ['cafe', 'restaurant', 'gym', 'sports_club', 'generic'].includes(category)) {
      where.category = category;
    }

    const [items, total] = await Promise.all([
      prisma.messageTemplate.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { 
          id: true, 
          name: true, 
          text: true, 
          category: true,
          goal: true,
          suggestedMetrics: true,
          language: true,
          createdAt: true, 
          updatedAt: true 
        }
      }),
      prisma.messageTemplate.count({ where })
    ]);

    const response = { items, total, page, pageSize };
    
    res.json(response);
  } catch (e) {
    next(e);
  }
});

// Get one template (system-only)
router.get('/templates/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        message: 'Invalid template ID', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const t = await prisma.messageTemplate.findFirst({
      where: { id, ownerId: SYSTEM_USER_ID },
      select: { 
        id: true, 
        name: true, 
        text: true, 
        category: true,
        goal: true,
        suggestedMetrics: true,
        language: true,
        createdAt: true, 
        updatedAt: true 
      }
    });
    if (!t) {
      return res.status(404).json({ 
        message: 'Template not found', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    res.json(t);
  } catch (e) {
    next(e);
  }
});

// Explicitly block write operations for non-admin users
router.post('/templates', requireAuth, (_req, res) => {
  return res.status(403).json({ 
    message: 'Templates are managed by the platform.', 
    code: 'FORBIDDEN' 
  });
});
router.put('/templates/:id', requireAuth, (_req, res) => {
  return res.status(403).json({ 
    message: 'Templates are managed by the platform.', 
    code: 'FORBIDDEN' 
  });
});
router.delete('/templates/:id', requireAuth, (_req, res) => {
  return res.status(403).json({ 
    message: 'Templates are managed by the platform.', 
    code: 'FORBIDDEN' 
  });
});

module.exports = router;
