// apps/api/src/lib/routeHelpers.js
// Common route helper functions for consistent patterns

const { validateId, validatePagination } = require('./validators');
const { handleError } = require('./errors');

/**
 * Validate route parameter ID
 * Returns early with 400 if invalid
 * @param {any} id - ID from req.params
 * @param {string} fieldName - Field name for error message
 * @param {object} res - Express response object
 * @returns {number|null} - Validated ID or null if invalid (response already sent)
 */
function validateRouteId(id, fieldName = 'id', res) {
  const result = validateId(id, fieldName);
  if (!result.valid) {
    res.status(400).json({ message: result.error });
    return null;
  }
  return result.value;
}

/**
 * Validate pagination query parameters
 * Returns early with 400 if invalid
 * @param {object} query - Express req.query
 * @param {object} res - Express response object
 * @param {object} options - Options for validatePagination
 * @returns {{ page: number, pageSize: number }|null} - Validated pagination or null if invalid
 */
function validateRoutePagination(query, res, options = {}) {
  const result = validatePagination(query.page, query.pageSize, options);
  if (!result.valid) {
    res.status(400).json({ message: result.error });
    return null;
  }
  return { page: result.page, pageSize: result.pageSize };
}

/**
 * Async route handler wrapper with standardized error handling
 * Usage: router.get('/path', requireAuth, asyncHandler(async (req, res) => { ... }))
 * @param {Function} fn - Async route handler function
 * @returns {Function} - Express route handler
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      handleError(err, req, res);
    });
  };
}

/**
 * Map Prisma AgeGroup enum to API format
 * @param {string|null} ageGroup - Prisma enum value (age_18_24, age_25_39, age_40_plus)
 * @returns {string|null} - API format (18_24, 25_39, 40_plus)
 */
function mapAgeGroupToApi(ageGroup) {
  if (!ageGroup) {
    return null;
  }
  const map = {
    'age_18_24': '18_24',
    'age_25_39': '25_39',
    'age_40_plus': '40_plus'
  };
  return map[ageGroup] || ageGroup;
}

/**
 * Map API AgeGroup format to Prisma enum
 * @param {string|null} ageGroup - API format (18_24, 25_39, 40_plus)
 * @returns {string|null} - Prisma enum value (age_18_24, age_25_39, age_40_plus)
 */
function mapAgeGroupToPrisma(ageGroup) {
  if (!ageGroup) {
    return null;
  }
  const map = {
    '18_24': 'age_18_24',
    '25_39': 'age_25_39',
    '40_plus': 'age_40_plus'
  };
  return map[ageGroup] || null;
}

module.exports = {
  validateRouteId,
  validateRoutePagination,
  asyncHandler,
  mapAgeGroupToApi,
  mapAgeGroupToPrisma
};

