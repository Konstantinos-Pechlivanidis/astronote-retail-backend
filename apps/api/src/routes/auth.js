// apps/api/src/routes/auth.js
const express = require('express');
const cookieParser = require('cookie-parser');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { register, login, refresh, logout } = require('../modules/auth.service');

// Rate limiting helpers (Redis-backed if REDIS_URL set, otherwise in-memory per process)
const { createLimiter, rateLimitByIp, rateLimitByKey } = require('../lib/ratelimit');

const router = express.Router();
router.use(cookieParser());

const REFRESH_COOKIE = 'rt';

// Cookie options (secure in production, cross-site support)
const isProd = process.env.NODE_ENV === 'production';
function setRefreshCookie(res, token, expiresAt) {
  // For cross-site cookies (different domains), we need SameSite=None and Secure=true
  // Frontend: astronote-retail-frontend.onrender.com
  // Backend: astronote-retail-backend.onrender.com
  // These are different domains, so we need cross-site cookie support
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'none',              // Required for cross-site cookies
    secure: true,                  // Required when SameSite=None (HTTPS only)
    expires: expiresAt,
    domain: undefined,             // Don't set domain to allow cross-site cookies
    path: '/',                     // Available for all paths
  });
}

// ---- Rate limiters ----
// Login: 50 tries / 10m per IP, 20 tries / 10m per email
const loginIpLimiter    = createLimiter({ keyPrefix: 'rl:login:ip',    points: 50,  duration: 600 });
const loginEmailLimiter = createLimiter({ keyPrefix: 'rl:login:email', points: 20,  duration: 600 });

// Register: 30 tries / 10m per IP, 10 / 10m per email
// More lenient for scalability - email uniqueness already enforced by database
const regIpLimiter      = createLimiter({ keyPrefix: 'rl:reg:ip',      points: 30,  duration: 600 });
const regEmailLimiter   = createLimiter({ keyPrefix: 'rl:reg:email',   points: 10,  duration: 600 });

// Refresh: 300 / 10m per IP (frequent operation)
const refreshIpLimiter  = createLimiter({ keyPrefix: 'rl:refresh:ip',  points: 300, duration: 600 });

// Logout: 120 / 10m per IP
const logoutIpLimiter   = createLimiter({ keyPrefix: 'rl:logout:ip',   points: 120, duration: 600 });

// ---- Helpers ----
function normEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

// ---------- Routes ----------

// Register
router.post(
  '/auth/register',
  rateLimitByIp(regIpLimiter),
  rateLimitByKey(regEmailLimiter, req => normEmail(req.body?.email)),
  async (req, res, next) => {
    try {
      const email = normEmail(req.body?.email);
      const { password, senderName, company } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ 
          message: 'Email and password are required', 
          code: 'VALIDATION_ERROR' 
        });
      }

      const { user, accessToken, refreshToken, expiresAt } = await register({ email, password, senderName, company });
      setRefreshCookie(res, refreshToken, expiresAt);
      
      res.status(201).json({
        accessToken,
        user: { id: user.id, email: user.email, senderName: user.senderName, company: user.company }
      });
    } catch (e) {
      // Pass to centralized error handler for proper Prisma error handling
      next(e);
    }
  }
);

// Login
router.post(
  '/auth/login',
  rateLimitByIp(loginIpLimiter),
  rateLimitByKey(loginEmailLimiter, req => normEmail(req.body?.email)),
  async (req, res, next) => {
    try {
      const email = normEmail(req.body?.email);
      const { password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ 
          message: 'Email and password are required', 
          code: 'VALIDATION_ERROR' 
        });
      }

      const { user, accessToken, refreshToken, expiresAt } = await login({ email, password });
      setRefreshCookie(res, refreshToken, expiresAt);

      res.json({
        accessToken,
        user: { id: user.id, email: user.email, senderName: user.senderName, company: user.company }
      });
    } catch (e) {
      // Ensure error has 401 status for auth failures (don't leak whether email exists)
      if (!e.status) {
        e.status = 401;
      }
      if (!e.message) {
        e.message = 'Invalid email or password';
      }
      next(e);
    }
  }
);

// Refresh
router.post(
  '/auth/refresh',
  rateLimitByIp(refreshIpLimiter),
  async (req, res, next) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (!token) {
        const error = new Error('No refresh token');
        error.status = 401;
        return next(error);
      }

      const { accessToken, user } = await refresh(token);
      res.json({
        accessToken,
        user: { id: user.id, email: user.email, senderName: user.senderName, company: user.company }
      });
    } catch (e) {
      // Ensure error has 401 status for auth failures
      if (!e.status) {
        e.status = 401;
      }
      next(e);
    }
  }
);

// Logout
router.post(
  '/auth/logout',
  rateLimitByIp(logoutIpLimiter),
  async (req, res, next) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (token) {
        await logout(token);
      }
      res.clearCookie(REFRESH_COOKIE);
      res.json({ ok: true });
    } catch (e) {
      // Ensure error has proper status
      if (!e.status) {
        e.status = 400;
      }
      next(e);
    }
  }
);

/**
 * PUT /api/user
 * Update user profile (company, senderName, timezone)
 * Note: The User model does not have a 'name' field. Only 'company', 'senderName', and 'timezone' can be updated.
 * @param {string|null} company - Company name (optional, max 160 chars)
 * @param {string|null} senderName - SMS sender name (optional, max 11 chars, alphanumeric)
 * @param {string|null} timezone - IANA timezone (optional, e.g. "Europe/Athens", "America/New_York")
 * @returns {User} Updated user object (id, email, senderName, company, timezone)
 */
router.put('/user', requireAuth, async (req, res, next) => {
  try {
    const { sanitizeString } = require('../lib/sanitize');
    const { name, company, senderName, timezone } = req.body || {};
    const updates = {};
    
    // Note: User model doesn't have a 'name' field - ignore it if provided
    // The User model supports: senderName, company, and timezone
    if (name !== undefined) {
      // Silently ignore 'name' field - User model doesn't have it
      // Frontend should use 'senderName' instead if they want to set a display name
    }
    if (company !== undefined) {
      updates.company = company ? sanitizeString(company, { maxLength: 160 }) : null;
    }
    if (senderName !== undefined) {
      const sanitized = senderName ? sanitizeString(senderName, { maxLength: 11 }) : null;
      if (sanitized && sanitized.length > 11) {
        return res.status(400).json({ 
          message: 'Sender ID must be 11 characters or less', 
          code: 'VALIDATION_ERROR' 
        });
      }
      updates.senderName = sanitized;
    }
    if (timezone !== undefined) {
      // Validate IANA timezone format (basic check - should be like "Europe/Athens", "America/New_York", etc.)
      if (timezone !== null && timezone !== '') {
        const tzPattern = /^[A-Za-z_]+\/[A-Za-z_]+$/;
        if (!tzPattern.test(timezone)) {
          return res.status(400).json({ 
            message: 'Invalid timezone format. Use IANA timezone (e.g. "Europe/Athens")', 
            code: 'VALIDATION_ERROR' 
          });
        }
        // Additional validation: try to use it with Intl.DateTimeFormat to ensure it's valid
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        } catch (tzError) {
          return res.status(400).json({ 
            message: 'Invalid timezone. Please select a valid IANA timezone.', 
            code: 'VALIDATION_ERROR' 
          });
        }
      }
      updates.timezone = timezone || null;
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ 
        message: 'No updates provided', 
        code: 'VALIDATION_ERROR' 
      });
    }
    
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: updates,
      select: {
        id: true,
        email: true,
        senderName: true,
        company: true,
        timezone: true
      }
    });
    
    res.json(user);
  } catch (e) {
    next(e);
  }
});

/**
 * PUT /api/user/password
 * Update user password
 * @param {string} oldPassword - Current password (required)
 * @param {string} newPassword - New password (required)
 * @returns {{ok: boolean}} Success indicator
 */
router.put('/user/password', requireAuth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ 
        message: 'Current password and new password are required', 
        code: 'VALIDATION_ERROR' 
      });
    }
    
    const { verifyPassword, hashPassword } = require('../lib/passwords');
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    
    if (!user || !(await verifyPassword(oldPassword, user.passwordHash))) {
      return res.status(401).json({ 
        message: 'Invalid current password', 
        code: 'AUTHENTICATION_ERROR' 
      });
    }
    
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash }
    });
    
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
