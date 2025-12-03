// apps/api/src/routes/campaigns.js
const express = require("express");
const prisma = require("../lib/prisma");
const requireAuth = require("../middleware/requireAuth");
const schedulerQueue = require("../queues/scheduler.queue");
const { enqueueCampaign } = require("../services/campaignEnqueue.service");
// const { handleError } = require("../lib/errors"); // Unused - using next() pattern
const { render } = require('../lib/template');
const pino = require('pino');

const router = express.Router();
const logger = pino({ name: 'campaigns-route' });

const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);
function msUntil(dateStr) {
  const when = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, when - now);
}

/* =========================================================
 * POST /campaigns (protected)
 * Create a campaign (draft or scheduled).
 * - Validates ownership of template (owner or system) & list (owner).
 * - Pre-computes total = subscribed members count at creation time.
 * - If scheduledAt provided -> status 'scheduled' + delayed job.
 * ========================================================= */
/**
 * POST /api/campaigns
 * Create a new campaign with optional filters and scheduling
 * @param {string} name - Campaign name (required, max 200 chars)
 * @param {number} templateId - Template ID (required)
 * @param {string|null} filterGender - Gender filter: 'male', 'female', 'other', 'prefer_not_to_say', or null
 * @param {string|null} filterAgeGroup - Age group filter: '18_24', '25_39', '40_plus', or null
 * @param {string|null} scheduledAt - ISO date string for scheduled campaigns
 * @returns {Campaign} Created campaign object
 */
/**
 * Convert local date/time in a specific timezone to UTC
 * @param {string} dateStr - Date string in format "YYYY-MM-DD"
 * @param {string} timeStr - Time string in format "HH:mm"
 * @param {string} timezone - IANA timezone (e.g. "Europe/Athens")
 * @returns {Date|null} UTC Date object or null if invalid
 */
function convertLocalToUTC(dateStr, timeStr, timezone) {
  if (!dateStr || !timeStr || !timezone) {
    return null;
  }
  
  try {
    // Parse date and time components
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    
    // Method: We need to find the UTC time that, when displayed in the target timezone,
    // equals the desired local time (year-month-day hour:minute).
    // 
    // Strategy: Use iterative approach to find the correct UTC time.
    // We'll start with a guess and adjust based on the difference.
    
    // Start with a reasonable guess: treat the local time as if it were UTC
    // Then we'll adjust based on the timezone offset
    let guessUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    
    // Create formatter for the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    
    // Iteratively adjust until we find the correct UTC time
    // (This should converge quickly, usually 1-2 iterations)
    for (let i = 0; i < 5; i++) {
      // Format the guess UTC time in the target timezone
      const parts = formatter.formatToParts(guessUTC);
      const tzYear = parseInt(parts.find(p => p.type === 'year')?.value || '0');
      const tzMonth = parseInt(parts.find(p => p.type === 'month')?.value || '0');
      const tzDay = parseInt(parts.find(p => p.type === 'day')?.value || '0');
      const tzHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      const tzMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
      
      // Check if we've found the correct time
      if (tzYear === year && tzMonth === month && tzDay === day && 
          tzHour === hour && tzMinute === minute) {
        return guessUTC;
      }
      
      // Calculate the difference: what we want vs what we got
      // We want: year-month-day hour:minute in the timezone
      // We got: tzYear-tzMonth-tzDay tzHour:tzMinute in the timezone
      // The difference in milliseconds between these two "local times" (as if they were UTC)
      const desiredLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0);
      const actualLocalMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0);
      const diffMs = desiredLocalMs - actualLocalMs;
      
      // Adjust the UTC guess by the difference
      guessUTC = new Date(guessUTC.getTime() + diffMs);
    }
    
    // Final check: format one more time to verify
    const finalParts = formatter.formatToParts(guessUTC);
    const finalYear = parseInt(finalParts.find(p => p.type === 'year')?.value || '0');
    const finalMonth = parseInt(finalParts.find(p => p.type === 'month')?.value || '0');
    const finalDay = parseInt(finalParts.find(p => p.type === 'day')?.value || '0');
    const finalHour = parseInt(finalParts.find(p => p.type === 'hour')?.value || '0');
    const finalMinute = parseInt(finalParts.find(p => p.type === 'minute')?.value || '0');
    
    if (finalYear === year && finalMonth === month && finalDay === day && 
        finalHour === hour && finalMinute === minute) {
      return guessUTC;
    }
    
    // If we didn't converge, return null (shouldn't happen in practice)
    return null;
  } catch (err) {
    return null;
  }
}

router.post("/campaigns", requireAuth, async (req, res, next) => {
  try {
    const { sanitizeString } = require('../lib/sanitize');
    const { name, templateId, messageText, filterGender, filterAgeGroup, scheduledAt, scheduledDate, scheduledTime } = req.body || {};
    
    // Sanitize name
    const sanitizedName = name ? sanitizeString(name, { maxLength: 200 }) : null;
    
    // Validate required fields
    if (!sanitizedName) {
      return res.status(400).json({ 
        message: "Campaign name is required", 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Validate messageText is provided if no templateId
    if (!templateId && !messageText) {
      return res.status(400).json({ 
        message: "Please provide either a template or a custom message", 
        code: 'VALIDATION_ERROR' 
      });
    }

    let templateIdNum = null;
    let tpl = null;

    // If templateId is provided, validate it
    if (templateId) {
      templateIdNum = Number(templateId);
      if (!templateIdNum || isNaN(templateIdNum)) {
        return res.status(400).json({ 
          message: "Invalid template ID", 
          code: 'VALIDATION_ERROR' 
        });
      }

      // Validate template (system or owner)
      tpl = await prisma.messageTemplate.findFirst({
        where: {
          id: templateIdNum,
          ownerId: { in: [req.user.id, SYSTEM_USER_ID] },
        },
      });
      if (!tpl) {
        return res.status(404).json({ 
          message: "Template not found", 
          code: 'RESOURCE_NOT_FOUND' 
        });
      }
    } else {
      // If no templateId but messageText is provided, find or create a default "Custom Message" template
      // First, try to find an existing "Custom Message" template for this user
      tpl = await prisma.messageTemplate.findFirst({
        where: {
          ownerId: req.user.id,
          name: "Custom Message",
        },
      });

      // If not found, create a default template for this user
      if (!tpl) {
        tpl = await prisma.messageTemplate.create({
          data: {
            ownerId: req.user.id,
            name: "Custom Message",
            text: messageText?.trim() || "Custom message",
            category: "generic",
            language: "en",
          },
        });
      }
      templateIdNum = tpl.id;
    }

    // Sanitize and validate messageText (optional, overrides template text if provided)
    const sanitizedMessageText = messageText && messageText.trim() 
      ? sanitizeString(messageText, { maxLength: 2000 }) 
      : null;

    // Validate and normalize filters
    const { normalizeGender, normalizeAgeGroup } = require('../lib/validation');
    let normalizedGender = null;
    if (filterGender) {
      normalizedGender = normalizeGender(filterGender);
      if (filterGender && !normalizedGender) {
        return res.status(400).json({ 
          message: "Invalid gender filter. Please select: Male, Female, Other, or Prefer not to say.", 
          code: 'INVALID_GENDER' 
        });
      }
    }

    let normalizedAgeGroup = null;
    if (filterAgeGroup) {
      normalizedAgeGroup = normalizeAgeGroup(filterAgeGroup);
      if (filterAgeGroup && !normalizedAgeGroup) {
        return res.status(400).json({ 
          message: "Invalid age group filter. Please select a valid age group.", 
          code: 'VALIDATION_ERROR' 
        });
      }
    }

    // Count audience size (for total)
    const { countAudience } = require('../services/audience.service');
    const total = await countAudience(req.user.id, normalizedGender, normalizedAgeGroup);

    // Handle scheduling: support both old format (scheduledAt UTC ISO) and new format (scheduledDate + scheduledTime in user's timezone)
    let scheduledAtDate = null;
    let initialStatus = "draft";
    
    if (scheduledDate && scheduledTime) {
      // New format: local date/time - backend converts to UTC using user's timezone
      // Get user's timezone from database
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { timezone: true }
      });
      
      const userTimezone = user?.timezone || 'UTC';
      
      // Convert local date/time to UTC
      scheduledAtDate = convertLocalToUTC(scheduledDate, scheduledTime, userTimezone);
      
      if (!scheduledAtDate || isNaN(scheduledAtDate.getTime())) {
        return res.status(400).json({ 
          message: "Invalid scheduled date or time. Please provide valid date (YYYY-MM-DD) and time (HH:mm) in your configured timezone.", 
          code: 'VALIDATION_ERROR'
        });
      }
      
      initialStatus = "scheduled";
    } else if (scheduledAt) {
      // Legacy format: UTC ISO string (for backward compatibility)
      scheduledAtDate = new Date(scheduledAt);
      if (isNaN(scheduledAtDate.getTime())) {
        return res.status(400).json({ 
          message: "Invalid scheduled date. Please provide a valid date and time.", 
          code: 'INVALID_DATE' 
        });
      }
      initialStatus = "scheduled";
    }
    
    // Validate scheduledAt is in the future (if provided)
    if (scheduledAtDate) {
      const now = new Date();
      if (scheduledAtDate <= now) {
        return res.status(400).json({ 
          message: "Scheduled time must be in the future. Cannot schedule campaigns in the past.", 
          code: 'VALIDATION_ERROR' 
        });
      }
      
      // Ensure it's stored as UTC
      scheduledAtDate = new Date(scheduledAtDate.toISOString());
    }

    // Map normalized age group to Prisma enum
    const { mapAgeGroupToPrisma } = require('../lib/routeHelpers');
    const prismaAgeGroup = mapAgeGroupToPrisma(normalizedAgeGroup);

    const campaign = await prisma.campaign.create({
      data: {
        ownerId: req.user.id,
        name: sanitizedName,
        templateId: templateIdNum,
        messageText: sanitizedMessageText, // Optional custom message text (overrides template)
        listId: null, // No longer using lists for segmentation
        filterGender: normalizedGender,
        filterAgeGroup: prismaAgeGroup,
        status: initialStatus,
        scheduledAt: scheduledAtDate,
        createdById: req.user.id,
        total,
      },
      include: { template: true },
    });

    // If scheduled -> add delayed scheduler job
    if (campaign.status === "scheduled" && schedulerQueue) {
      const delay = msUntil(campaign.scheduledAt);
      const now = new Date();
      
      if (delay <= 0) {
        logger.warn({ 
          campaignId: campaign.id, 
          scheduledAt: campaign.scheduledAt,
          now: now.toISOString(),
          delay 
        }, 'Scheduled campaign is in the past, enqueuing immediately');
        
        // If scheduled time has passed, enqueue immediately
        try {
          const { enqueueCampaign } = require("../services/campaignEnqueue.service");
          await enqueueCampaign(campaign.id);
        } catch (err) {
          logger.error({ campaignId: campaign.id, err }, 'Failed to enqueue past-due campaign');
        }
      } else {
        logger.info({ 
          campaignId: campaign.id, 
          scheduledAt: campaign.scheduledAt,
          delayMs: delay,
          delaySeconds: Math.round(delay / 1000),
          delayMinutes: Math.round(delay / 1000 / 60)
        }, 'Adding scheduled campaign job to queue');
        
        const job = await schedulerQueue.add(
          "enqueueCampaign",
          { campaignId: campaign.id },
          { 
            jobId: `campaign:schedule:${campaign.id}`, 
            delay 
          }
        );
        
        logger.info({ 
          campaignId: campaign.id, 
          jobId: job.id,
          scheduledAt: campaign.scheduledAt
        }, 'Scheduled campaign job added to queue');
      }
    } else if (campaign.status === "scheduled" && !schedulerQueue) {
      logger.warn({ campaignId: campaign.id }, 'Scheduler queue is disabled, cannot schedule campaign');
    }

    // Map Prisma enum back to normalized format for API response
    const { mapAgeGroupToApi } = require('../lib/routeHelpers');
    const response = { ...campaign };
    response.filterAgeGroup = mapAgeGroupToApi(campaign.filterAgeGroup);

    res.status(201).json(response);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /campaigns (protected)
 * Paginated list of campaigns (scoped).
 * Query: page (default 1), pageSize (default 20, max 100)
 * ========================================================= */
router.get("/campaigns", requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      prisma.campaign.findMany({
        where: { ownerId: req.user.id },
        take: pageSize,
        skip,
        orderBy: { id: "desc" },
        include: { template: true, list: true },
      }),
      prisma.campaign.count({ where: { ownerId: req.user.id } }),
    ]);

    // Map Prisma enum back to normalized format for API response
    const { mapAgeGroupToApi } = require('../lib/routeHelpers');
    const mappedItems = items.map(campaign => ({
      ...campaign,
      filterAgeGroup: mapAgeGroupToApi(campaign.filterAgeGroup)
    }));

    res.json({ items: mappedItems, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /campaigns/stats?ids=1,2,3 (protected)
 * Get stats for multiple campaigns (scoped).
 * ========================================================= */
router.get("/campaigns/stats", requireAuth, async (req, res, next) => {
  try {
    const { getManyCampaignsStats } = require('../services/campaignStats.service');
    const ownerId = req.user.id;
    const ids = (req.query.ids || '').toString()
      .split(',').map(x => Number(x.trim())).filter(x => x && !isNaN(x));

    if (!ids.length) {
      return res.json([]);
    }

    const arr = await getManyCampaignsStats(ids, ownerId);
    res.json(arr);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /campaigns/:id (protected)
 * Fetch one campaign (scoped).
 * ========================================================= */
router.get("/campaigns/:id", requireAuth, async (req, res, next) => {
  try {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: "Invalid campaign ID", 
      code: 'VALIDATION_ERROR' 
    });
  }

  const c = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
    include: { template: true, list: true },
  });
  if (!c) {
    return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  // Map Prisma enum back to normalized format for API response
  const { mapAgeGroupToApi } = require('../lib/routeHelpers');
  const response = { ...c, filterAgeGroup: mapAgeGroupToApi(c.filterAgeGroup) };
  res.json(response);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * POST /campaigns/preview-audience (protected)
 * Preview audience based on filters (for campaign creation UI)
 * Query params: filterGender, filterAgeGroup, nameSearch (optional)
 * Returns: count and sample contacts
 * ========================================================= */
router.post("/campaigns/preview-audience", requireAuth, async (req, res, next) => {
  try {
    const { filterGender, filterAgeGroup, nameSearch } = req.body || {};
    
    const { normalizeGender, normalizeAgeGroup } = require('../lib/validation');
    let normalizedGender = null;
    // Handle both null and undefined as "Any" (no filter)
    if (filterGender !== null && filterGender !== undefined) {
      normalizedGender = normalizeGender(filterGender);
      if (!normalizedGender) {
        return res.status(400).json({ 
          message: "Invalid gender filter. Please select: Male, Female, Other, or Prefer not to say.", 
          code: 'INVALID_GENDER' 
        });
      }
    }

    let normalizedAgeGroup = null;
    // Handle both null and undefined as "Any" (no filter)
    if (filterAgeGroup !== null && filterAgeGroup !== undefined) {
      normalizedAgeGroup = normalizeAgeGroup(filterAgeGroup);
      if (!normalizedAgeGroup) {
        return res.status(400).json({ 
          message: "Invalid age group filter. Please select a valid age group.", 
          code: 'VALIDATION_ERROR' 
        });
      }
    }

    const { buildAudience, countAudience } = require('../services/audience.service');
    
    const count = await countAudience(req.user.id, normalizedGender, normalizedAgeGroup, nameSearch);
    const sample = await buildAudience(req.user.id, normalizedGender, normalizedAgeGroup, nameSearch);
    
    // Return first 10 for preview
    const preview = sample.slice(0, 10).map(contact => ({
      id: contact.id,
      phone: contact.phone,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      gender: contact.gender,
      birthday: contact.birthday
    }));

    res.json({
      count,
      preview,
      hasMore: count > 10
    });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /campaigns/:id/preview (protected)
 * Return first 10 rendered messages for preview (scoped).
 * Only for subscribed contacts at the time of preview.
 * ========================================================= */
router.get("/campaigns/:id/preview", requireAuth, async (req, res, next) => {
  try {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: "Invalid campaign ID", 
      code: 'VALIDATION_ERROR' 
    });
  }

  const c = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
    include: { template: true },
  });
  if (!c) {
    return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  // Build audience based on filters or legacy listId
  let contacts = [];
  
  // Use new system-defined segmentation (allows both filters to be null = all eligible contacts)
  if (c.filterGender !== null || c.filterAgeGroup !== null || c.listId === null) {
    const { buildAudience } = require('../services/audience.service');
    
    // Map Prisma enum back to normalized format
    const { mapAgeGroupToApi } = require('../lib/routeHelpers');
    const ageGroup = mapAgeGroupToApi(c.filterAgeGroup);
    
    contacts = await buildAudience(c.ownerId, c.filterGender, ageGroup, null);
  } else if (c.listId) {
    // Legacy: use list memberships (only if filters are not set and listId exists)
    const members = await prisma.listMembership.findMany({
      where: { listId: c.listId, contact: { isSubscribed: true } },
      include: { contact: true },
      take: 10,
    });
    contacts = members.map(m => m.contact);
  } else {
    return res.status(400).json({ 
      message: "Campaign must have either a target list or filters defined.", 
      code: 'VALIDATION_ERROR' 
    });
  }

  // Use custom messageText if provided, otherwise use template text
  const messageTemplate = c.messageText || c.template?.text || '';
  
  const sample = contacts.slice(0, 10).map((contact) => ({
    to: contact.phone,
    text: render(messageTemplate, contact),
  }));

  res.json({ sample, count: contacts.length });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * POST /campaigns/:id/enqueue (protected)
 * Manual enqueue using service (idempotent, scoped).
 * ========================================================= */
router.post("/campaigns/:id/enqueue", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: "Invalid campaign ID. Please provide a valid campaign ID.", 
      code: 'INVALID_ID' 
    });
  }

    const camp = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id },
    });
    if (!camp) {
    return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

    const result = await enqueueCampaign(id);
    if (!result.ok) {
      // map reasons -> proper responses
      if (result.reason?.startsWith("invalid_status")) {
        return res.status(409).json({ 
          message: result.reason || 'Campaign cannot be sent in its current state', 
          code: 'INVALID_STATUS' 
        });
      }
      if (result.reason === "no_recipients") {
        return res.status(400).json({ 
          message: "Campaign has no eligible recipients. Make sure contacts are subscribed and match the selected filters.", 
          code: 'NO_RECIPIENTS' 
        });
      }
      if (result.reason === "already_sending") {
        return res.status(409).json({ 
          message: "Campaign is already being sent", 
          code: 'ALREADY_SENDING' 
        });
      }
      if (result.reason === "not_found") {
        return res.status(404).json({ 
          message: "Campaign not found", 
          code: 'RESOURCE_NOT_FOUND' 
        });
      }
      if (result.reason === "insufficient_credits") {
        return res.status(402).json({ 
          message: "You don't have enough SMS credits to send this campaign. Please purchase additional credits and try again.",
          code: "INSUFFICIENT_CREDITS"
        });
      }
      if (result.reason === "no_filters_or_list") {
        return res.status(400).json({ 
          message: "Campaign has no target audience defined. Please add filters or select a list.", 
          code: 'NO_TARGET_AUDIENCE' 
        });
      }
      return res.status(400).json({ 
        message: result.reason || "Cannot send campaign at this time", 
        code: 'CAMPAIGN_ENQUEUE_ERROR' 
      });
    }

    res.json({ queued: result.created, enqueuedJobs: result.enqueuedJobs });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * POST /campaigns/:id/schedule (protected)
 * Set or change scheduledAt and create/update delayed job (scoped).
 * Body: { scheduledAt }
 * ========================================================= */
router.post("/campaigns/:id/schedule", requireAuth, async (req, res, next) => {
  try {
  const id = Number(req.params.id);
  const { scheduledAt, scheduledDate, scheduledTime } = req.body || {};
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: "Invalid campaign ID", 
      code: 'VALIDATION_ERROR' 
    });
  }
  
  let scheduledAtDate = null;
  
  if (scheduledDate && scheduledTime) {
    // New format: local date/time - backend converts to UTC using user's timezone
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { timezone: true }
    });
    
    const userTimezone = user?.timezone || 'UTC';
    scheduledAtDate = convertLocalToUTC(scheduledDate, scheduledTime, userTimezone);
    
    if (!scheduledAtDate || isNaN(scheduledAtDate.getTime())) {
      return res.status(400).json({ 
        message: "invalid scheduledDate or scheduledTime. Please provide valid date (YYYY-MM-DD) and time (HH:mm) in your configured timezone." 
      });
    }
  } else if (scheduledAt) {
    // Legacy format: UTC ISO string (for backward compatibility)
    scheduledAtDate = new Date(scheduledAt);
    if (isNaN(scheduledAtDate.getTime())) {
      return res.status(400).json({ 
        message: "Invalid scheduled date or time", 
        code: 'VALIDATION_ERROR' 
      });
    }
  } else {
      return res.status(400).json({ 
        message: "Scheduled time is required. Please provide either scheduledAt (UTC ISO) or scheduledDate + scheduledTime (local).", 
        code: 'VALIDATION_ERROR' 
      });
  }
  
  // Ensure scheduledAt is in the future
  const now = new Date();
  if (scheduledAtDate <= now) {
    return res.status(400).json({ 
      message: "scheduledAt must be in the future. Cannot schedule campaigns in the past." 
    });
  }
  
  // Ensure it's stored as UTC
  const utcDate = new Date(scheduledAtDate.toISOString());

  const camp = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!camp) {
    return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  // Use updateMany with ownerId scope for security
  const result = await prisma.campaign.updateMany({
    where: { id, ownerId: req.user.id }, // SCOPE
    data: { status: "scheduled", scheduledAt: utcDate },
  });
  
  if (result.count === 0) {
    return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }
  
  // Fetch updated campaign for response
  const updated = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id }
  });
    
    if (!updated) {
      return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  if (schedulerQueue && updated.scheduledAt) {
    const delay = msUntil(updated.scheduledAt);
    
    if (delay <= 0) {
      logger.warn({ 
        campaignId: id, 
        scheduledAt: updated.scheduledAt,
        delay 
      }, 'Scheduled campaign is in the past, enqueuing immediately');
      
      try {
        await enqueueCampaign(id);
      } catch (err) {
        logger.error({ campaignId: id, err }, 'Failed to enqueue past-due campaign');
      }
    } else {
      logger.info({ 
        campaignId: id, 
        scheduledAt: updated.scheduledAt,
        delayMs: delay,
        delaySeconds: Math.round(delay / 1000)
      }, 'Adding scheduled campaign job to queue');
      
      const job = await schedulerQueue.add(
        "enqueueCampaign",
        { campaignId: id },
        { 
          jobId: `campaign:schedule:${id}`, 
          delay 
        }
      );
      
      logger.info({ campaignId: id, jobId: job.id }, 'Scheduled campaign job added to queue');
    }
  } else if (updated.scheduledAt && !schedulerQueue) {
    logger.warn({ campaignId: id }, 'Scheduler queue is disabled, cannot schedule campaign');
  }

  res.json({ ok: true, scheduledAt: updated.scheduledAt });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * PUT /campaigns/:id (protected)
 * Update campaign (only draft and scheduled campaigns can be edited).
 * Body: { name?, templateId?, messageText?, filterGender?, filterAgeGroup?, scheduledDate?, scheduledTime? }
 * ========================================================= */
router.put("/campaigns/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: "Invalid campaign ID. Please provide a valid campaign ID.", 
      code: 'INVALID_ID' 
    });
  }

    const { sanitizeString } = require('../lib/sanitize');
    const { name, templateId, messageText, filterGender, filterAgeGroup, scheduledDate, scheduledTime } = req.body || {};

    // Find campaign and verify ownership
    const existingCampaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id },
      select: { id: true, status: true, filterGender: true, filterAgeGroup: true }
    });

    if (!existingCampaign) {
      return res.status(404).json({ 
        message: "Campaign not found", 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    // Only allow editing draft and scheduled campaigns
    if (existingCampaign.status !== 'draft' && existingCampaign.status !== 'scheduled') {
      return res.status(400).json({ 
        message: `Cannot edit campaign with status "${existingCampaign.status}". Only draft and scheduled campaigns can be edited.`, 
        code: 'INVALID_STATUS' 
      });
    }

    const updates = {};

    // Update name if provided
    if (name !== undefined) {
      const sanitizedName = name ? sanitizeString(name, { maxLength: 200 }) : null;
      if (!sanitizedName) {
        return res.status(400).json({ 
          message: "Campaign name is required", 
          code: 'VALIDATION_ERROR' 
        });
      }
      updates.name = sanitizedName;
    }

    // Update templateId if provided
    if (templateId !== undefined) {
      const templateIdNum = Number(templateId);
      if (!templateIdNum || isNaN(templateIdNum)) {
        return res.status(400).json({ 
          message: "Invalid template ID", 
          code: 'VALIDATION_ERROR' 
        });
      }

      // Validate template ownership
      const tpl = await prisma.messageTemplate.findFirst({
        where: {
          id: templateIdNum,
          ownerId: { in: [req.user.id, SYSTEM_USER_ID] },
        },
      });
      if (!tpl) {
        return res.status(404).json({ 
          message: "Template not found", 
          code: 'RESOURCE_NOT_FOUND' 
        });
      }
      updates.templateId = templateIdNum;
    }

    // Update messageText if provided
    if (messageText !== undefined) {
      updates.messageText = messageText && messageText.trim() 
        ? sanitizeString(messageText, { maxLength: 2000 }) 
        : null;
    }

    // Update filters if provided
    if (filterGender !== undefined || filterAgeGroup !== undefined) {
      const { normalizeGender, normalizeAgeGroup } = require('../lib/validation');
      
      if (filterGender !== undefined) {
        const normalizedGender = filterGender ? normalizeGender(filterGender) : null;
        if (filterGender && !normalizedGender) {
          return res.status(400).json({ 
            message: "invalid filterGender (must be: male, female, other, prefer_not_to_say, or null for Any)" 
          });
        }
        updates.filterGender = normalizedGender;
      }

      if (filterAgeGroup !== undefined) {
        const normalizedAgeGroup = filterAgeGroup ? normalizeAgeGroup(filterAgeGroup) : null;
        if (filterAgeGroup && !normalizedAgeGroup) {
          return res.status(400).json({ 
            message: "Invalid age group filter. Please select a valid age group.", 
            code: 'VALIDATION_ERROR'
          });
        }
        const { mapAgeGroupToPrisma } = require('../lib/routeHelpers');
        updates.filterAgeGroup = mapAgeGroupToPrisma(normalizedAgeGroup);
      }

      // Recalculate total if filters changed
      const { countAudience } = require('../services/audience.service');
      const finalGender = updates.filterGender !== undefined ? updates.filterGender : existingCampaign.filterGender;
      const finalAgeGroup = updates.filterAgeGroup !== undefined ? updates.filterAgeGroup : existingCampaign.filterAgeGroup;
      const { mapAgeGroupToApi } = require('../lib/routeHelpers');
      const normalizedAgeGroup = mapAgeGroupToApi(finalAgeGroup);
      updates.total = await countAudience(req.user.id, finalGender, normalizedAgeGroup);
    }

    // Handle scheduling updates
    let scheduledAtDate = null;
    if (scheduledDate && scheduledTime) {
      // New format: local date/time - backend converts to UTC using user's timezone
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { timezone: true }
      });
      
      const userTimezone = user?.timezone || 'UTC';
      scheduledAtDate = convertLocalToUTC(scheduledDate, scheduledTime, userTimezone);
      
      if (!scheduledAtDate || isNaN(scheduledAtDate.getTime())) {
        return res.status(400).json({ 
          message: "Invalid scheduled date or time. Please provide valid date (YYYY-MM-DD) and time (HH:mm) in your configured timezone.", 
          code: 'VALIDATION_ERROR'
        });
      }

      // Ensure scheduledAt is in the future
      const now = new Date();
      if (scheduledAtDate <= now) {
        return res.status(400).json({ 
          message: "Scheduled time must be in the future. Cannot schedule campaigns in the past.", 
          code: 'VALIDATION_ERROR' 
        });
      }

      updates.scheduledAt = scheduledAtDate;
      updates.status = 'scheduled';
    } else if (scheduledDate === null && scheduledTime === null) {
      // Explicitly unschedule (remove scheduledAt)
      updates.scheduledAt = null;
      if (existingCampaign.status === 'scheduled') {
        updates.status = 'draft';
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ 
        message: "No updates provided", 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Update campaign
    const updated = await prisma.campaign.updateMany({
      where: { id, ownerId: req.user.id },
      data: updates
    });

    if (updated.count === 0) {
      return res.status(404).json({ 
        message: "Campaign not found", 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    // Fetch updated campaign for response
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user.id },
      include: { template: true }
    });

    if (!campaign) {
      return res.status(404).json({ 
        message: "Campaign not found", 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    // Handle scheduler queue if scheduledAt changed
    if (schedulerQueue && (updates.scheduledAt !== undefined)) {
      // Remove existing scheduled job if any
      try {
        await schedulerQueue.remove(`campaign:schedule:${id}`);
      } catch (e) {
        // Job might not exist, ignore
      }

      // Add new scheduled job if scheduled
      if (campaign.scheduledAt) {
        const delay = msUntil(campaign.scheduledAt);
        
        if (delay <= 0) {
          logger.warn({ 
            campaignId: id, 
            scheduledAt: campaign.scheduledAt,
            delay 
          }, 'Scheduled campaign is in the past, enqueuing immediately');
          
          try {
            await enqueueCampaign(id);
          } catch (err) {
            logger.error({ campaignId: id, err }, 'Failed to enqueue past-due campaign');
          }
        } else {
          logger.info({ 
            campaignId: id, 
            scheduledAt: campaign.scheduledAt,
            delayMs: delay,
            delaySeconds: Math.round(delay / 1000)
          }, 'Adding scheduled campaign job to queue');
          
          const job = await schedulerQueue.add(
            "enqueueCampaign",
            { campaignId: id },
            { 
              jobId: `campaign:schedule:${id}`, 
              delay 
            }
          );
          
          logger.info({ campaignId: id, jobId: job.id }, 'Scheduled campaign job added to queue');
        }
      }
    }

    // Map Prisma enum back to normalized format for API response
    const { mapAgeGroupToApi } = require('../lib/routeHelpers');
    const response = { ...campaign };
    response.filterAgeGroup = mapAgeGroupToApi(campaign.filterAgeGroup);

    res.json(response);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * POST /campaigns/:id/unschedule (protected)
 * Remove scheduledAt and cancel delayed job (scoped).
 * ========================================================= */
router.post("/campaigns/:id/unschedule", requireAuth, async (req, res, next) => {
  try {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: "Invalid campaign ID", 
      code: 'VALIDATION_ERROR' 
    });
  }

  const camp = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!camp) {
    return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

    // Use updateMany with ownerId scope for security
    const result = await prisma.campaign.updateMany({
      where: { id, ownerId: req.user.id }, // SCOPE
      data: { status: "draft", scheduledAt: null },
    });
    
    if (result.count === 0) {
      return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  if (schedulerQueue) {
    try {
      await schedulerQueue.remove(`campaign:schedule:${id}`);
      } catch (_) {
        // Ignore errors when removing job (job might not exist)
      }
  }

  res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * GET /campaigns/:id/status (protected)
 * Lightweight metrics (scoped).
 * ========================================================= */
router.get("/campaigns/:id/status", requireAuth, async (req, res, next) => {
  try {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: "Invalid campaign ID", 
      code: 'VALIDATION_ERROR' 
    });
  }

  const c = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!c) {
    return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  // Note: "delivered" status is mapped to "sent" - we only track sent/failed
  const [queued, sent, failed] = await Promise.all([
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "queued" },
    }),
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "sent" },
    }),
    prisma.campaignMessage.count({
      where: { ownerId: req.user.id, campaignId: id, status: "failed" },
    }),
  ]);

  // Map Prisma enum back to normalized format for API response
  const { mapAgeGroupToApi } = require('../lib/routeHelpers');
  const campaignResponse = { ...c, filterAgeGroup: mapAgeGroupToApi(c.filterAgeGroup) };
  
  // Note: delivered is same as sent since delivered maps to sent
  res.json({ campaign: campaignResponse, metrics: { queued, sent, delivered: sent, failed } });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * POST /campaigns/:id/fake-send (protected, dev only)
 * Force-advance N queued -> sent (scoped). Auto-complete if none left.
 * ========================================================= */
router.post("/campaigns/:id/fake-send", requireAuth, async (req, res, next) => {
  try {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: "Invalid campaign ID", 
      code: 'VALIDATION_ERROR' 
    });
  }

  const owned = await prisma.campaign.findFirst({
    where: { id, ownerId: req.user.id },
  });
  if (!owned) {
    return res.status(404).json({ 
      message: "Campaign not found", 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }

  const limit = Math.min(Number(req.body?.limit || 50), 500);

  const queued = await prisma.campaignMessage.findMany({
    where: { ownerId: req.user.id, campaignId: id, status: "queued" },
    take: limit,
    orderBy: { id: "asc" },
  });
  if (!queued.length) {
    return res.json({ updated: 0 });
  }

  const ids = queued.map((m) => m.id);

  await prisma.campaignMessage.updateMany({
    where: { id: { in: ids }, ownerId: req.user.id }, // SCOPE
    data: { status: "sent", sentAt: new Date() },
  });

  const remainingQueued = await prisma.campaignMessage.count({
    where: { ownerId: req.user.id, campaignId: id, status: "queued" },
  });

  if (remainingQueued === 0) {
    try {
      // Use updateMany with ownerId scope for security
      await prisma.campaign.updateMany({
        where: { id, ownerId: req.user.id }, // SCOPE
        data: { status: "completed", finishedAt: new Date() },
      });
    } catch (e) {
      // Log but don't fail the request
      logger.warn({ campaignId: id, err: e.message }, 'Failed to mark campaign as completed');
    }
  }

  res.json({ updated: ids.length, remainingQueued });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 * POST /campaigns/:id/refresh-status (protected)
 * Refresh message delivery statuses from Mitto for a campaign
 * ========================================================= */
router.post("/campaigns/:id/refresh-status", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
      message: "Invalid campaign ID", 
      code: 'VALIDATION_ERROR' 
    });
    }

    const { refreshCampaignStatuses } = require('../services/statusRefresh.service');
    const result = await refreshCampaignStatuses(id, req.user.id);

    res.json({
      campaignId: id,
      refreshed: result.refreshed,
      updated: result.updated,
      errors: result.errors
    });
  } catch (e) {
    // Handle errors gracefully - don't crash on Mitto API failures
    logger.error({ campaignId: req.params.id, err: e.message }, 'Failed to refresh campaign status');
    if (e.message.includes('not found') || e.message.includes('not owned')) {
      return res.status(404).json({ 
        message: 'Campaign not found', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }
    next(e);
  }
});

module.exports = router;
