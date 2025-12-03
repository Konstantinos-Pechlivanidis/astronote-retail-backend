// apps/api/src/lib/phone.js
// Phone number validation and normalization using libphonenumber-js
const { parsePhoneNumber, isValidPhoneNumber, AsYouType } = require('libphonenumber-js');

/**
 * Normalize phone number to E.164 format
 * @param {string} phone - Phone number in any format
 * @param {string} defaultCountry - Default country code (e.g., 'GR', 'US')
 * @returns {string|null} E.164 formatted phone number or null if invalid
 */
function normalizePhoneToE164(phone, defaultCountry = 'GR') {
  if (!phone || typeof phone !== 'string') {
    return null;
  }
  
  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }

  try {
    // Try to parse the phone number
    const phoneNumber = parsePhoneNumber(trimmed, defaultCountry);
    
    if (phoneNumber && phoneNumber.isValid()) {
      return phoneNumber.number; // Returns E.164 format (e.g., +306984303406)
    }
    
    return null;
  } catch (err) {
    // If parsing fails, try with AsYouType formatter
    try {
      const formatter = new AsYouType(defaultCountry);
      formatter.input(trimmed);
      const phoneNumber = formatter.getNumber();
      
      if (phoneNumber && phoneNumber.isValid()) {
        return phoneNumber.number;
      }
    } catch (e) {
      // Ignore
    }
    
    return null;
  }
}

/**
 * Validate phone number
 * @param {string} phone - Phone number to validate
 * @param {string} defaultCountry - Default country code
 * @returns {boolean} True if valid
 */
function isValidPhone(phone, defaultCountry = 'GR') {
  if (!phone || typeof phone !== 'string') {
    return false;
  }
  return isValidPhoneNumber(phone.trim(), defaultCountry);
}

/**
 * Format phone number for display (international format)
 * @param {string} phone - E.164 phone number
 * @returns {string} Formatted phone number
 */
function formatPhoneForDisplay(phone) {
  if (!phone) {
    return '';
  }
  try {
    const phoneNumber = parsePhoneNumber(phone);
    return phoneNumber.formatInternational();
  } catch {
    return phone;
  }
}

module.exports = {
  normalizePhoneToE164,
  isValidPhone,
  formatPhoneForDisplay
};

