// apps/api/src/services/token.service.js
// Token generation and verification for unsubscribe links

const crypto = require('node:crypto');
const pino = require('pino');

const logger = pino({ name: 'token-service' });

// Secret key for token signing (use env var or generate one)
const TOKEN_SECRET = process.env.UNSUBSCRIBE_TOKEN_SECRET || 'default-secret-change-in-production';
const TOKEN_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year in milliseconds

/**
 * Generate an unsubscribe token for a contact
 * Token encodes: contactId, storeId, optional campaignId
 * 
 * @param {number} contactId - Contact ID
 * @param {number} storeId - Store/Owner ID
 * @param {number} [campaignId] - Optional campaign ID
 * @returns {string} URL-safe token
 */
function generateUnsubscribeToken(contactId, storeId, campaignId = null) {
  const payload = {
    contactId,
    storeId,
    campaignId,
    exp: Date.now() + TOKEN_EXPIRY_MS // Expiry timestamp
  };

  // Create a simple signed token using HMAC
  const payloadStr = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payloadStr)
    .digest('base64url');

  // Combine payload and signature (base64url encoded)
  const token = Buffer.from(payloadStr).toString('base64url') + '.' + signature;

  return token;
}

/**
 * Verify and decode an unsubscribe token
 * 
 * @param {string} token - Token to verify
 * @returns {Object|null} Decoded payload { contactId, storeId, campaignId } or null if invalid
 */
function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [payloadBase64, signature] = parts;

    // Decode payload
    const payloadStr = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadStr);

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(payloadStr)
      .digest('base64url');

    if (signature !== expectedSignature) {
      logger.warn('Invalid token signature');
      return null;
    }

    // Check expiry
    if (payload.exp && payload.exp < Date.now()) {
      logger.warn('Token expired');
      return null;
    }

    // Validate required fields
    if (!payload.contactId || !payload.storeId) {
      return null;
    }

    return {
      contactId: payload.contactId,
      storeId: payload.storeId,
      campaignId: payload.campaignId || null
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'Token verification failed');
    return null;
  }
}

module.exports = {
  generateUnsubscribeToken,
  verifyUnsubscribeToken
};

