// apps/api/src/lib/prismaErrors.js
/**
 * Prisma error code reference:
 * P2002 - Unique constraint violation
 * P2003 - Foreign key constraint violation
 * P2025 - Record not found (update/delete)
 */

/**
 * Handle Prisma errors and return appropriate HTTP status and message
 * @param {Error} error - Prisma error
 * @returns {{ status: number, message: string } | null} - Returns null if not a Prisma error
 */
function handlePrismaError(error) {
  if (!error || !error.code) {
    return null;
  }

  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation
      // Try to extract field name from meta for better error message
      const field = error.meta?.target?.[0] || 'resource';
      return { 
        status: 409, 
        message: `A ${field} with this value already exists. Please choose a different value.`, 
        code: 'DUPLICATE_RESOURCE' 
      };
    }
    
    case 'P2003':
      // Foreign key constraint violation
      return { 
        status: 404, 
        message: 'A referenced resource was not found. Please check your input and try again.', 
        code: 'REFERENCE_NOT_FOUND' 
      };
    
    case 'P2025':
      // Record not found (update/delete)
      return { 
        status: 404, 
        message: 'The requested resource was not found.', 
        code: 'RESOURCE_NOT_FOUND' 
      };
    
    default:
      return null;
  }
}

/**
 * Check if error is a Prisma error
 */
function isPrismaError(error) {
  return error && error.code && error.code.startsWith('P');
}

module.exports = {
  handlePrismaError,
  isPrismaError
};

