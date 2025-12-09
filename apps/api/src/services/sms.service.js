// apps/api/src/services/sms.service.js
// Centralized SMS sending service with credit enforcement

const { sendSingle } = require('./mitto.service');
const { getBalance, debit } = require('./wallet.service');
const { generateUnsubscribeToken } = require('./token.service');
const { isSubscriptionActive } = require('./subscription.service');
const pino = require('pino');

const logger = pino({ name: 'sms-service' });

// Helper function to ensure base URL includes /retail path
function ensureRetailPath(url) {
  if (!url) {
    return url;
  }
  const trimmed = url.trim().replace(/\/$/, ''); // Remove trailing slash
  // If URL doesn't end with /retail, add it
  if (!trimmed.endsWith('/retail')) {
    return `${trimmed}/retail`;
  }
  return trimmed;
}

// Base URL for unsubscribe links (from env or default)
const baseFrontendUrl = process.env.UNSUBSCRIBE_BASE_URL || process.env.FRONTEND_URL || 'https://astronote-retail-frontend.onrender.com';
const UNSUBSCRIBE_BASE_URL = ensureRetailPath(baseFrontendUrl);

/**
 * Send SMS with credit enforcement
 * Checks balance before sending, debits ONLY after successful send (when messageId is received)
 * 
 * @param {Object} params
 * @param {number} params.ownerId - Store owner ID
 * @param {string} params.destination - Recipient phone number
 * @param {string} params.text - Message text
 * @param {string} [params.sender] - Optional sender override
 * @param {Object} [params.meta] - Optional metadata for transaction (campaignId, messageId, etc.)
 * @returns {Promise<Object>} Result with sent status, messageId, etc.
 */
async function sendSMSWithCredits({ ownerId, destination, text, sender, meta = {}, contactId = null }) {
  // 1. Check subscription status first
  const subscriptionActive = await isSubscriptionActive(ownerId);
  if (!subscriptionActive) {
    logger.warn({ ownerId }, 'Inactive subscription - SMS send blocked');
    return {
      sent: false,
      reason: 'inactive_subscription',
      error: 'Active subscription required to send SMS. Please subscribe to a plan.'
    };
  }

  // 2. Check balance before sending
  const balance = await getBalance(ownerId);
  if (balance < 1) {
    logger.warn({ ownerId, balance }, 'Insufficient credits for SMS send');
    return {
      sent: false,
      reason: 'insufficient_credits',
      balance,
      error: 'Not enough credits to send SMS. Please purchase credits.'
    };
  }

  // 3. Append unsubscribe link if contactId is provided (for automations)
  let finalText = text;
  if (contactId) {
    try {
      const unsubscribeToken = generateUnsubscribeToken(contactId, ownerId, meta.campaignId || null);
      const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${unsubscribeToken}`;
      finalText += `\n\nTo unsubscribe, tap: ${unsubscribeUrl}`;
    } catch (tokenErr) {
      logger.warn({ ownerId, contactId, err: tokenErr.message }, 'Failed to generate unsubscribe token, sending without link');
      // Continue without unsubscribe link if token generation fails
    }
  }

  // 4. Send SMS via Mitto (credits will be debited AFTER successful send)
  try {
    const result = await sendSingle({
      userId: ownerId,
      destination,
      text: finalText,
      sender
    });

    // 5. Only debit credits AFTER successful send (when we have messageId)
    if (result.messageId) {
      try {
        const debitResult = await debit(ownerId, 1, {
          reason: meta.reason || 'sms:send',
          campaignId: meta.campaignId || null,
          messageId: meta.messageId || null,
          meta: meta
        });
        logger.debug({ ownerId, balanceAfter: debitResult.balance }, 'Credits debited after successful send');
        
        logger.info({ 
          ownerId, 
          destination, 
          messageId: result.messageId 
        }, 'SMS sent successfully');

        return {
          sent: true,
          messageId: result.messageId,
          providerMessageId: result.messageId, // Mitto messageId is the provider messageId
          trafficAccountId: result.trafficAccountId,
          balanceAfter: debitResult.balance
        };
      } catch (debitErr) {
        // Log error but don't fail - message was already sent
        logger.error({ ownerId, err: debitErr.message }, 'Failed to debit credits after successful send');
        return {
          sent: true,
          messageId: result.messageId,
          providerMessageId: result.messageId, // Mitto messageId is the provider messageId
          trafficAccountId: result.trafficAccountId,
          balanceAfter: balance // Return original balance if debit failed
        };
      }
    } else {
      // No messageId returned - treat as failure
      logger.error({ ownerId, destination }, 'Mitto send succeeded but no messageId returned');
      return {
        sent: false,
        reason: 'send_failed',
        error: 'Mitto send succeeded but no messageId returned'
      };
    }
  } catch (err) {
    // 6. On send failure, do NOT debit credits (no messageId = no debit)
    logger.warn({ ownerId, err: err.message }, 'SMS send failed, no credits debited');

    return {
      sent: false,
      reason: 'send_failed',
      error: err.message,
      balanceAfter: balance
    };
  }
}

/**
 * Check if an error is retryable (network, timeout, rate limit, server error)
 */
function isRetryableError(err) {
  const status = err?.status;
  if (!status) {return true;}      // network/timeout
  if (status >= 500) {return true;} // provider/server error
  if (status === 429) {return true;} // rate limited
  return false;                    // 4xx hard fail
}

module.exports = {
  sendSMSWithCredits,
  isRetryableError
};

