// apps/api/src/services/mitto.service.js
const prisma = require('../lib/prisma');
const { sanitizeSender } = require('./sender.util');
const pino = require('pino');

const logger = pino({ name: 'mitto-service' });

// Configuration from environment variables
const BASE = process.env.MITTO_API_BASE || 'https://messaging.mittoapi.com';
const API_KEY = process.env.MITTO_API_KEY;
const TRAFFIC_ACCOUNT_ID = process.env.SMS_TRAFFIC_ACCOUNT_ID || process.env.MITTO_TRAFFIC_ACCOUNT_ID;
const FALLBACK_SENDER = process.env.MITTO_SENDER;

/**
 * Resolve sender name from user, override, or environment fallback
 */
async function resolveSender(userId, overrideSender) {
  const s = sanitizeSender(overrideSender);
  if (s) {return s;}

  const user = await prisma.user.findUnique({ 
    where: { id: userId }, 
    select: { senderName: true } 
  });
  const fromUser = sanitizeSender(user?.senderName);
  if (fromUser) {return fromUser;}

  const fromEnv = sanitizeSender(FALLBACK_SENDER);
  if (fromEnv) {return fromEnv;}

  throw new Error('No valid sender configured (user or env)');
}

/**
 * Make HTTP request to Mitto API
 */
async function mittoRequest(method, path, body = null) {
  if (!API_KEY) {
    throw new Error('MITTO_API_KEY environment variable is required');
  }

  const url = `${BASE}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Mitto-API-Key': API_KEY
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    logger.debug({ url, method }, 'Mitto API request');
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data?.message || data?.error || res.statusText;
      const error = new Error(`Mitto API error (${res.status}): ${msg}`);
      error.status = res.status;
      error.payload = data;
      logger.error({ 
        status: res.status, 
        url, 
        error: msg, 
        payload: data 
      }, 'Mitto API request failed');
      throw error;
    }

    logger.debug({ url, method, status: res.status }, 'Mitto API request successful');
    return data;
  } catch (err) {
    if (err.status) {throw err;} // Already formatted error
    logger.error({ url, method, err: err.message }, 'Mitto API network error');
    throw new Error(`Mitto API network error: ${err.message}`);
  }
}

/**
 * Send a single SMS message via Mitto
 * 
 * @param {Object} params
 * @param {number} params.userId - User ID for sender resolution
 * @param {string} params.destination - Recipient phone number (international format)
 * @param {string} params.text - Message body
 * @param {string} [params.sender] - Optional sender override
 * @param {string} [params.trafficAccountId] - Optional traffic account ID override
 * @returns {Promise<Object>} Response with messageId and trafficAccountId
 */
async function sendSingle({ userId, destination, text, sender, trafficAccountId }) {
  if (!TRAFFIC_ACCOUNT_ID && !trafficAccountId) {
    throw new Error('SMS_TRAFFIC_ACCOUNT_ID or MITTO_TRAFFIC_ACCOUNT_ID environment variable is required');
  }

  const finalSender = await resolveSender(userId, sender);
  const trafficId = trafficAccountId || TRAFFIC_ACCOUNT_ID;

  logger.info({ 
    userId, 
    destination, 
    sender: finalSender,
    trafficAccountId: trafficId 
  }, 'Sending SMS via Mitto');

  const response = await mittoRequest('POST', '/api/v1.1/Messages/send', {
    trafficAccountId: trafficId,
    destination,
    sms: {
      text,
      sender: finalSender
    }
  });

  // Handle response format: { messages: [{ messageId, trafficAccountId }] }
  const message = response?.messages?.[0];
  if (!message || !message.messageId) {
    logger.error({ response }, 'Invalid Mitto response format');
    throw new Error('Invalid response from Mitto API: missing messageId');
  }

  logger.info({ 
    messageId: message.messageId, 
    trafficAccountId: message.trafficAccountId 
  }, 'SMS sent successfully via Mitto');

  return {
    messageId: message.messageId,
    trafficAccountId: message.trafficAccountId,
    rawResponse: response
  };
}

/**
 * Send bulk SMS messages via Mitto (new bulk endpoint)
 * 
 * @param {Array<Object>} messages - Array of message objects
 * @param {string} messages[].trafficAccountId - Traffic account ID
 * @param {string} messages[].destination - Recipient phone number
 * @param {string} messages[].sms.text - Message body
 * @param {string} messages[].sms.sender - Sender name
 * @returns {Promise<Object>} Response with bulkId and messages array
 */
async function sendBulkMessages(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }

  // Validate all messages have required fields
  for (const msg of messages) {
    if (!msg.trafficAccountId || !msg.destination || !msg.sms || !msg.sms.text) {
      throw new Error('Each message must have trafficAccountId, destination, and sms.text');
    }
  }

  logger.info({ 
    messageCount: messages.length 
  }, 'Sending bulk SMS via Mitto (new endpoint)');

  const response = await mittoRequest('POST', '/api/v1.1/Messages/sendmessagesbulk', {
    messages
  });

  // Validate response format
  if (!response.bulkId) {
    logger.error({ response }, 'Invalid Mitto bulk response format: missing bulkId');
    throw new Error('Invalid response from Mitto API: missing bulkId');
  }

  if (!response.messages || !Array.isArray(response.messages)) {
    logger.error({ response }, 'Invalid Mitto bulk response format: missing messages array');
    throw new Error('Invalid response from Mitto API: missing messages array');
  }

  logger.info({ 
    bulkId: response.bulkId,
    messageCount: response.messages.length 
  }, 'Bulk SMS sent successfully via Mitto');

  return {
    bulkId: response.bulkId,
    messages: response.messages,
    rawResponse: response
  };
}

/**
 * Send bulk SMS messages via Mitto (legacy endpoint - kept for backward compatibility)
 * 
 * @param {Object} params
 * @param {number} params.userId - User ID for sender resolution
 * @param {string[]} params.destinations - Array of recipient phone numbers
 * @param {string} params.text - Message body
 * @param {string} [params.sender] - Optional sender override
 * @param {string} [params.trafficAccountId] - Optional traffic account ID override
 * @returns {Promise<Object>} Response with messages array
 */
async function sendBulkStatic({ userId, destinations, text, sender, trafficAccountId }) {
  if (!TRAFFIC_ACCOUNT_ID && !trafficAccountId) {
    throw new Error('SMS_TRAFFIC_ACCOUNT_ID or MITTO_TRAFFIC_ACCOUNT_ID environment variable is required');
  }

  const finalSender = await resolveSender(userId, sender);
  const trafficId = trafficAccountId || TRAFFIC_ACCOUNT_ID;

  logger.info({ 
    userId, 
    destinationCount: destinations.length, 
    sender: finalSender,
    trafficAccountId: trafficId 
  }, 'Sending bulk SMS via Mitto');

  const response = await mittoRequest('POST', '/api/v1.1/Messages/sendbulk', {
    trafficAccountId: trafficId,
    destinations,
    sms: {
      text,
      sender: finalSender
    }
  });

  logger.info({ 
    messageCount: response?.messages?.length || 0 
  }, 'Bulk SMS sent via Mitto');

  return response;
}

/**
 * Get message status and details from Mitto by messageId
 * 
 * @param {string} messageId - Mitto message ID
 * @returns {Promise<Object>} Message details including deliveryStatus
 */
async function getMessageStatus(messageId) {
  if (!messageId) {
    throw new Error('messageId is required');
  }

  logger.info({ messageId }, 'Fetching message status from Mitto');

  try {
    const response = await mittoRequest('GET', `/api/v1.1/Messages/${messageId}`);

    if (!response.messageId) {
      logger.error({ response }, 'Invalid Mitto response format');
      throw new Error('Invalid response from Mitto API: missing messageId');
    }

    logger.info({ 
      messageId: response.messageId, 
      deliveryStatus: response.deliveryStatus 
    }, 'Message status retrieved from Mitto');

    return {
      messageId: response.messageId,
      text: response.text,
      sender: response.sender,
      conversation: response.conversation,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      trafficAccountId: response.trafficAccountId,
      deliveryStatus: response.deliveryStatus,
      messageParts: response.messageParts,
      requestInfo: response.requestInfo,
      rawResponse: response
    };
  } catch (err) {
    if (err.status === 404) {
      logger.warn({ messageId }, 'Message not found in Mitto');
      throw new Error(`Message not found: ${messageId}`);
    }
    logger.error({ messageId, err: err.message }, 'Failed to fetch message status from Mitto');
    throw err;
  }
}

/**
 * Update internal message record with status from Mitto
 * 
 * @param {string} providerMessageId - Mitto message ID
 * @param {number} [ownerId] - Optional owner ID for scoping
 * @returns {Promise<Object>} Updated message record
 */
async function refreshMessageStatus(providerMessageId, ownerId = null) {
  if (!providerMessageId) {
    throw new Error('providerMessageId is required');
  }

  logger.info({ providerMessageId, ownerId }, 'Refreshing message status from Mitto');

  try {
    const status = await getMessageStatus(providerMessageId);

    // Map Mitto deliveryStatus to our internal status (case-insensitive)
    const deliveryStatus = String(status.deliveryStatus || '').toLowerCase();
    let internalStatus = 'sent';
    // Map Mitto statuses to internal statuses
    // "Delivered" is mapped to "sent" - we only track "sent" as the delivery status
    if (deliveryStatus === 'delivered' || deliveryStatus === 'sent') {
      internalStatus = 'sent';
    } else if (deliveryStatus === 'failure' || deliveryStatus === 'failed') {
      internalStatus = 'failed';
    } else if (deliveryStatus) {
      // Unknown status - log warning but default to 'sent'
      logger.warn({ providerMessageId, deliveryStatus: status.deliveryStatus }, 'Unknown Mitto deliveryStatus, defaulting to sent');
      internalStatus = 'sent';
    }

    // Find message(s) by providerMessageId
    const where = { providerMessageId };
    if (ownerId) {
      where.ownerId = ownerId;
    }

    const messages = await prisma.campaignMessage.findMany({
      where,
      select: { id: true, ownerId: true, campaignId: true }
    });

    if (messages.length === 0) {
      logger.warn({ providerMessageId }, 'No local messages found for Mitto messageId');
      return { updated: 0, status };
    }

    // Update all matching messages
    const updateData = {
      status: internalStatus,
      updatedAt: new Date()
    };

    // Note: deliveredAt removed - "Delivered" status is mapped to "sent"
    // We only track sent/failed statuses, not a separate "delivered" status

    if (internalStatus === 'failed') {
      updateData.failedAt = new Date();
      updateData.error = `Mitto status: ${status.deliveryStatus}`;
    }

    // Use same where clause for updateMany to ensure consistency and security
    const result = await prisma.campaignMessage.updateMany({
      where,
      data: updateData
    });

    logger.info({ 
      providerMessageId, 
      updated: result.count,
      status: internalStatus 
    }, 'Message status updated from Mitto');

    // Update campaign aggregates for affected campaigns
    const affectedCampaignIds = [...new Set(messages.map(m => m.campaignId))];
    const { updateCampaignAggregates } = require('./campaignAggregates.service');
    
    for (const campaignId of affectedCampaignIds) {
      try {
        await updateCampaignAggregates(campaignId, messages[0].ownerId);
      } catch (aggErr) {
        logger.error({ campaignId, err: aggErr.message }, 'Failed to update campaign aggregates after status refresh');
        // Continue - don't fail the entire refresh
      }
    }

    return {
      updated: result.count,
      status,
      internalStatus,
      affectedCampaignIds
    };
  } catch (err) {
    logger.error({ providerMessageId, err: err.message }, 'Failed to refresh message status');
    throw err;
  }
}

module.exports = {
  sendSingle,
  sendBulkMessages,
  sendBulkStatic,
  getMessageStatus,
  refreshMessageStatus,
  resolveSender
};
