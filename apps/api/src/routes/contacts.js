// apps/api/src/routes/contacts.js
const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
// const { handleError } = require('../lib/errors'); // Unused - using next() pattern
const crypto = require('node:crypto');
const { scoped } = require('../lib/policies');
const { normalizePhoneToE164 } = require('../lib/phone');
// const { isValidPhone } = require('../lib/phone'); // Unused - kept for potential future use
const { normalizeGender, isValidBirthday, isValidEmail } = require('../lib/validation');
// const { isValidGender } = require('../lib/validation'); // Unused - kept for potential future use
const { sanitizeString, sanitizeEmail } = require('../lib/sanitize');
const pino = require('pino');
const contactImportQueue = require('../queues/contactImport.queue');
const { generateTemplateFile } = require('../services/contactImport.service');
// const { processImportJob } = require('../services/contactImport.service'); // Unused - kept for potential future use

const logger = pino({ name: 'contacts-route' });

// Rate limit helpers (Redis-backed if REDIS_URL set, else per-process memory)
const { createLimiter, rateLimitByIp, rateLimitByKey } = require('../lib/ratelimit');

const router = express.Router();

/** Create a random raw token and return its SHA-256 hex hash (for storage). */
function newUnsubTokenHash() {
  const raw = crypto.randomBytes(16).toString('hex'); // 32-char raw token
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/** Hash helper for incoming public tokens */
// function sha256Hex(s) {
//   return crypto.createHash('sha256').update(s).digest('hex');
// } // Unused - kept for potential future use

/* -------------------- Rate limiters -------------------- */
// Write ops (protected): 60 req/min per IP (covers create/update/delete)
const writeIpLimiter = createLimiter({ keyPrefix: 'rl:contacts:write:ip', points: 60, duration: 60 });

// Public unsubscribe: 20 req/min per IP
const unsubIpLimiter = createLimiter({ keyPrefix: 'rl:unsub:ip', points: 20, duration: 60 });
// Public unsubscribe per token: 5 req / 24h
const unsubTokenLimiter = createLimiter({ keyPrefix: 'rl:unsub:token', points: 5, duration: 86400 });

/**
 * POST /api/contacts
 * Create a new contact scoped to the authenticated owner
 * @param {string} phone - Phone number in E.164 format (required)
 * @param {string} email - Email address (optional, max 320 chars)
 * @param {string} firstName - First name (optional, max 120 chars)
 * @param {string} lastName - Last name (optional, max 120 chars)
 * @param {string|null} gender - Gender: 'male', 'female', 'other', 'prefer_not_to_say', or null
 * @param {string|Date} birthday - Birthday date (optional, must be in the past)
 * @returns {Contact} Created contact object
 */
router.post(
  '/contacts',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const { phone, email, firstName, lastName, gender, birthday } = req.body || {};
      if (!phone) {
        return res.status(400).json({ 
          message: 'Phone number is required', 
          code: 'VALIDATION_ERROR' 
        });
      }

      // Sanitize string inputs
      const sanitizedPhone = sanitizeString(phone, { maxLength: 20 });
      const sanitizedEmail = email ? sanitizeEmail(email) : null;
      const sanitizedFirstName = firstName ? sanitizeString(firstName, { maxLength: 120 }) : null;
      const sanitizedLastName = lastName ? sanitizeString(lastName, { maxLength: 120 }) : null;

      // Validate and normalize phone to E.164 format
      const normalizedPhone = normalizePhoneToE164(sanitizedPhone);
      if (!normalizedPhone) {
        return res.status(400).json({ 
          message: 'Invalid phone number format. Please enter a valid international phone number (e.g., +306912345678).', 
          code: 'INVALID_PHONE' 
        });
      }

      // Validate email if provided
      if (sanitizedEmail && !isValidEmail(sanitizedEmail)) {
        return res.status(400).json({ 
          message: 'Invalid email address format. Please enter a valid email address.', 
          code: 'INVALID_EMAIL' 
        });
      }

      // Validate gender if provided
      let normalizedGender = null;
      if (gender) {
        normalizedGender = normalizeGender(gender);
        if (!normalizedGender) {
          return res.status(400).json({ 
            message: 'Invalid gender value. Please select: Male, Female, Other, or Prefer not to say.', 
            code: 'INVALID_GENDER' 
          });
        }
      }

      // Validate birthday if provided
      let birthdayDate = null;
      if (birthday) {
        if (!isValidBirthday(birthday)) {
          return res.status(400).json({ 
            message: 'Invalid birthday. Please enter a valid date in the past.', 
            code: 'INVALID_BIRTHDAY' 
          });
        }
        birthdayDate = birthday instanceof Date ? birthday : new Date(birthday);
      }

      // Prepare unsubscribe token hash if absent; we don't return raw token here.
      const { hash } = newUnsubTokenHash();

      const contact = await prisma.contact.create({
        data: {
          ownerId: req.user.id,                 // <-- SCOPE
          phone: normalizedPhone,               // E.164 format
          email: sanitizedEmail,
          firstName: sanitizedFirstName,
          lastName: sanitizedLastName,
          gender: normalizedGender,
          birthday: birthdayDate,
          isSubscribed: true,                  // New contacts are subscribed by default
          unsubscribeTokenHash: hash            // store only the hash (raw can be rotated later)
        }
      });

      // Trigger welcome automation (non-blocking, fire and forget)
      const { triggerWelcomeAutomation } = require('../services/automation.service');
      triggerWelcomeAutomation(req.user.id, contact).catch(err => {
        // Log but don't fail contact creation
        logger.error({ 
          contactId: contact.id, 
          isSubscribed: contact.isSubscribed,
          ownerId: req.user.id,
          err: err.message,
          stack: err.stack 
        }, 'Welcome automation failed');
      });

      res.status(201).json(contact);
    } catch (e) {
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * GET /contacts  (protected)
 * List contacts (paginated + search).
 * --------------------------------------------------------- */
router.get('/contacts', requireAuth, async (req, res, next) => {
  try {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
  const q = (req.query.q || '').toString().trim();
  const sub = (req.query.isSubscribed || '').toString().toLowerCase();
  const listIdRaw = req.query.listId ? String(req.query.listId) : null;

  const where = { ...scoped(req.user.id) };

  // If listId is provided, filter by list membership
  if (listIdRaw) {
    // Check if it's a predefined (virtual) list (string IDs like "gender_male", "age_18_24", "all")
    if (listIdRaw.startsWith('gender_') || listIdRaw.startsWith('age_') || listIdRaw === 'all') {
      // Predefined list - get ALL contacts first (we'll filter and paginate in memory)
      const { getPredefinedListContacts } = require('../services/predefinedLists.service');
      // Get all contacts (use a large pageSize to get all, then filter)
      const result = await getPredefinedListContacts(listIdRaw, req.user.id, 1, 10000);
      
      // Apply search filter if provided (BEFORE pagination)
      let filteredItems = result.items;
      if (q) {
        filteredItems = filteredItems.filter(contact => {
          const searchLower = q.toLowerCase();
          return (
            (contact.phone && contact.phone.toLowerCase().includes(searchLower)) ||
            (contact.email && contact.email.toLowerCase().includes(searchLower)) ||
            (contact.firstName && contact.firstName.toLowerCase().includes(searchLower)) ||
            (contact.lastName && contact.lastName.toLowerCase().includes(searchLower))
          );
        });
      }
      
      // Apply subscribed filter if provided (BEFORE pagination)
      if (sub === 'true') {
        filteredItems = filteredItems.filter(c => c.isSubscribed);
      } else if (sub === 'false') {
        filteredItems = filteredItems.filter(c => !c.isSubscribed);
      }
      
      // Now paginate the filtered results
      const total = filteredItems.length;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const paginatedItems = filteredItems.slice(start, end);
      
      return res.json({
        items: paginatedItems,
        total,
        page,
        pageSize
      });
    } else {
      // Database list - validate list ownership
      const listIdNum = Number(listIdRaw);
      if (isNaN(listIdNum)) {
        return res.status(400).json({ 
          message: 'Invalid list ID', 
          code: 'VALIDATION_ERROR' 
        });
      }
      
      const list = await prisma.list.findFirst({
        where: { id: listIdNum, ownerId: req.user.id }
      });
      if (!list) {
        return res.status(404).json({ 
          message: 'List not found', 
          code: 'RESOURCE_NOT_FOUND' 
        });
      }

      // If list has filters, use dynamic segmentation
      if (list.filterGender || list.filterAgeMin !== null || list.filterAgeMax !== null) {
        const { getContactsMatchingFilters } = require('../services/listSegmentation.service');
        const matchingContactIds = await getContactsMatchingFilters(listIdNum, req.user.id);
        if (matchingContactIds.length === 0) {
          return res.json({ items: [], total: 0, page, pageSize });
        }
        where.id = { in: matchingContactIds };
      } else {
        // If no filters, use list memberships
        const memberships = await prisma.listMembership.findMany({
          where: { listId: listIdNum },
          select: { contactId: true }
        });
        const contactIds = memberships.map(m => m.contactId);
        if (contactIds.length === 0) {
          return res.json({ items: [], total: 0, page, pageSize });
        }
        where.id = { in: contactIds };
      }
    }
  }

  if (q) {
    where.OR = [
      { phone: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
    ];
  }

  if (sub === 'true') {where.isSubscribed = true;}
  if (sub === 'false') {where.isSubscribed = false;}

  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.contact.count({ where })
  ]);

  res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/* ---------------------------------------------------------
 * GET /contacts/:id  (protected)
 * Fetch one contact scoped to owner.
 * --------------------------------------------------------- */
router.get('/contacts/:id', requireAuth, async (req, res, next) => {
  try {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: 'Invalid contact ID', 
      code: 'VALIDATION_ERROR' 
    });
  }

  const contact = await prisma.contact.findFirst({
    where: { id, ownerId: req.user.id } // SCOPE
  });

  if (!contact) {
    return res.status(404).json({ 
      message: 'Contact not found', 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }
  res.json(contact);
  } catch (e) {
    next(e);
  }
});

/* ---------------------------------------------------------
 * PUT /contacts/:id  (protected)
 * Update a contact (scoped).
 * --------------------------------------------------------- */
router.put(
  '/contacts/:id',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: 'Invalid contact ID', 
      code: 'VALIDATION_ERROR' 
    });
  }

      const { phone, email, firstName, lastName, gender, birthday, isSubscribed } = req.body || {};
      const data = {};

      if (phone !== undefined) {
        const sanitizedPhone = sanitizeString(phone, { maxLength: 20 });
        const normalizedPhone = normalizePhoneToE164(sanitizedPhone);
        if (!normalizedPhone) {
          return res.status(400).json({ 
            message: 'Invalid phone number format. Please enter a valid international phone number (e.g., +306912345678).', 
            code: 'INVALID_PHONE' 
          });
        }
        data.phone = normalizedPhone;
      }

      if (email !== undefined) {
        const sanitizedEmail = email ? sanitizeEmail(email) : null;
        if (email && !sanitizedEmail) {
          return res.status(400).json({ 
            message: 'Invalid email address format. Please enter a valid email address.', 
            code: 'INVALID_EMAIL' 
          });
        }
        data.email = sanitizedEmail;
      }

      if (firstName !== undefined) {
        data.firstName = firstName ? sanitizeString(firstName, { maxLength: 120 }) : null;
      }
      if (lastName !== undefined) {
        data.lastName = lastName ? sanitizeString(lastName, { maxLength: 120 }) : null;
      }

      if (gender !== undefined) {
        if (gender === null || gender === '') {
          data.gender = null;
        } else {
          const normalizedGender = normalizeGender(gender);
          if (!normalizedGender) {
            return res.status(400).json({ 
              message: 'Invalid gender value. Please select: Male, Female, Other, or Prefer not to say.', 
              code: 'INVALID_GENDER' 
            });
          }
          data.gender = normalizedGender;
        }
      }

      if (birthday !== undefined) {
        if (birthday === null || birthday === '') {
          data.birthday = null;
        } else {
          if (!isValidBirthday(birthday)) {
            return res.status(400).json({ 
              message: 'Invalid birthday. Please enter a valid date in the past.', 
              code: 'VALIDATION_ERROR' 
            });
          }
          data.birthday = birthday instanceof Date ? birthday : new Date(birthday);
        }
      }

      // Optional allow toggling isSubscribed from admin
      if (isSubscribed !== undefined) {
        data.isSubscribed = Boolean(isSubscribed);
        if (data.isSubscribed === false) {
          data.unsubscribedAt = new Date(); // mark time when admin unsubscribes
        } else {
          data.unsubscribedAt = null;
        }
      }

      const r = await prisma.contact.updateMany({
        where: { id, ownerId: req.user.id },  // SCOPE
        data
      });

      if (r.count === 0) {
        return res.status(404).json({ 
          message: 'Contact not found', 
          code: 'RESOURCE_NOT_FOUND' 
        });
      }

      const updated = await prisma.contact.findFirst({
        where: { id, ownerId: req.user.id }
      });

      res.json(updated);
    } catch (e) {
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * DELETE /contacts/:id  (protected)
 * Safe delete via deleteMany with owner scope.
 * --------------------------------------------------------- */
router.delete(
  '/contacts/:id',
  requireAuth,
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: 'Invalid contact ID', 
      code: 'VALIDATION_ERROR' 
    });
  }

      const r = await prisma.contact.deleteMany({
        where: { id, ownerId: req.user.id } // SCOPE
      });

      if (r.count === 0) {
        return res.status(404).json({ 
          message: 'Contact not found', 
          code: 'RESOURCE_NOT_FOUND' 
        });
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * POST /contacts/unsubscribe  (public)
 * Body: { token: "<unsubscribe token>" } or token in URL
 * Token encodes contactId and storeId - unsubscribe is scoped to store
 * Idempotent: always returns success to avoid leaking existence.
 * --------------------------------------------------------- */
router.post(
  '/contacts/unsubscribe',
  rateLimitByIp(unsubIpLimiter),
  rateLimitByKey(unsubTokenLimiter, (req) => {
    const token = req.body?.token || req.params?.token || '';
    return token.slice(0, 64);
  }),
  async (req, res, next) => {
    try {
      const { token } = req.body || req.params || {};
      if (!token) {
        return res.status(400).json({ 
          message: 'Token is required', 
          code: 'VALIDATION_ERROR' 
        });
      }

      // Verify and decode token
      const { verifyUnsubscribeToken } = require('../services/token.service');
      const decoded = verifyUnsubscribeToken(token);

      if (!decoded) {
        // Invalid or expired token - return generic error
        return res.status(400).json({ 
          message: 'This unsubscribe link is no longer valid. Please contact the store or try again from a more recent message.',
          code: 'INVALID_TOKEN'
        });
      }

      const { contactId, storeId } = decoded;

      // Find contact and verify it belongs to the store
      const contact = await prisma.contact.findFirst({
        where: { 
          id: contactId,
          ownerId: storeId,
          isSubscribed: true 
        },
        include: {
          owner: {
            select: {
              id: true,
              company: true,
              senderName: true
            }
          }
        }
      });

      if (!contact) {
        // Contact not found or already unsubscribed - return success (idempotent)
        return res.json({ 
          ok: true,
          message: 'You are already unsubscribed or this link is no longer valid.'
        });
      }

      // Unsubscribe contact (scoped to this store only)
      await prisma.contact.update({
        where: { id: contact.id },
        data: { 
          isSubscribed: false, 
          unsubscribedAt: new Date() 
        }
      });

      const storeName = contact.owner.company || contact.owner.senderName || 'this store';

      res.json({ 
        ok: true,
        message: `You are now unsubscribed from SMS messages for ${storeName}.`,
        storeName
      });
    } catch (e) {
      // Ensure error has proper status for public endpoint
      if (!e.status) {e.status = 400;}
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * GET /contacts/unsubscribe/:token  (public)
 * Alternative route for unsubscribe via URL token
 * --------------------------------------------------------- */
router.get(
  '/contacts/unsubscribe/:token',
  rateLimitByIp(unsubIpLimiter),
  rateLimitByKey(unsubTokenLimiter, (req) => {
    const token = req.params?.token || '';
    return token.slice(0, 64);
  }),
  async (req, res, next) => {
    // Redirect to POST handler logic (or return JSON for API)
    try {
      const { token } = req.params;
      if (!token) {
        return res.status(400).json({ 
          message: 'Token is required', 
          code: 'VALIDATION_ERROR' 
        });
      }

      // Verify token and get store info for display
      const { verifyUnsubscribeToken } = require('../services/token.service');
      const decoded = verifyUnsubscribeToken(token);

      if (!decoded) {
        return res.status(400).json({ 
          message: 'This unsubscribe link is no longer valid. Please contact the store or try again from a more recent message.',
          code: 'INVALID_TOKEN'
        });
      }

      const { contactId, storeId } = decoded;

      // Get contact and store info
      const contact = await prisma.contact.findFirst({
        where: { 
          id: contactId,
          ownerId: storeId
        },
        include: {
          owner: {
            select: {
              id: true,
              company: true,
              senderName: true
            }
          }
        }
      });

      if (!contact) {
        return res.status(404).json({ 
          message: 'Contact not found',
          code: 'NOT_FOUND'
        });
      }

      const storeName = contact.owner.company || contact.owner.senderName || 'this store';

      // Return info for frontend to display (frontend will handle actual unsubscribe)
      res.json({
        ok: true,
        token,
        contactId,
        storeId,
        storeName,
        isSubscribed: contact.isSubscribed,
        message: contact.isSubscribed 
          ? `You are subscribed to SMS messages from ${storeName}.`
          : `You are already unsubscribed from ${storeName}.`
      });
    } catch (e) {
      // Ensure error has proper status for public endpoint
      if (!e.status) {e.status = 400;}
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * POST /contacts/import  (protected)
 * Upload Excel file and create import job
 * --------------------------------------------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Only accept .xlsx files
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'), false);
    }
  },
});

router.post(
  '/contacts/import',
  requireAuth,
  upload.single('file'),
  rateLimitByIp(writeIpLimiter),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          message: 'No file uploaded', 
          code: 'VALIDATION_ERROR' 
        });
      }

      if (!contactImportQueue) {
        return res.status(503).json({ 
          message: 'Import service is currently unavailable', 
          code: 'SERVICE_UNAVAILABLE' 
        });
      }

      // Create import job
      const job = await contactImportQueue.add(
        'importContacts',
        {
          userId: req.user.id,
          fileBuffer: req.file.buffer,
          options: {
            skipDuplicates: true, // Always skip duplicates per user requirement
          },
        },
        {
          attempts: 1, // Don't retry on failure (user can re-upload)
        }
      );

      logger.info({ userId: req.user.id, jobId: job.id }, 'Contact import job created');

      res.status(202).json({
        jobId: job.id,
        status: 'pending',
        message: 'Import job created successfully',
      });
    } catch (e) {
      next(e);
    }
  }
);

/* ---------------------------------------------------------
 * GET /contacts/import/:jobId  (protected)
 * Get import job status and results
 * --------------------------------------------------------- */
router.get('/contacts/import/:jobId', requireAuth, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    if (!contactImportQueue) {
      return res.status(503).json({ 
        message: 'Import service is currently unavailable', 
        code: 'SERVICE_UNAVAILABLE' 
      });
    }

    const job = await contactImportQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ 
        message: 'Import job not found', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    // Verify job belongs to user
    if (job.data.userId !== userId) {
      return res.status(403).json({ 
        message: 'Access denied', 
        code: 'AUTHORIZATION_ERROR' 
      });
    }

    const state = await job.getState();
    const progress = job.progress || { processed: 0, total: 0 };
    const result = job.returnvalue || null;
    const failedReason = job.failedReason || null;

    const response = {
      jobId: job.id,
      status: state,
      progress: {
        processed: progress.processed || 0,
        total: progress.total || 0,
      },
    };

    if (state === 'completed' && result) {
      response.results = {
        created: result.created || 0,
        skipped: result.skipped || 0,
        errors: result.errors || [],
      };
    } else if (state === 'failed') {
      response.error = failedReason || 'Import job failed';
    }

    res.json(response);
  } catch (e) {
    next(e);
  }
});

/* ---------------------------------------------------------
 * GET /contacts/import/template  (protected)
 * Download sample Excel template file
 * --------------------------------------------------------- */
router.get('/contacts/import/template', requireAuth, async (req, res, next) => {
  try {
    const templateBuffer = generateTemplateFile();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts_template.xlsx"');
    res.setHeader('Content-Length', templateBuffer.length);

    res.send(templateBuffer);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
