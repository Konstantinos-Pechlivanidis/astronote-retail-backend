// apps/api/src/routes/nfc.js
const express = require('express');
const { getNfcConfig, createOrUpdateContactFromNfc, recordNfcScan } = require('../services/nfc.service');
const { createLimiter, rateLimitByIp, rateLimitByKey } = require('../lib/ratelimit');
const pino = require('pino');

const logger = pino({ name: 'nfc-route' });

const router = express.Router();

// Rate limiters
const configIpLimiter = createLimiter({ 
  keyPrefix: 'rl:nfc:config:ip', 
  points: 60, 
  duration: 60 
});

const submitIpLimiter = createLimiter({ 
  keyPrefix: 'rl:nfc:submit:ip', 
  points: 30, 
  duration: 60 
});

const submitPhoneLimiter = createLimiter({ 
  keyPrefix: 'rl:nfc:submit:phone', 
  points: 5, 
  duration: 3600 // 1 hour
});

/**
 * Extract device type from user agent (simple heuristic)
 */
function getDeviceType(userAgent) {
  if (!userAgent) {return 'unknown';}
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return 'mobile';
  }
  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'tablet';
  }
  return 'desktop';
}

/**
 * Get client IP address (handles proxies)
 */
function getClientIp(req) {
  return req.ip || 
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         'unknown';
}

/**
 * PUBLIC: GET /nfc/:publicId/config
 * Returns NFC tag configuration for frontend form rendering
 */
router.get(
  '/:publicId/config',
  rateLimitByIp(configIpLimiter),
  async (req, res, next) => {
    try {
      const { publicId } = req.params;

      if (!publicId || typeof publicId !== 'string' || publicId.length < 6 || publicId.length > 64) {
        return res.status(400).json({ 
          code: 'INVALID_PUBLIC_ID',
          message: 'Invalid NFC tag identifier' 
        });
      }

      const config = await getNfcConfig(publicId);

      if (config.error === 'TAG_NOT_FOUND') {
        return res.status(404).json({ 
          code: 'TAG_NOT_FOUND',
          message: 'NFC tag not found' 
        });
      }

      if (config.error === 'TAG_INACTIVE') {
        return res.status(403).json({ 
          code: 'TAG_INACTIVE',
          message: 'NFC tag is not active',
          status: config.status
        });
      }

      // Record scan with request metadata (async, don't block response)
      const ipAddress = getClientIp(req);
      const userAgent = req.headers['user-agent'] || null;
      const deviceType = getDeviceType(userAgent);

      // Record scan as "opened" for analytics
      recordNfcScan(
        config.tag.id,
        config.store.id,
        'opened',
        { ipAddress, userAgent, deviceType }
      ).catch(err => logger.warn({ tagId: config.tag.id, err: err.message }, 'Failed to record scan'));

      res.json(config);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUBLIC: POST /nfc/:publicId/submit
 * Accepts form submission and creates/updates contact
 */
router.post(
  '/:publicId/submit',
  rateLimitByIp(submitIpLimiter),
  rateLimitByKey(submitPhoneLimiter, (req) => {
    const phone = req.body?.phone;
    return phone ? `phone:${phone.replace(/\s+/g, '')}` : req.ip;
  }),
  async (req, res, next) => {
    try {
      const { publicId } = req.params;
      const { phone, email, firstName, lastName, consent } = req.body || {};

      // Validate publicId
      if (!publicId || typeof publicId !== 'string' || publicId.length < 6 || publicId.length > 64) {
        return res.status(400).json({ 
          code: 'INVALID_PUBLIC_ID',
          message: 'Invalid NFC tag identifier' 
        });
      }

      // Resolve tag
      const { resolveNfcTag } = require('../services/nfc.service');
      const tag = await resolveNfcTag(publicId);

      if (!tag) {
        return res.status(404).json({ 
          code: 'TAG_NOT_FOUND',
          message: 'NFC tag not found' 
        });
      }

      if (tag.status !== 'active' && tag.status !== 'test') {
        return res.status(403).json({ 
          code: 'TAG_INACTIVE',
          message: 'NFC tag is not active' 
        });
      }

      // Verify tag type is opt_in (for subscribe/contact creation)
      if (tag.type && tag.type !== 'opt_in') {
        return res.status(400).json({ 
          code: 'INVALID_TAG_TYPE',
          message: 'This NFC tag is not configured for contact opt-in' 
        });
      }

      // Create or update contact
      const ipAddress = getClientIp(req);
      const userAgent = req.headers['user-agent'] || null;
      const deviceType = getDeviceType(userAgent);

      let contactResult;
      try {
        contactResult = await createOrUpdateContactFromNfc(
          tag.storeId,
          tag.id,
          tag.campaignId,
          { phone, email, firstName, lastName, consent },
          { ipAddress, userAgent, deviceType }
        );
      } catch (err) {
        if (err.message === 'PHONE_REQUIRED' || err.message === 'INVALID_PHONE') {
          return res.status(400).json({ 
            code: 'INVALID_PHONE',
            message: 'Valid phone number is required' 
          });
        }
        if (err.message === 'EMAIL_REQUIRED') {
          return res.status(400).json({ 
            code: 'EMAIL_REQUIRED',
            message: 'Email is required' 
          });
        }
        if (err.message === 'INVALID_EMAIL') {
          return res.status(400).json({ 
            code: 'INVALID_EMAIL',
            message: 'Invalid email address' 
          });
        }
        if (err.message === 'FIRST_NAME_REQUIRED') {
          return res.status(400).json({ 
            code: 'FIRST_NAME_REQUIRED',
            message: 'First name is required' 
          });
        }
        if (err.message === 'LAST_NAME_REQUIRED') {
          return res.status(400).json({ 
            code: 'LAST_NAME_REQUIRED',
            message: 'Last name is required' 
          });
        }
        if (err.message === 'CONSENT_REQUIRED') {
          return res.status(400).json({ 
            code: 'CONSENT_REQUIRED',
            message: 'Consent is required' 
          });
        }
        throw err;
      }

      // Record scan as submitted (result intentionally unused)
      await recordNfcScan(
        tag.id,
        tag.storeId,
        'submitted',
        { 
          ipAddress, 
          userAgent, 
          deviceType,
          contactId: contactResult.contact.id
        }
      );

      // Response
      res.status(contactResult.isNew ? 201 : 200).json({
        success: true,
        contact: {
          id: contactResult.contact.id,
          phone: contactResult.contact.phone,
          email: contactResult.contact.email,
          firstName: contactResult.contact.firstName,
          lastName: contactResult.contact.lastName
        },
        action: contactResult.isNew ? 'created' : 'updated',
        // Future: discount code generation can be added here
        discountCode: null
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

