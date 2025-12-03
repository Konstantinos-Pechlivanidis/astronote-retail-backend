// apps/api/src/lib/sanitize.js
// Input sanitization utilities to prevent XSS and injection attacks

/**
 * Sanitize a string by removing potentially dangerous characters
 * @param {string} input - Input string to sanitize
 * @param {object} options - Sanitization options
 * @returns {string} Sanitized string
 */
function sanitizeString(input, options = {}) {
  if (typeof input !== 'string') {
    return String(input || '');
  }

  const {
    maxLength = 10000,
    allowHtml = false,
    trim = true
  } = options;

  let sanitized = input;

  // Trim whitespace
  if (trim) {
    sanitized = sanitized.trim();
  }

  // Remove HTML tags if not allowed
  if (!allowHtml) {
    // Remove HTML tags and decode HTML entities
    sanitized = sanitized
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&[#\w]+;/g, '') // Remove HTML entities
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, ''); // Remove event handlers
  }

  // Enforce max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitize an object by recursively sanitizing string values
 * @param {object} obj - Object to sanitize
 * @param {object} options - Sanitization options
 * @returns {object} Sanitized object
 */
function sanitizeObject(obj, options = {}) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, options));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, options);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value, options);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitize email address (basic validation and sanitization)
 * @param {string} email - Email to sanitize
 * @returns {string|null} Sanitized email or null if invalid
 */
function sanitizeEmail(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }

  const sanitized = email.trim().toLowerCase();
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized) || sanitized.length > 320) {
    return null;
  }

  return sanitized;
}

/**
 * Sanitize phone number (keep only digits, +, spaces, hyphens, parentheses)
 * @param {string} phone - Phone number to sanitize
 * @returns {string} Sanitized phone number
 */
function sanitizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return '';
  }

  // Keep only valid phone characters: digits, +, spaces, hyphens, parentheses
  return phone.replace(/[^\d+\s\-()]/g, '').trim();
}

/**
 * Sanitize numeric input
 * @param {any} input - Input to sanitize
 * @param {object} options - Options with min, max, allowFloat
 * @returns {number|null} Sanitized number or null if invalid
 */
function sanitizeNumber(input, options = {}) {
  const { min, max, allowFloat = false } = options;
  
  if (input === null || input === undefined || input === '') {
    return null;
  }

  const num = allowFloat ? parseFloat(input) : parseInt(input, 10);
  
  if (isNaN(num)) {
    return null;
  }

  if (min !== undefined && num < min) {
    return null;
  }

  if (max !== undefined && num > max) {
    return null;
  }

  return num;
}

module.exports = {
  sanitizeString,
  sanitizeObject,
  sanitizeEmail,
  sanitizePhone,
  sanitizeNumber
};

