const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
// const { handleError } = require('../lib/errors'); // Unused - using next() pattern
const { scoped } = require('../lib/policies');
const pino = require('pino');

const logger = pino({ name: 'lists-route' });
const router = express.Router();

/* =========================================================
 * POST /lists  (protected)
 * Create a list scoped to the authenticated owner.
 * Body: { name, description?, filterGender?, filterAgeMin?, filterAgeMax? }
 * Uniqueness: @@unique([ownerId, name]) in Prisma
 * ========================================================= */
router.post('/lists', requireAuth, async (req, res, next) => {
  try {
    const { sanitizeString } = require('../lib/sanitize');
    const { name, description, filterGender, filterAgeMin, filterAgeMax } = req.body || {};
    
    // Sanitize name and description
    const sanitizedName = name ? sanitizeString(name, { maxLength: 160 }) : null;
    const sanitizedDescription = description ? sanitizeString(description, { maxLength: 400 }) : null;
    
    if (!sanitizedName) {
      return res.status(400).json({ 
        message: 'List name is required', 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Validate gender if provided
    const { normalizeGender } = require('../lib/validation');
    let normalizedGender = null;
    if (filterGender) {
      normalizedGender = normalizeGender(filterGender);
      if (!normalizedGender) {
        return res.status(400).json({ 
          message: 'Invalid gender filter. Please select: Male, Female, Other, or Prefer not to say.', 
          code: 'INVALID_GENDER' 
        });
      }
    }

    // Validate age filters
    const ageMin = filterAgeMin !== undefined && filterAgeMin !== null ? Number(filterAgeMin) : null;
    const ageMax = filterAgeMax !== undefined && filterAgeMax !== null ? Number(filterAgeMax) : null;

    if (ageMin !== null && (isNaN(ageMin) || ageMin < 0 || ageMin > 150)) {
      return res.status(400).json({ 
        message: 'Minimum age must be between 0 and 150', 
        code: 'VALIDATION_ERROR' 
      });
    }

    if (ageMax !== null && (isNaN(ageMax) || ageMax < 0 || ageMax > 150)) {
      return res.status(400).json({ 
        message: 'Maximum age must be between 0 and 150', 
        code: 'VALIDATION_ERROR' 
      });
    }

    if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
      return res.status(400).json({ 
        message: 'Minimum age cannot be greater than maximum age', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const l = await prisma.list.create({
      data: {
        ownerId: req.user.id,       // << SCOPE
        name: sanitizedName,
        description: sanitizedDescription,
        filterGender: normalizedGender,
        filterAgeMin: ageMin,
        filterAgeMax: ageMax
      }
    });

    // If filters are set, sync memberships automatically
    if (normalizedGender || ageMin !== null || ageMax !== null) {
      const { syncListMemberships } = require('../services/listSegmentation.service');
      try {
        await syncListMemberships(l.id, req.user.id);
      } catch (err) {
        // Log but don't fail list creation
        logger.warn({ listId: l.id, err: err.message }, 'Failed to sync memberships on create');
      }
    }

    res.status(201).json(l);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /lists  (protected)
 * List owner’s lists. Optional: page/pageSize/q
 * q searches by name (case-insensitive)
 * ========================================================= */
router.get('/lists', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
    const q = (req.query.q || '').toString().trim();

    // Get predefined system lists
    const { getPredefinedLists } = require('../services/predefinedLists.service');
    let predefinedLists = [];
    try {
      predefinedLists = await getPredefinedLists(req.user.id);
    } catch (error) {
      logger.error({ err: error, userId: req.user.id }, 'Error getting predefined lists');
      // Continue with empty predefined lists if there's an error
      predefinedLists = [];
    }

    // Get user-created lists from database
    const where = { ...scoped(req.user.id) };
    if (q) {where.name = { contains: q, mode: 'insensitive' };}

    const [dbItems, dbTotal] = await Promise.all([
      prisma.list.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.list.count({ where })
    ]);

    // Combine predefined lists (always shown) with user-created lists
    // Predefined lists are marked with isSystem: true
    const predefinedFormatted = predefinedLists.map(list => ({
      ...list,
      ownerId: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    const dbFormatted = dbItems.map(list => ({
      ...list,
      isSystem: false // User-created lists
    }));

    // Filter by search query if provided
    let filteredPredefined = predefinedFormatted;
    let filteredDb = dbFormatted;
    
    if (q) {
      filteredPredefined = predefinedFormatted.filter(list => 
        list.name.toLowerCase().includes(q.toLowerCase()) ||
        (list.description && list.description.toLowerCase().includes(q.toLowerCase()))
      );
      filteredDb = dbFormatted.filter(list => 
        list.name.toLowerCase().includes(q.toLowerCase()) ||
        (list.description && list.description.toLowerCase().includes(q.toLowerCase()))
      );
    }

    // For simplicity, always return all predefined lists + paginated DB lists
    // Since predefined lists are small (8-10 items), we can return them all
    const total = filteredPredefined.length + (q ? filteredDb.length : dbTotal);

    const response = { 
      items: [...filteredPredefined, ...filteredDb], 
      total, 
      page, 
      pageSize 
    };
    
    res.json(response);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /lists/:listId  (protected)
 * Fetch a single list (scoped) with match count if filters are set
 * ========================================================= */
router.get('/lists/:listId', requireAuth, async (req, res, next) => {
  try {
  const listId = Number(req.params.listId);
  if (!listId || isNaN(listId)) {
    return res.status(400).json({ 
      message: 'Invalid list ID', 
      code: 'VALIDATION_ERROR' 
    });
  }

  const list = await prisma.list.findFirst({
    where: { id: listId, ownerId: req.user.id } // << SCOPE
  });
  if (!list) {
    return res.status(404).json({ 
      message: 'List not found', 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  // If list has filters, include match count
  if (list.filterGender || list.filterAgeMin !== null || list.filterAgeMax !== null) {
    const { getListMatchCount } = require('../services/listSegmentation.service');
    try {
      const matchCount = await getListMatchCount(listId, req.user.id);
      return res.json({ ...list, matchCount });
    } catch (err) {
      // If calculation fails, return list without match count
      logger.warn({ listId: listId, err: err.message }, 'Failed to calculate match count');
    }
  }

  res.json(list);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * POST /lists/:listId/contacts/:contactId  (protected)
 * Add a contact to a list (scoped). Validates both belong to owner.
 * Idempotency: relies on @@unique([listId, contactId]) at DB level.
 * ========================================================= */
router.post('/lists/:listId/contacts/:contactId', requireAuth, async (req, res, next) => {
  const listId = Number(req.params.listId);
  const contactId = Number(req.params.contactId);
  if (!listId || !contactId || isNaN(listId) || isNaN(contactId)) {
    return res.status(400).json({ 
      message: 'Invalid list or contact ID', 
      code: 'VALIDATION_ERROR' 
    });
  }

  try {
    // Validate ownership of both resources
    const [list, contact] = await Promise.all([
      prisma.list.findFirst({ where: { id: listId, ownerId: req.user.id } }),
      prisma.contact.findFirst({ where: { id: contactId, ownerId: req.user.id } })
    ]);
    if (!list || !contact) {
      return res.status(404).json({ 
        message: 'List or contact not found', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    const m = await prisma.listMembership.create({ data: { listId, contactId } });
    res.status(201).json(m);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * DELETE /lists/:listId/contacts/:contactId  (protected)
 * Remove a contact from a list (scoped).
 * ========================================================= */
router.delete('/lists/:listId/contacts/:contactId', requireAuth, async (req, res, next) => {
  try {
  const listId = Number(req.params.listId);
  const contactId = Number(req.params.contactId);
  if (!listId || !contactId || isNaN(listId) || isNaN(contactId)) {
    return res.status(400).json({ 
      message: 'Invalid list or contact ID', 
      code: 'VALIDATION_ERROR' 
    });
  }

  // Validate list ownership
  const list = await prisma.list.findFirst({ where: { id: listId, ownerId: req.user.id } });
  if (!list) {
    return res.status(404).json({ 
      message: 'List not found', 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  await prisma.listMembership.deleteMany({ where: { listId, contactId } });
  res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /lists/:listId/contacts  (protected)
 * Get members of a list (scoped).
 * Optional filters:
 *  - isSubscribed: "true" | "false"
 *  - page/pageSize (pagination)
 * 
 * Note: If list has segmentation filters, only matching contacts are returned
 * ========================================================= */
router.get('/lists/:listId/contacts', requireAuth, async (req, res, next) => {
  try {
  const listId = Number(req.params.listId);
  if (!listId || isNaN(listId)) {
    return res.status(400).json({ 
      message: 'Invalid list ID', 
      code: 'VALIDATION_ERROR' 
    });
  }

  // Ensure the list belongs to the owner
  const list = await prisma.list.findFirst({ where: { id: listId, ownerId: req.user.id } });
  if (!list) {
    return res.status(404).json({ 
      message: 'List not found', 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
  const sub = (req.query.isSubscribed || '').toString().toLowerCase();

  // Build where for membership + contact filter
  const whereMembership = { listId };
  if (sub === 'true' || sub === 'false') {
    whereMembership.contact = { isSubscribed: sub === 'true' };
  }

  const [members, total] = await Promise.all([
    prisma.listMembership.findMany({
      where: whereMembership,
      include: { contact: true },
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.listMembership.count({
      where: whereMembership
    })
  ]);

  // map to contacts
  const items = members.map(m => m.contact).filter(Boolean);

  res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * PUT /lists/:listId  (protected)
 * Update a list including segmentation filters
 * Body: { name?, description?, filterGender?, filterAgeMin?, filterAgeMax? }
 * ========================================================= */
router.put('/lists/:listId', requireAuth, async (req, res, next) => {
  try {
    const { sanitizeString } = require('../lib/sanitize');
    const listId = Number(req.params.listId);
    if (!listId || isNaN(listId)) {
      return res.status(400).json({ 
        message: 'Invalid list ID', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const { name, description, filterGender, filterAgeMin, filterAgeMax } = req.body || {};
    const data = {};

    if (name !== undefined) {
      data.name = name ? sanitizeString(name, { maxLength: 160 }) : null;
    }
    if (description !== undefined) {
      data.description = description ? sanitizeString(description, { maxLength: 400 }) : null;
    }

    // Validate and set gender filter
    if (filterGender !== undefined) {
      const { normalizeGender } = require('../lib/validation');
      if (filterGender === null || filterGender === '') {
        data.filterGender = null;
      } else {
        const normalizedGender = normalizeGender(filterGender);
        if (!normalizedGender) {
        return res.status(400).json({ 
          message: 'Invalid gender filter. Please select: Male, Female, Other, or Prefer not to say.', 
          code: 'INVALID_GENDER' 
        });
        }
        data.filterGender = normalizedGender;
      }
    }

    // Validate and set age filters
    if (filterAgeMin !== undefined) {
      const ageMin = filterAgeMin === null ? null : Number(filterAgeMin);
      if (ageMin !== null && (isNaN(ageMin) || ageMin < 0 || ageMin > 150)) {
        return res.status(400).json({ 
          message: 'Minimum age must be between 0 and 150', 
          code: 'VALIDATION_ERROR' 
        });
      }
      data.filterAgeMin = ageMin;
    }

    if (filterAgeMax !== undefined) {
      const ageMax = filterAgeMax === null ? null : Number(filterAgeMax);
      if (ageMax !== null && (isNaN(ageMax) || ageMax < 0 || ageMax > 150)) {
        return res.status(400).json({ 
          message: 'Maximum age must be between 0 and 150', 
          code: 'VALIDATION_ERROR' 
        });
      }
      data.filterAgeMax = ageMax;
    }

    // Validate age range
    const finalAgeMin = data.filterAgeMin !== undefined ? data.filterAgeMin : null;
    const finalAgeMax = data.filterAgeMax !== undefined ? data.filterAgeMax : null;
    if (finalAgeMin !== null && finalAgeMax !== null && finalAgeMin > finalAgeMax) {
      return res.status(400).json({ 
        message: 'Minimum age cannot be greater than maximum age', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const result = await prisma.list.updateMany({
      where: { id: listId, ownerId: req.user.id },
      data
    });

    if (result.count === 0) {
      return res.status(404).json({ 
        message: 'List not found', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    // If filters changed, sync memberships
    if (data.filterGender !== undefined || data.filterAgeMin !== undefined || data.filterAgeMax !== undefined) {
      const { syncListMemberships } = require('../services/listSegmentation.service');
      try {
        await syncListMemberships(listId, req.user.id);
      } catch (err) {
        logger.warn({ listId: listId, err: err.message }, 'Failed to sync memberships on update');
      }
    }

    const updated = await prisma.list.findFirst({
      where: { id: listId, ownerId: req.user.id }
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * POST /lists/:listId/sync  (protected)
 * Manually sync list memberships based on segmentation filters
 * ========================================================= */
router.post('/lists/:listId/sync', requireAuth, async (req, res, next) => {
  try {
    const listId = Number(req.params.listId);
    if (!listId || isNaN(listId)) {
      return res.status(400).json({ 
        message: 'Invalid list ID', 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Verify list ownership
    const list = await prisma.list.findFirst({
      where: { id: listId, ownerId: req.user.id }
    });
    if (!list) {
    return res.status(404).json({ 
      message: 'List not found', 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

    const { syncListMemberships } = require('../services/listSegmentation.service');
    const result = await syncListMemberships(listId, req.user.id);

    res.json({
      ok: true,
      added: result.added,
      removed: result.removed,
      total: result.total
    });
  } catch (e) {
    // Ensure error has proper status
    if (!e.status) {e.status = 400;}
    next(e);
  }
});

module.exports = router;
