// apps/api/src/services/conversion.service.js
// Conversion tracking service for NFC-based visit confirmation

const prisma = require('../lib/prisma');
const { normalizePhoneToE164 } = require('../lib/phone');
const pino = require('pino');

const logger = pino({ name: 'conversion-service' });

/**
 * Record a conversion event (in-store visit confirmation via NFC)
 * 
 * @param {Object} params
 * @param {number} params.storeId - Store ID
 * @param {string} params.phone - Contact phone number (E.164 format)
 * @param {number} params.nfcTagId - NFC tag ID used for conversion
 * @param {number} [params.campaignId] - Optional campaign ID
 * @param {number} [params.campaignMessageId] - Optional campaign message ID
 * @returns {Promise<Object>} Conversion event
 */
async function recordConversion({ storeId, phone, nfcTagId, campaignId, campaignMessageId }) {
  // Normalize phone to E.164 format
  const normalizedPhone = normalizePhoneToE164(phone);
  if (!normalizedPhone) {
    throw new Error('INVALID_PHONE');
  }

  // Find contact by phone in store
  const contact = await prisma.contact.findUnique({
    where: {
      ownerId_phone: {
        ownerId: storeId,
        phone: normalizedPhone
      }
    }
  });

  if (!contact) {
    throw new Error('CONTACT_NOT_FOUND');
  }

  // If campaignId or campaignMessageId not provided, try to find most recent active campaign
  let finalCampaignId = campaignId;
  let finalCampaignMessageId = campaignMessageId;

  if (!finalCampaignId && !finalCampaignMessageId) {
    // Find most recent campaign message for this contact in this store
    const recentMessage = await prisma.campaignMessage.findFirst({
      where: {
        ownerId: storeId,
        contactId: contact.id,
        status: 'sent' // Note: "delivered" is mapped to "sent"
      },
      orderBy: {
        sentAt: 'desc'
      },
      include: {
        campaign: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    if (recentMessage) {
      finalCampaignMessageId = recentMessage.id;
      finalCampaignId = recentMessage.campaign.id;
    }
  }

  // Verify NFC tag exists and belongs to store
  const nfcTag = await prisma.nfcTag.findFirst({
    where: {
      id: nfcTagId,
      storeId: storeId,
      type: 'conversion',
      status: 'active'
    }
  });

  if (!nfcTag) {
    throw new Error('NFC_TAG_NOT_FOUND_OR_INACTIVE');
  }

  // Create conversion event
  const conversionEvent = await prisma.conversionEvent.create({
    data: {
      storeId,
      contactId: contact.id,
      nfcTagId,
      campaignId: finalCampaignId || null,
      campaignMessageId: finalCampaignMessageId || null,
      occurredAt: new Date(),
      metadata: {
        phone: normalizedPhone,
        timestamp: new Date().toISOString()
      }
    },
    include: {
      contact: {
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true
        }
      },
      campaign: {
        select: {
          id: true,
          name: true
        }
      },
      nfcTag: {
        select: {
          id: true,
          label: true,
          publicId: true
        }
      }
    }
  });

  logger.info({
    storeId,
    contactId: contact.id,
    nfcTagId,
    campaignId: finalCampaignId,
    conversionEventId: conversionEvent.id
  }, 'Conversion event recorded');

  return conversionEvent;
}

/**
 * Get conversion events for a campaign
 * 
 * @param {number} campaignId - Campaign ID
 * @param {number} ownerId - Store owner ID (for scoping)
 * @returns {Promise<Array>} Array of conversion events
 */
async function getCampaignConversions(campaignId, ownerId) {
  return await prisma.conversionEvent.findMany({
    where: {
      campaignId,
      storeId: ownerId
    },
    include: {
      contact: {
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true
        }
      },
      nfcTag: {
        select: {
          id: true,
          label: true,
          publicId: true
        }
      }
    },
    orderBy: {
      occurredAt: 'desc'
    }
  });
}

/**
 * Get conversion count for a campaign
 * 
 * @param {number} campaignId - Campaign ID
 * @param {number} ownerId - Store owner ID (for scoping)
 * @returns {Promise<number>} Conversion count
 */
async function getCampaignConversionCount(campaignId, ownerId) {
  return await prisma.conversionEvent.count({
    where: {
      campaignId,
      storeId: ownerId
    }
  });
}

module.exports = {
  recordConversion,
  getCampaignConversions,
  getCampaignConversionCount
};

