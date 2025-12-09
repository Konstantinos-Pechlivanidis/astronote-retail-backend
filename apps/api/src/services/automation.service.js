// apps/api/src/services/automation.service.js
// Automation service for welcome and birthday messages

const prisma = require('../lib/prisma');
const { sendSMSWithCredits } = require('./sms.service');
const { render } = require('../lib/template');
const crypto = require('node:crypto');
const pino = require('pino');

const logger = pino({ name: 'automation-service' });

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

// Base URL for offer links (from env or default)
const baseOfferUrl = process.env.OFFER_BASE_URL || process.env.FRONTEND_URL || 'https://astronote-retail-frontend.onrender.com';
const OFFER_BASE_URL = ensureRetailPath(baseOfferUrl);

function newTrackingId() {
  return crypto.randomBytes(9).toString('base64url');
}

const AUTOMATION_TYPES = {
  WELCOME: 'welcome_message',
  BIRTHDAY: 'birthday_message'
};

/**
 * Get or create automation for a store
 * Ensures exactly two automations exist per store (welcome and birthday)
 */
async function getOrCreateAutomation(ownerId, type) {
  let automation = await prisma.automation.findUnique({
    where: {
      ownerId_type: {
        ownerId,
        type
      }
    }
  });

  if (!automation) {
    // Create with default inactive state and default message
    const defaultMessages = {
      [AUTOMATION_TYPES.WELCOME]: 'Hi {{first_name}}, welcome to our community! 🎉',
      [AUTOMATION_TYPES.BIRTHDAY]: 'Happy Birthday {{first_name}}! 🎂 We hope you have a wonderful day!'
    };

    automation = await prisma.automation.create({
      data: {
        ownerId,
        type,
        isActive: false, // Default to inactive
        messageBody: defaultMessages[type] || 'Hello {{first_name}}!'
      }
    });
  }

  return automation;
}

/**
 * Get all automations for a store
 * Returns both welcome and birthday automations (creates if missing)
 */
async function getAutomations(ownerId) {
  const [welcome, birthday] = await Promise.all([
    getOrCreateAutomation(ownerId, AUTOMATION_TYPES.WELCOME),
    getOrCreateAutomation(ownerId, AUTOMATION_TYPES.BIRTHDAY)
  ]);

  return {
    welcome: {
      id: welcome.id,
      type: welcome.type,
      isActive: welcome.isActive,
      messageBody: welcome.messageBody,
      createdAt: welcome.createdAt,
      updatedAt: welcome.updatedAt
    },
    birthday: {
      id: birthday.id,
      type: birthday.type,
      isActive: birthday.isActive,
      messageBody: birthday.messageBody,
      createdAt: birthday.createdAt,
      updatedAt: birthday.updatedAt
    }
  };
}

/**
 * Update automation (enable/disable or edit message)
 */
async function updateAutomation(ownerId, type, updates) {
  // Ensure automation exists
  await getOrCreateAutomation(ownerId, type);

  const automation = await prisma.automation.updateMany({
    where: {
      ownerId,
      type
    },
    data: {
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
      ...(updates.messageBody !== undefined && { messageBody: updates.messageBody }),
      updatedAt: new Date()
    }
  });

  if (automation.count === 0) {
    throw new Error('Automation not found');
  }

  return await prisma.automation.findUnique({
    where: {
      ownerId_type: {
        ownerId,
        type
      }
    }
  });
}

/**
 * Trigger welcome message automation
 * Called when a new contact opts in
 */
async function triggerWelcomeAutomation(ownerId, contact) {
  // Log for debugging
  logger.debug({ 
    ownerId, 
    contactId: contact.id, 
    isSubscribed: contact.isSubscribed,
    hasFirstName: !!contact.firstName,
    hasLastName: !!contact.lastName
  }, 'Triggering welcome automation');
  
  // Only send to subscribed contacts
  if (!contact.isSubscribed) {
    logger.info({ ownerId, contactId: contact.id }, 'Welcome automation skipped: contact not subscribed');
    return { sent: false, reason: 'contact_not_subscribed' };
  }

  // Get welcome automation
  const automation = await prisma.automation.findUnique({
    where: {
      ownerId_type: {
        ownerId,
        type: AUTOMATION_TYPES.WELCOME
      }
    }
  });

  // Check if active
  if (!automation || !automation.isActive) {
    logger.info({ 
      ownerId, 
      contactId: contact.id,
      automationExists: !!automation,
      isActive: automation?.isActive 
    }, 'Welcome automation skipped: automation inactive or missing');
    return { sent: false, reason: 'automation_inactive' };
  }

  // Render message with contact placeholders
  let messageText = render(automation.messageBody, contact);
  
  if (!messageText || !messageText.trim()) {
    logger.error({ ownerId, contactId: contact.id, messageBody: automation.messageBody }, 'Welcome automation message is empty after rendering');
    return { sent: false, reason: 'empty_message', error: 'Message body is empty after rendering' };
  }

  // Generate trackingId and offer link
  const trackingId = newTrackingId();
  const offerUrl = `${OFFER_BASE_URL}/o/${trackingId}`;
  
  // Append offer link to message
  messageText += `\n\nView offer: ${offerUrl}`;

  // Get sender name (using resolveSender which handles user lookup internally)
  const { resolveSender } = require('./mitto.service');
  let sender;
  try {
    sender = await resolveSender(ownerId, null);
    if (!sender) {
      logger.error({ ownerId }, 'No sender configured for welcome automation');
      return { sent: false, reason: 'no_sender_configured', error: 'No sender name configured' };
    }
  } catch (err) {
    logger.error({ ownerId, err: err.message }, 'Failed to resolve sender for welcome automation');
    return { sent: false, reason: 'no_sender_configured', error: err.message };
  }
  
  // Validate phone number
  if (!contact.phone || !contact.phone.trim()) {
    logger.error({ ownerId, contactId: contact.id }, 'Contact phone number is missing');
    return { sent: false, reason: 'invalid_phone', error: 'Contact phone number is missing' };
  }

  // Send SMS via Mitto with credit enforcement
  const result = await sendSMSWithCredits({
    ownerId,
    destination: contact.phone,
    text: messageText,
    sender: sender,
    contactId: contact.id, // Pass contactId for unsubscribe link generation
    meta: {
      reason: 'automation:welcome',
      automationType: AUTOMATION_TYPES.WELCOME,
      automationId: automation.id
    }
  });

  // Create AutomationMessage record
  try {
    if (result.sent && result.messageId) {
      // Message sent successfully
      await prisma.automationMessage.create({
        data: {
          ownerId,
          automationId: automation.id,
          contactId: contact.id,
          to: contact.phone,
          text: messageText,
          trackingId,
          status: 'sent',
          providerMessageId: result.messageId,
          sentAt: new Date()
        }
      });
      logger.debug({ ownerId, automationId: automation.id, contactId: contact.id, trackingId }, 'AutomationMessage created (sent)');
    } else {
      // Message failed to send
      await prisma.automationMessage.create({
        data: {
          ownerId,
          automationId: automation.id,
          contactId: contact.id,
          to: contact.phone,
          text: messageText,
          trackingId,
          status: 'failed',
          error: result.error || result.reason || 'Send failed',
          failedAt: new Date()
        }
      });
      logger.debug({ ownerId, automationId: automation.id, contactId: contact.id, trackingId }, 'AutomationMessage created (failed)');
    }
  } catch (dbErr) {
    logger.error({ ownerId, automationId: automation.id, contactId: contact.id, err: dbErr.message }, 'Failed to create AutomationMessage record');
    // Don't fail the automation if DB write fails - message was already sent
  }

  // Log result
  if (result.sent) {
    logger.info({ 
      ownerId, 
      contactId: contact.id,
      messageId: result.messageId,
      destination: contact.phone,
      trackingId
    }, 'Welcome automation message sent successfully');
  } else if (result.reason === 'inactive_subscription') {
    logger.warn({ 
      ownerId, 
      contactId: contact.id
    }, 'Welcome automation blocked: inactive subscription');
  } else if (result.reason === 'insufficient_credits') {
    logger.warn({ 
      ownerId, 
      contactId: contact.id,
      balance: result.balanceAfter
    }, 'Welcome automation blocked: insufficient credits');
  } else {
    logger.error({ 
      ownerId, 
      contactId: contact.id, 
      reason: result.reason,
      error: result.error 
    }, 'Welcome automation send failed');
  }

  return result;
}

/**
 * Process birthday automations for all stores
 * Should be called daily (via scheduled job)
 */
async function processBirthdayAutomations() {
  const today = new Date();
  const month = today.getMonth() + 1; // 1-12
  const day = today.getDate(); // 1-31

  logger.debug({ month, day }, 'Processing birthday automations for today');

  // Find all active birthday automations
  const activeBirthdayAutomations = await prisma.automation.findMany({
    where: {
      type: AUTOMATION_TYPES.BIRTHDAY,
      isActive: true
    },
    include: {
      owner: {
        select: { id: true, senderName: true }
      }
    }
  });

  if (activeBirthdayAutomations.length === 0) {
    logger.info('No active birthday automations found');
    return { processed: 0, sent: 0, failed: 0, storesProcessed: 0 };
  }

  logger.debug({ count: activeBirthdayAutomations.length }, 'Found active birthday automations');

  let totalProcessed = 0;
  let totalSent = 0;
  let totalFailed = 0;

  for (const automation of activeBirthdayAutomations) {
    logger.debug({ ownerId: automation.ownerId }, 'Processing birthday automation for store');

    // Find contacts with birthday today
    const contacts = await prisma.contact.findMany({
      where: {
        ownerId: automation.ownerId,
        isSubscribed: true,
        birthday: {
          not: null
        }
      }
    });

    // Filter contacts whose birthday is today
    const birthdayContacts = contacts.filter(contact => {
      if (!contact.birthday) {return false;}
      const birthDate = new Date(contact.birthday);
      return birthDate.getMonth() + 1 === month && birthDate.getDate() === day;
    });

    if (birthdayContacts.length === 0) {
      logger.debug({ ownerId: automation.ownerId }, 'No contacts with birthday today for this store');
      continue;
    }

    logger.debug({ 
      ownerId: automation.ownerId, 
      contactCount: birthdayContacts.length 
    }, 'Found contacts with birthday today');

    // Get sender name
    const { resolveSender } = require('./mitto.service');
    let sender;
    try {
      sender = await resolveSender(automation.ownerId, null);
      if (!sender) {
        logger.error({ ownerId: automation.ownerId }, 'No sender configured for birthday automation');
        totalFailed += birthdayContacts.length;
        continue;
      }
    } catch (err) {
      logger.error({ ownerId: automation.ownerId, err: err.message }, 'Failed to resolve sender for birthday automation');
      totalFailed += birthdayContacts.length;
      continue;
    }

    // Send birthday message to each contact
    for (const contact of birthdayContacts) {
      totalProcessed++;

      logger.debug({ 
        ownerId: automation.ownerId,
        contactId: contact.id,
        hasFirstName: !!contact.firstName,
        hasLastName: !!contact.lastName,
        phone: contact.phone
      }, 'Processing birthday message for contact');

      try {
        // Validate phone number
        if (!contact.phone || !contact.phone.trim()) {
          logger.error({ 
            ownerId: automation.ownerId, 
            contactId: contact.id 
          }, 'Contact phone number is missing for birthday automation');
          totalFailed++;
          continue;
        }

        // Render message with contact placeholders
        let messageText = render(automation.messageBody, contact);
        
        if (!messageText || !messageText.trim()) {
          logger.error({ 
            ownerId: automation.ownerId, 
            contactId: contact.id, 
            messageBody: automation.messageBody 
          }, 'Birthday automation message is empty after rendering');
          totalFailed++;
          continue;
        }

        // Generate trackingId and offer link
        const trackingId = newTrackingId();
        const offerUrl = `${OFFER_BASE_URL}/o/${trackingId}`;
        
        // Append offer link to message
        messageText += `\n\nView offer: ${offerUrl}`;

        // Send SMS via Mitto with credit enforcement
        const result = await sendSMSWithCredits({
          ownerId: automation.ownerId,
          destination: contact.phone,
          text: messageText,
          sender: sender,
          contactId: contact.id, // Pass contactId for unsubscribe link generation
          meta: {
            reason: 'automation:birthday',
            automationType: AUTOMATION_TYPES.BIRTHDAY,
            automationId: automation.id
          }
        });

        // Create AutomationMessage record
        try {
          if (result.sent && result.messageId) {
            // Message sent successfully
            await prisma.automationMessage.create({
              data: {
                ownerId: automation.ownerId,
                automationId: automation.id,
                contactId: contact.id,
                to: contact.phone,
                text: messageText,
                trackingId,
                status: 'sent',
                providerMessageId: result.messageId,
                sentAt: new Date()
              }
            });
            logger.debug({ ownerId: automation.ownerId, automationId: automation.id, contactId: contact.id, trackingId }, 'AutomationMessage created (sent)');
          } else {
            // Message failed to send
            await prisma.automationMessage.create({
              data: {
                ownerId: automation.ownerId,
                automationId: automation.id,
                contactId: contact.id,
                to: contact.phone,
                text: messageText,
                trackingId,
                status: 'failed',
                error: result.error || result.reason || 'Send failed',
                failedAt: new Date()
              }
            });
            logger.debug({ ownerId: automation.ownerId, automationId: automation.id, contactId: contact.id, trackingId }, 'AutomationMessage created (failed)');
          }
        } catch (dbErr) {
          logger.error({ ownerId: automation.ownerId, automationId: automation.id, contactId: contact.id, err: dbErr.message }, 'Failed to create AutomationMessage record');
          // Don't fail the automation if DB write fails - message was already sent
        }

        // Log result
        if (result.sent) {
          totalSent++;
          logger.info({ 
            ownerId: automation.ownerId, 
            contactId: contact.id,
            messageId: result.messageId,
            destination: contact.phone,
            trackingId
          }, 'Birthday automation message sent successfully');
        } else if (result.reason === 'inactive_subscription') {
          logger.warn({ 
            ownerId: automation.ownerId, 
            contactId: contact.id
          }, 'Birthday automation blocked: inactive subscription');
        } else if (result.reason === 'insufficient_credits') {
          logger.warn({ 
            ownerId: automation.ownerId, 
            contactId: contact.id,
            balance: result.balanceAfter
          }, 'Birthday automation blocked: insufficient credits');
          totalFailed++;
        } else {
          logger.error({ 
            ownerId: automation.ownerId, 
            contactId: contact.id,
            reason: result.reason,
            error: result.error 
          }, 'Birthday automation send failed');
          totalFailed++;
        }
      } catch (err) {
        logger.error({ 
          ownerId: automation.ownerId, 
          contactId: contact.id, 
          err: err.message,
          stack: err.stack
        }, 'Birthday automation error');
        totalFailed++;
      }
    }
  }

  logger.info({
    processed: totalProcessed,
    sent: totalSent,
    failed: totalFailed,
    storesProcessed: activeBirthdayAutomations.length
  }, 'Birthday automations processing completed');

  return {
    processed: totalProcessed,
    sent: totalSent,
    failed: totalFailed,
    storesProcessed: activeBirthdayAutomations.length
  };
}

module.exports = {
  getAutomations,
  updateAutomation,
  triggerWelcomeAutomation,
  processBirthdayAutomations,
  AUTOMATION_TYPES
};

