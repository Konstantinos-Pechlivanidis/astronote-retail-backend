// apps/api/src/services/nfc.service.js
const prisma = require('../lib/prisma');
const crypto = require('node:crypto');
const pino = require('pino');
const logger = pino({ name: 'nfc-service' });

/**
 * Basic phone validation (lightweight for MVP)
 */
function isPlausiblePhone(s) {
  if (!s) {return false;}
  const v = String(s).trim();
  return /^[+\d][\d]{7,19}$/.test(v.replace(/\s+/g, ''));
}

/**
 * Normalize phone number (remove whitespace)
 */
function normalizePhone(s) {
  return String(s).replace(/\s+/g, '');
}

/**
 * Basic email validation
 */
function isValidEmail(email) {
  if (!email) {return false;}
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Generate unsubscribe token hash for new contacts
 */
function newUnsubTokenHash() {
  const raw = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/**
 * Resolve NFC tag by public identifier
 * Returns tag with store (User) and campaign if linked
 */
async function resolveNfcTag(publicId) {
  if (!publicId || typeof publicId !== 'string') {
    return null;
  }

  const tag = await prisma.nfcTag.findUnique({
    where: { publicId },
    include: {
      store: {
        select: {
          id: true,
          email: true,
          company: true,
          senderName: true
        }
      },
      campaign: {
        select: {
          id: true,
          name: true,
          status: true
        }
      },
      formConfig: {
        select: {
          id: true,
          fields: true,
          consentText: true,
          language: true
        }
      }
    }
  });

  return tag;
}

/**
 * Get NFC configuration for frontend
 * Returns everything needed to render the form
 */
async function getNfcConfig(publicId) {
  const tag = await resolveNfcTag(publicId);

  if (!tag) {
    return { error: 'TAG_NOT_FOUND' };
  }

  if (tag.status !== 'active' && tag.status !== 'test') {
    return { error: 'TAG_INACTIVE', status: tag.status };
  }

  return {
    tag: {
      id: tag.id,
      publicId: tag.publicId,
      label: tag.label,
      status: tag.status,
      type: tag.type || 'opt_in' // Default to opt_in for backward compatibility
    },
    store: {
      id: tag.store.id,
      name: tag.store.company || tag.store.email,
      email: tag.store.email
    },
    campaign: tag.campaign ? {
      id: tag.campaign.id,
      name: tag.campaign.name,
      status: tag.campaign.status
    } : null,
    formConfig: tag.formConfig ? {
      fields: tag.formConfig.fields,
      consentText: tag.formConfig.consentText,
      language: tag.formConfig.language
    } : {
      fields: {
        phone: { required: true, type: 'tel' },
        email: { required: false, type: 'email' },
        firstName: { required: false, type: 'text' },
        lastName: { required: false, type: 'text' }
      },
      consentText: 'I consent to receive marketing communications.',
      language: 'en'
    }
  };
}

/**
 * Create or update contact from NFC form submission
 * Implements merge logic: if contact exists by phone in store, update it; otherwise create new
 */
async function createOrUpdateContactFromNfc(storeId, tagId, campaignId, formData, _requestMetadata = {}) {
  const { phone, email, firstName, lastName, gender, birthday, consent } = formData;

  // Validation - all fields required for NFC opt-in
  if (!phone) {
    throw new Error('PHONE_REQUIRED');
  }

  // Use new phone validation (E.164 format)
  const { normalizePhoneToE164 } = require('../lib/phone');
  const normalizedPhone = normalizePhoneToE164(phone);
  if (!normalizedPhone) {
    throw new Error('INVALID_PHONE');
  }

  if (!email) {
    throw new Error('EMAIL_REQUIRED');
  }

  if (!isValidEmail(email)) {
    throw new Error('INVALID_EMAIL');
  }

  if (!firstName || !firstName.trim()) {
    throw new Error('FIRST_NAME_REQUIRED');
  }

  if (!lastName || !lastName.trim()) {
    throw new Error('LAST_NAME_REQUIRED');
  }

  if (!consent) {
    throw new Error('CONSENT_REQUIRED');
  }

  // Validate gender if provided
  const { normalizeGender } = require('../lib/validation');
  let normalizedGender = null;
  if (gender) {
    normalizedGender = normalizeGender(gender);
    if (!normalizedGender) {
      throw new Error('INVALID_GENDER');
    }
  }

  // Validate birthday if provided
  const { isValidBirthday } = require('../lib/validation');
  let birthdayDate = null;
  if (birthday) {
    if (!isValidBirthday(birthday)) {
      throw new Error('INVALID_BIRTHDAY');
    }
    birthdayDate = birthday instanceof Date ? birthday : new Date(birthday);
  }

  // Check for existing contact
  const existingContact = await prisma.contact.findUnique({
    where: {
      ownerId_phone: {
        ownerId: storeId,
        phone: normalizedPhone
      }
    }
  });

  let contact;
  let isNew = false;

  if (existingContact) {
    // Update existing contact
    const updateData = {
      isSubscribed: true, // Ensure subscribed when opting in via NFC
      unsubscribedAt: null,
      email: email.trim(), // Required for NFC opt-in
      firstName: firstName.trim(), // Required for NFC opt-in
      lastName: lastName.trim() // Required for NFC opt-in
    };

    if (normalizedGender) {updateData.gender = normalizedGender;}
    if (birthdayDate) {updateData.birthday = birthdayDate;}

    contact = await prisma.contact.update({
      where: { id: existingContact.id },
      data: updateData
    });
  } else {
    // Create new contact
    const { hash } = newUnsubTokenHash();

    contact = await prisma.contact.create({
      data: {
        ownerId: storeId,
        phone: normalizedPhone, // E.164 format
        email: email.trim(), // Required for NFC opt-in
        firstName: firstName.trim(), // Required for NFC opt-in
        lastName: lastName.trim(), // Required for NFC opt-in
        gender: normalizedGender,
        birthday: birthdayDate,
        isSubscribed: true,
        unsubscribeTokenHash: hash
      }
    });
    isNew = true;

    // Trigger welcome automation for new opted-in contacts (non-blocking)
    const { triggerWelcomeAutomation } = require('./automation.service');
    triggerWelcomeAutomation(storeId, contact).catch(err => {
      // Log but don't fail contact creation
      logger.error({ storeId, contactId: contact.id, err: err.message }, 'Welcome automation failed');
    });
  }

  return { contact, isNew };
}

/**
 * Record NFC scan for analytics
 */
async function recordNfcScan(tagId, storeId, status, metadata = {}) {
  try {
    const scan = await prisma.nfcScan.create({
      data: {
        tagId,
        storeId,
        status,
        ipAddress: metadata.ipAddress || null,
        userAgent: metadata.userAgent || null,
        deviceType: metadata.deviceType || null,
        contactId: metadata.contactId || null
      }
    });
    return scan;
  } catch (err) {
    logger.warn({ tagId, storeId, err: err.message }, 'Failed to record scan');
    return null;
  }
}

/**
 * Update NFC scan with contact reference (after contact creation/update)
 */
async function linkNfcScanToContact(scanId, contactId) {
  try {
    await prisma.nfcScan.update({
      where: { id: scanId },
      data: { contactId, status: 'submitted' }
    });
  } catch (err) {
    logger.warn({ scanId, contactId, err: err.message }, 'Failed to link scan to contact');
  }
}

module.exports = {
  resolveNfcTag,
  getNfcConfig,
  createOrUpdateContactFromNfc,
  recordNfcScan,
  linkNfcScanToContact,
  isPlausiblePhone,
  normalizePhone,
  isValidEmail
};

