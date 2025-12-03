// apps/api/src/routes/conversion.js
// Public routes for conversion tracking (visit confirmation via NFC)

const express = require('express');
const { recordConversion } = require('../services/conversion.service');
const { resolveNfcTag } = require('../services/nfc.service');
const { createLimiter, rateLimitByIp, rateLimitByKey } = require('../lib/ratelimit');
const prisma = require('../lib/prisma');
const pino = require('pino');

const logger = pino({ name: 'conversion-route' });

const router = express.Router();

// Rate limiters
const configIpLimiter = createLimiter({ 
  keyPrefix: 'rl:conversion:config:ip', 
  points: 60, 
  duration: 60 
});

const submitIpLimiter = createLimiter({ 
  keyPrefix: 'rl:conversion:submit:ip', 
  points: 30, 
  duration: 60 
});

const submitPhoneLimiter = createLimiter({ 
  keyPrefix: 'rl:conversion:submit:phone', 
  points: 5, 
  duration: 3600 // 1 hour
});

/**
 * PUBLIC: GET /conversion/:tagPublicId
 * Returns NFC tag configuration for visit confirmation form
 */
router.get(
  '/:tagPublicId',
  rateLimitByIp(configIpLimiter),
  async (req, res, next) => {
    try {
      const { tagPublicId } = req.params;

      if (!tagPublicId || typeof tagPublicId !== 'string' || tagPublicId.length < 6 || tagPublicId.length > 64) {
        return res.status(400).json({ 
          code: 'INVALID_PUBLIC_ID',
          message: 'Invalid NFC tag identifier' 
        });
      }

      const tag = await resolveNfcTag(tagPublicId);

      if (!tag) {
        return res.status(404).json({ 
          code: 'TAG_NOT_FOUND',
          message: 'NFC tag not found' 
        });
      }

      if (tag.type !== 'conversion') {
        return res.status(400).json({ 
          code: 'INVALID_TAG_TYPE',
          message: 'This NFC tag is not configured for visit confirmation' 
        });
      }

      if (tag.status !== 'active' && tag.status !== 'test') {
        return res.status(403).json({ 
          code: 'TAG_INACTIVE',
          message: 'NFC tag is not active',
          status: tag.status
        });
      }

      res.json({
        success: true,
        tag: {
          id: tag.id,
          publicId: tag.publicId,
          label: tag.label,
          store: {
            id: tag.store.id,
            company: tag.store.company || 'Store',
            senderName: tag.store.senderName
          }
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUBLIC: POST /conversion/:tagPublicId
 * Submit visit confirmation (phone number required)
 */
router.post(
  '/:tagPublicId',
  express.json(),
  rateLimitByIp(submitIpLimiter),
  rateLimitByKey(submitPhoneLimiter, (req) => {
    const phone = req.body?.phone;
    return phone ? `phone:${phone.replace(/\s+/g, '')}` : req.ip;
  }),
  async (req, res, next) => {
    try {
      const { tagPublicId } = req.params;
      const { phone } = req.body || {};

      // Validate publicId
      if (!tagPublicId || typeof tagPublicId !== 'string' || tagPublicId.length < 6 || tagPublicId.length > 64) {
        return res.status(400).json({ 
          code: 'INVALID_PUBLIC_ID',
          message: 'Invalid NFC tag identifier' 
        });
      }

      // Validate phone
      if (!phone || typeof phone !== 'string') {
        return res.status(400).json({ 
          code: 'PHONE_REQUIRED',
          message: 'Phone number is required' 
        });
      }

      // Resolve tag
      const tag = await resolveNfcTag(tagPublicId);

      if (!tag) {
        return res.status(404).json({ 
          code: 'TAG_NOT_FOUND',
          message: 'NFC tag not found' 
        });
      }

      if (tag.type !== 'conversion') {
        return res.status(400).json({ 
          code: 'INVALID_TAG_TYPE',
          message: 'This NFC tag is not configured for visit confirmation' 
        });
      }

      if (tag.status !== 'active' && tag.status !== 'test') {
        return res.status(403).json({ 
          code: 'TAG_INACTIVE',
          message: 'NFC tag is not active' 
        });
      }

      // Record conversion
      let conversionEvent;
      try {
        conversionEvent = await recordConversion({
          storeId: tag.storeId,
          phone,
          nfcTagId: tag.id,
          campaignId: tag.campaignId || null,
          campaignMessageId: null // Will be auto-detected if not provided
        });
      } catch (err) {
        if (err.message === 'INVALID_PHONE') {
          return res.status(400).json({ 
            code: 'INVALID_PHONE',
            message: 'Invalid phone number format' 
          });
        }
        if (err.message === 'CONTACT_NOT_FOUND') {
          return res.status(404).json({ 
            code: 'CONTACT_NOT_FOUND',
            message: 'No contact found with this phone number for this store' 
          });
        }
        if (err.message === 'NFC_TAG_NOT_FOUND_OR_INACTIVE') {
          return res.status(404).json({ 
            code: 'NFC_TAG_NOT_FOUND_OR_INACTIVE',
            message: 'NFC tag not found or inactive' 
          });
        }
        throw err;
      }

      // Record metadata
      const ipAddress = req.ip || 
                       req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                       req.headers['x-real-ip'] || 
                       req.connection?.remoteAddress || 
                       'unknown';
      const userAgent = req.headers['user-agent'] || null;
      const ua = (userAgent || '').toLowerCase();
      let deviceType = 'unknown';
      if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
        deviceType = 'mobile';
      } else if (ua.includes('tablet') || ua.includes('ipad')) {
        deviceType = 'tablet';
      } else if (userAgent) {
        deviceType = 'desktop';
      }

      // Update conversion event with request metadata
      await prisma.conversionEvent.update({
        where: { id: conversionEvent.id },
        data: {
          metadata: {
            ...conversionEvent.metadata,
            ipAddress,
            userAgent,
            deviceType,
            submittedAt: new Date().toISOString()
          }
        }
      }).catch(err => {
        logger.warn({ conversionEventId: conversionEvent.id, err: err.message }, 'Failed to update conversion metadata');
      });

      res.status(201).json({
        success: true,
        message: 'Visit confirmed successfully',
        conversion: {
          id: conversionEvent.id,
          occurredAt: conversionEvent.occurredAt,
          contact: {
            firstName: conversionEvent.contact.firstName,
            lastName: conversionEvent.contact.lastName
          },
          campaign: conversionEvent.campaign ? {
            id: conversionEvent.campaign.id,
            name: conversionEvent.campaign.name
          } : null
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

