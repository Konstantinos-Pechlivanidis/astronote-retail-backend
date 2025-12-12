// apps/api/src/services/smsBulk.service.js
// Bulk SMS sending service with credit enforcement

const { sendBulkMessages } = require('./mitto.service');
const { getBalance, debit } = require('./wallet.service');
const { generateUnsubscribeToken } = require('./token.service');
const { shortenUrl, shortenUrlsInText } = require('./urlShortener.service');
const { isSubscriptionActive } = require('./subscription.service');
const pino = require('pino');

const logger = pino({ name: 'sms-bulk-service' });

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
 * Send bulk SMS with credit enforcement
 * Checks balance before sending, debits ONLY after successful send (when messageId is received)
 * 
 * @param {Array<Object>} messages - Array of message data objects
 * @param {number} messages[].ownerId - Store owner ID
 * @param {string} messages[].destination - Recipient phone number
 * @param {string} messages[].text - Message text
 * @param {string} [messages[].sender] - Optional sender override
 * @param {string} [messages[].trafficAccountId] - Optional traffic account ID override
 * @param {number} [messages[].contactId] - Optional contact ID for unsubscribe link
 * @param {Object} [messages[].meta] - Optional metadata (campaignId, messageId, etc.)
 * @param {number} messages[].internalMessageId - Internal CampaignMessage.id for mapping response
 * @returns {Promise<Object>} Result with bulkId, results array, and summary
 */
async function sendBulkSMSWithCredits(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }

  // All messages should have the same ownerId for credit checks
  const ownerId = messages[0]?.ownerId;
  if (!ownerId) {
    throw new Error('ownerId is required for all messages');
  }

  // Validate all messages have same ownerId
  for (const msg of messages) {
    if (msg.ownerId !== ownerId) {
      throw new Error('All messages in a batch must have the same ownerId');
    }
  }

  // 1. Check subscription status first
  const subscriptionActive = await isSubscriptionActive(ownerId);
  if (!subscriptionActive) {
    logger.warn({ ownerId, messageCount: messages.length }, 'Inactive subscription - bulk SMS send blocked');
    return {
      bulkId: null,
      results: messages.map(msg => ({
        internalMessageId: msg.internalMessageId,
        sent: false,
        reason: 'inactive_subscription',
        error: 'Active subscription required to send SMS. Please subscribe to a plan.'
      })),
      summary: {
        total: messages.length,
        sent: 0,
        failed: messages.length
      }
    };
  }

  // 2. Check balance before sending (need credits for all messages)
  const balance = await getBalance(ownerId);
  const requiredCredits = messages.length;
  
  if (balance < requiredCredits) {
    logger.warn({ ownerId, balance, requiredCredits, messageCount: messages.length }, 'Insufficient credits for bulk SMS send');
    return {
      bulkId: null,
      results: messages.map(msg => ({
        internalMessageId: msg.internalMessageId,
        sent: false,
        reason: 'insufficient_credits',
        balance,
        error: 'Not enough credits to send SMS. Please purchase credits.'
      })),
      summary: {
        total: messages.length,
        sent: 0,
        failed: messages.length
      }
    };
  }

  // 3. Prepare messages for Mitto API
  // Resolve sender for all messages (assuming same sender for batch, or resolve per message)
  const { resolveSender } = require('./mitto.service');
  const TRAFFIC_ACCOUNT_ID = process.env.SMS_TRAFFIC_ACCOUNT_ID || process.env.MITTO_TRAFFIC_ACCOUNT_ID;
  
  const mittoMessages = [];
  const messageMapping = []; // Maps index in mittoMessages to internal message data

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Resolve sender (use createdById for sender resolution, or ownerId as fallback)
    let finalSender;
    try {
      finalSender = await resolveSender(msg.createdById || ownerId, msg.sender);
    } catch (senderErr) {
      logger.warn({ ownerId, messageIndex: i, err: senderErr.message }, 'Failed to resolve sender, skipping message');
      continue; // Skip this message
    }

    // Shorten any URLs in the message text first
    let finalText = await shortenUrlsInText(msg.text);

    // Append unsubscribe link if contactId is provided
    if (msg.contactId) {
      try {
        const unsubscribeToken = generateUnsubscribeToken(msg.contactId, ownerId, msg.meta?.campaignId || null);
        const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${unsubscribeToken}`;
        const shortenedUnsubscribeUrl = await shortenUrl(unsubscribeUrl);
        finalText += `\n\nTo unsubscribe, tap: ${shortenedUnsubscribeUrl}`;
      } catch (tokenErr) {
        logger.warn({ ownerId, contactId: msg.contactId, err: tokenErr.message }, 'Failed to generate unsubscribe token, sending without link');
        // Continue without unsubscribe link if token generation fails
      }
    }

    const trafficAccountId = msg.trafficAccountId || TRAFFIC_ACCOUNT_ID;
    if (!trafficAccountId) {
      logger.warn({ ownerId, messageIndex: i }, 'No traffic account ID, skipping message');
      continue; // Skip this message
    }

    mittoMessages.push({
      trafficAccountId,
      destination: msg.destination,
      sms: {
        text: finalText,
        sender: finalSender
      }
    });

    messageMapping.push({
      index: mittoMessages.length - 1,
      internalMessageId: msg.internalMessageId,
      ownerId: msg.ownerId,
      destination: msg.destination,
      text: finalText,
      meta: msg.meta || {}
    });
  }

  if (mittoMessages.length === 0) {
    logger.error({ ownerId }, 'No valid messages to send after preparation');
    return {
      bulkId: null,
      results: messages.map(msg => ({
        internalMessageId: msg.internalMessageId,
        sent: false,
        reason: 'preparation_failed',
        error: 'Message preparation failed'
      })),
      summary: {
        total: messages.length,
        sent: 0,
        failed: messages.length
      }
    };
  }

  // 4. Check rate limits before sending
  const { checkAllLimits } = require('./rateLimiter.service');
  const trafficAccountId = mittoMessages[0]?.trafficAccountId || TRAFFIC_ACCOUNT_ID;
  
  const rateLimitCheck = await checkAllLimits(trafficAccountId, ownerId);
  if (!rateLimitCheck.allowed) {
    logger.warn({ 
      ownerId, 
      trafficAccountId,
      trafficAccountRemaining: rateLimitCheck.trafficAccountLimit.remaining,
      tenantRemaining: rateLimitCheck.tenantLimit.remaining
    }, 'Rate limit exceeded, will retry with backoff (Phase 2.1)');
    
    // Throw error instead of returning - allows worker to retry with exponential backoff
    // Worker's isRetryable() will recognize this as retryable
    const error = new Error('Rate limit exceeded. Will retry after backoff.');
    error.reason = 'rate_limit_exceeded';
    error.retryable = true; // Explicit flag for clarity
    throw error; // Worker will catch and retry
  }

  // 5. Send bulk SMS via Mitto
  try {
    const result = await sendBulkMessages(mittoMessages);

    // 6. Map response messageIds to input messages
    // Response order should match request order
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    // Create a map of response messageIds by index
    const responseMap = new Map();
    for (let i = 0; i < result.messages.length; i++) {
      const respMsg = result.messages[i];
      if (respMsg.messageId) {
        responseMap.set(i, respMsg);
      }
    }

    // Process each message in our mapping
    for (const mapping of messageMapping) {
      const respMsg = responseMap.get(mapping.index);
      
      if (respMsg && respMsg.messageId) {
        // Message sent successfully - debit credits
        try {
          const debitResult = await debit(mapping.ownerId, 1, {
            reason: mapping.meta.reason || 'sms:send:bulk',
            campaignId: mapping.meta.campaignId || null,
            messageId: mapping.internalMessageId || null,
            meta: { ...mapping.meta, bulkId: result.bulkId }
          });
          
          logger.debug({ 
            ownerId: mapping.ownerId, 
            internalMessageId: mapping.internalMessageId,
            messageId: respMsg.messageId,
            balanceAfter: debitResult.balance 
          }, 'Credits debited after successful bulk send');

          results.push({
            internalMessageId: mapping.internalMessageId,
            sent: true,
            messageId: respMsg.messageId,
            providerMessageId: respMsg.messageId,
            trafficAccountId: respMsg.trafficAccountId,
            balanceAfter: debitResult.balance
          });
          successCount++;
        } catch (debitErr) {
          // Log error but don't fail - message was already sent
          logger.error({ 
            ownerId: mapping.ownerId, 
            internalMessageId: mapping.internalMessageId,
            err: debitErr.message 
          }, 'Failed to debit credits after successful bulk send');
          
          results.push({
            internalMessageId: mapping.internalMessageId,
            sent: true,
            messageId: respMsg.messageId,
            providerMessageId: respMsg.messageId,
            trafficAccountId: respMsg.trafficAccountId,
            balanceAfter: balance // Return original balance if debit failed
          });
          successCount++;
        }
      } else {
        // No messageId in response - treat as failure
        logger.error({ 
          ownerId: mapping.ownerId, 
          internalMessageId: mapping.internalMessageId,
          destination: mapping.destination 
        }, 'Mitto bulk send succeeded but no messageId returned for message');
        
        results.push({
          internalMessageId: mapping.internalMessageId,
          sent: false,
          reason: 'send_failed',
          error: 'Mitto send succeeded but no messageId returned'
        });
        failureCount++;
      }
    }

    // Handle messages that were skipped during preparation
    const processedInternalIds = new Set(messageMapping.map(m => m.internalMessageId));
    for (const msg of messages) {
      if (!processedInternalIds.has(msg.internalMessageId)) {
        results.push({
          internalMessageId: msg.internalMessageId,
          sent: false,
          reason: 'preparation_failed',
          error: 'Message was skipped during preparation'
        });
        failureCount++;
      }
    }

    logger.info({ 
      ownerId, 
      bulkId: result.bulkId,
      total: messages.length,
      sent: successCount,
      failed: failureCount
    }, 'Bulk SMS send completed');

    return {
      bulkId: result.bulkId,
      results,
      summary: {
        total: messages.length,
        sent: successCount,
        failed: failureCount
      },
      rawResponse: result.rawResponse
    };
  } catch (err) {
    // 7. On send failure, do NOT debit credits (no messageId = no debit)
    logger.warn({ ownerId, messageCount: messages.length, err: err.message }, 'Bulk SMS send failed, no credits debited');

    return {
      bulkId: null,
      results: messages.map(msg => ({
        internalMessageId: msg.internalMessageId,
        sent: false,
        reason: 'send_failed',
        error: err.message,
        balanceAfter: balance
      })),
      summary: {
        total: messages.length,
        sent: 0,
        failed: messages.length
      }
    };
  }
}

module.exports = {
  sendBulkSMSWithCredits
};

