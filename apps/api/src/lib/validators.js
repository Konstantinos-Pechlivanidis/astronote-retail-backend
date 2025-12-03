// apps/api/src/lib/validators.js
// Centralized validation utilities for common patterns

/**
 * Validate and parse numeric ID
 * @param {any} id - ID to validate
 * @param {string} fieldName - Field name for error message
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
function validateId(id, fieldName = 'id') {
  if (id === undefined || id === null) {
    return { valid: false, error: `${fieldName} required` };
  }
  
  const num = Number(id);
  if (!num || isNaN(num) || num <= 0 || !Number.isInteger(num)) {
    return { valid: false, error: `invalid ${fieldName}` };
  }
  
  return { valid: true, value: num };
}

/**
 * Validate and parse date
 * @param {any} date - Date to validate
 * @param {string} fieldName - Field name for error message
 * @param {object} options - Validation options
 * @returns {{ valid: boolean, value?: Date, error?: string }}
 */
function validateDate(date, fieldName = 'date', options = {}) {
  if (!date) {
    if (options.required) {
      return { valid: false, error: `${fieldName} required` };
    }
    return { valid: true, value: null };
  }
  
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) {
    return { valid: false, error: `invalid ${fieldName}` };
  }
  
  // Check if date must be in the past
  if (options.mustBePast && dateObj >= new Date()) {
    return { valid: false, error: `${fieldName} must be in the past` };
  }
  
  // Check if date must be in the future
  if (options.mustBeFuture && dateObj <= new Date()) {
    return { valid: false, error: `${fieldName} must be in the future` };
  }
  
  return { valid: true, value: dateObj };
}

/**
 * Validate pagination parameters
 * @param {any} page - Page number
 * @param {any} pageSize - Page size
 * @param {object} options - Options
 * @returns {{ valid: boolean, page?: number, pageSize?: number, error?: string }}
 */
function validatePagination(page, pageSize, options = {}) {
  const defaultPage = 1;
  const defaultPageSize = options.defaultPageSize || 20;
  const maxPageSize = options.maxPageSize || 100;
  
  const pageNum = page !== undefined ? Number(page) : defaultPage;
  const pageSizeNum = pageSize !== undefined ? Number(pageSize) : defaultPageSize;
  
  if (isNaN(pageNum) || pageNum < 1 || !Number.isInteger(pageNum)) {
    return { valid: false, error: 'invalid page (must be positive integer)' };
  }
  
  if (isNaN(pageSizeNum) || pageSizeNum < 1 || !Number.isInteger(pageSizeNum) || pageSizeNum > maxPageSize) {
    return { valid: false, error: `invalid pageSize (must be 1-${maxPageSize})` };
  }
  
  return { valid: true, page: pageNum, pageSize: pageSizeNum };
}

/**
 * Validate required field
 * @param {any} value - Value to check
 * @param {string} fieldName - Field name for error message
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRequired(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return { valid: false, error: `${fieldName} required` };
  }
  return { valid: true };
}

/**
 * Validate string length
 * @param {string} value - String to validate
 * @param {string} fieldName - Field name
 * @param {object} options - Options (min, max)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateStringLength(value, fieldName, options = {}) {
  if (value === undefined || value === null) {
    if (options.required) {
      return { valid: false, error: `${fieldName} required` };
    }
    return { valid: true };
  }
  
  const str = String(value).trim();
  
  if (options.required && !str) {
    return { valid: false, error: `${fieldName} required` };
  }
  
  if (options.min && str.length < options.min) {
    return { valid: false, error: `${fieldName} must be at least ${options.min} characters` };
  }
  
  if (options.max && str.length > options.max) {
    return { valid: false, error: `${fieldName} must be at most ${options.max} characters` };
  }
  
  return { valid: true };
}

module.exports = {
  validateId,
  validateDate,
  validatePagination,
  validateRequired,
  validateStringLength
};

