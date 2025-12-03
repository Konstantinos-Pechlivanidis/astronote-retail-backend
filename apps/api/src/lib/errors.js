// apps/api/src/lib/errors.js
// Centralized error handling utilities

const { handlePrismaError, isPrismaError } = require('./prismaErrors');
const pino = require('pino');

const logger = pino({ name: 'error-handler' });

/**
 * Standard error response handler
 * Handles Prisma errors, validation errors, and generic errors
 */
function handleError(error, req, res, defaultMessage = 'Internal Server Error') {
  // Don't send response if headers already sent (e.g., middleware already responded)
  if (res.headersSent) {
    logger.warn({ path: req.path, method: req.method }, 'Response already sent, skipping error handler');
    return;
  }

  // Log error for debugging with full details
  const errorDetails = {
    message: error?.message || 'Unknown error',
    stack: error?.stack,
    code: error?.code,
    status: error?.status,
    name: error?.name,
    path: req.path,
    method: req.method
  };
  
  if (req.log) {
    req.log.error({ err: error, details: errorDetails }, 'Request error');
  } else {
    logger.error(errorDetails, 'Request error');
  }

  // Handle Prisma errors
  if (isPrismaError(error)) {
    const prismaResponse = handlePrismaError(error);
    if (prismaResponse) {
      return res.status(prismaResponse.status).json({ 
        message: prismaResponse.message,
        code: prismaResponse.code || 'DATABASE_ERROR'
      });
    }
  }

  // Handle known error types with status codes
  if (error.status) {
    const response = { message: error.message || defaultMessage };
    // Add error code if provided
    if (error.code) {
      response.code = error.code;
    }
    return res.status(error.status).json(response);
  }

  // Get error message (handle cases where error might not have a message)
  const errorMessage = error?.message || error?.toString() || defaultMessage;

  // Handle authentication errors
  if (errorMessage.includes('Missing token') ||
      errorMessage.includes('Invalid token') ||
      errorMessage.includes('Unauthorized') ||
      errorMessage.includes('jwt expired') ||
      errorMessage.includes('jwt malformed') ||
      errorMessage.includes('jwt signature')) {
    return res.status(401).json({ 
      message: 'Your session has expired. Please log in again.',
      code: 'UNAUTHORIZED'
    });
  }

  // Handle validation errors (common patterns)
  if (errorMessage.includes('required') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('must be')) {
    // Make validation messages more user-friendly
    let userMessage = errorMessage;
    if (errorMessage.includes('required')) {
      userMessage = errorMessage.replace(/required/gi, 'is required');
    }
    return res.status(400).json({ 
      message: userMessage,
      code: 'VALIDATION_ERROR'
    });
  }

  // Handle conflict errors (duplicate resources)
  if (errorMessage.includes('already in use') ||
      errorMessage.includes('already exists')) {
    return res.status(409).json({ 
      message: errorMessage.includes('already exists') 
        ? errorMessage 
        : 'This resource is already in use. Please choose a different value.',
      code: 'DUPLICATE_RESOURCE'
    });
  }

  // Default to 500 - but include the actual error message if available
  // In production, don't expose internal error details
  const isProduction = process.env.NODE_ENV === 'production';
  const finalMessage = isProduction && errorMessage !== defaultMessage 
    ? defaultMessage 
    : (errorMessage !== defaultMessage ? errorMessage : defaultMessage);
  
  // Provide user-friendly message for internal errors
  const userMessage = isProduction 
    ? 'An unexpected error occurred. Please try again later or contact support if the problem persists.'
    : finalMessage;
  
  return res.status(500).json({ 
    message: userMessage,
    code: 'INTERNAL_ERROR'
  });
}

/**
 * Create a standardized error object
 */
function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Validation error factory
 */
function validationError(message) {
  return createError(message, 400);
}

/**
 * Not found error factory
 */
function notFoundError(resource = 'Resource') {
  return createError(`${resource} not found`, 404);
}

/**
 * Unauthorized error factory
 */
function unauthorizedError(message = 'Unauthorized') {
  return createError(message, 401);
}

/**
 * Forbidden error factory
 */
function forbiddenError(message = 'Forbidden') {
  return createError(message, 403);
}

module.exports = {
  handleError,
  createError,
  validationError,
  notFoundError,
  unauthorizedError,
  forbiddenError
};

