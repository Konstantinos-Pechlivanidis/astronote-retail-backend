// apps/api/src/services/contactImport.service.js
// Service for processing contact imports from Excel files

const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { normalizePhoneToE164 } = require('../lib/phone');
const { normalizeGender, isValidBirthday, isValidEmail } = require('../lib/validation');
const { sanitizeString, sanitizeEmail } = require('../lib/sanitize');
const crypto = require('node:crypto');
const pino = require('pino');

const logger = pino({ name: 'contact-import-service' });

/**
 * Create a random raw token and return its SHA-256 hex hash (for storage).
 */
function newUnsubTokenHash() {
  const raw = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/**
 * Parse Excel file and extract rows
 * @param {Buffer} fileBuffer - Excel file buffer
 * @returns {Array<Object>} Array of row objects with column names as keys
 */
function parseExcelFile(fileBuffer) {
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convert to JSON with header row
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      raw: false, // Convert all values to strings
      defval: '', // Default value for empty cells
    });
    
    return rows;
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Failed to parse Excel file');
    throw new Error('Invalid Excel file format');
  }
}

/**
 * Normalize column name (case-insensitive, trim whitespace)
 * @param {string} colName - Column name from Excel
 * @returns {string} Normalized column name
 */
function normalizeColumnName(colName) {
  if (!colName || typeof colName !== 'string') {return '';}
  return colName.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Map Excel row to contact data structure
 * @param {Object} row - Raw row from Excel
 * @returns {Object} Normalized contact data
 */
function mapRowToContact(row) {
  // Create a map of normalized column names to values
  const columnMap = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeColumnName(key);
    columnMap[normalized] = value;
  }
  
  // Extract values (case-insensitive column matching)
  const firstName = columnMap['firstname'] || columnMap['first_name'] || '';
  const lastName = columnMap['lastname'] || columnMap['last_name'] || '';
  const phone = columnMap['phone'] || '';
  const email = columnMap['email'] || '';
  const gender = columnMap['gender'] || '';
  const birthday = columnMap['birthday'] || columnMap['birthdate'] || columnMap['dateofbirth'] || '';
  const subscribed = columnMap['subscribed'] || columnMap['issubscribed'] || '';
  
  return {
    firstName: firstName ? String(firstName).trim() : null,
    lastName: lastName ? String(lastName).trim() : null,
    phone: phone ? String(phone).trim() : '',
    email: email ? String(email).trim() : null,
    gender: gender ? String(gender).trim() : null,
    birthday: birthday ? String(birthday).trim() : null,
    subscribed: subscribed ? String(subscribed).trim() : null,
  };
}

/**
 * Normalize subscribed value
 * @param {string} value - Subscribed value from Excel
 * @returns {boolean} True if subscribed
 */
function normalizeSubscribed(value) {
  if (!value) {return true;} // Default to subscribed
  
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'true' || normalized === '1' || normalized === 'y') {
    return true;
  }
  if (normalized === 'no' || normalized === 'false' || normalized === '0' || normalized === 'n') {
    return false;
  }
  
  // Default to subscribed if unclear
  return true;
}

/**
 * Validate and normalize a contact row
 * @param {Object} row - Raw row from Excel
 * @param {number} rowIndex - Row index (1-based, for error reporting)
 * @returns {Object} { valid: boolean, data: Object, errors: Array<string> }
 */
function validateContactRow(row, rowIndex) {
  const errors = [];
  const mapped = mapRowToContact(row);
  
  // Required: phone
  if (!mapped.phone) {
    errors.push('Phone number is required');
  } else {
    // Validate and normalize phone
    const normalizedPhone = normalizePhoneToE164(mapped.phone);
    if (!normalizedPhone) {
      errors.push(`Invalid phone number format (must be valid international format, e.g., +306984303406)`);
    } else {
      mapped.phone = normalizedPhone;
    }
  }
  
  // Optional: email validation
  if (mapped.email) {
    const sanitizedEmail = sanitizeEmail(mapped.email);
    if (!sanitizedEmail || !isValidEmail(sanitizedEmail)) {
      errors.push('Invalid email format');
    } else {
      mapped.email = sanitizedEmail;
    }
  }
  
  // Optional: gender validation
  if (mapped.gender) {
    const normalizedGender = normalizeGender(mapped.gender);
    if (!normalizedGender) {
      errors.push(`Invalid gender (must be: male, female, other, prefer_not_to_say)`);
    } else {
      mapped.gender = normalizedGender;
    }
  }
  
  // Optional: birthday validation
  if (mapped.birthday) {
    // Try to parse date (accept YYYY-MM-DD format)
    let birthdayDate = null;
    try {
      // Try parsing as YYYY-MM-DD
      const dateMatch = mapped.birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateMatch) {
        birthdayDate = new Date(dateMatch[1], dateMatch[2] - 1, dateMatch[3]);
      } else {
        // Try parsing as general date
        birthdayDate = new Date(mapped.birthday);
      }
      
      if (!isValidBirthday(birthdayDate)) {
        errors.push('Invalid birthday (must be a valid date in the past, format: YYYY-MM-DD)');
      } else {
        // Store as ISO date string (YYYY-MM-DD)
        mapped.birthday = birthdayDate.toISOString().split('T')[0];
      }
    } catch (e) {
      errors.push('Invalid birthday format (must be YYYY-MM-DD)');
    }
  }
  
  // Normalize subscribed
  mapped.isSubscribed = normalizeSubscribed(mapped.subscribed);
  
  // Sanitize string fields
  if (mapped.firstName) {
    mapped.firstName = sanitizeString(mapped.firstName, { maxLength: 120 });
  }
  if (mapped.lastName) {
    mapped.lastName = sanitizeString(mapped.lastName, { maxLength: 120 });
  }
  
  return {
    valid: errors.length === 0,
    data: mapped,
    errors,
    rowIndex: rowIndex + 1, // 1-based for user display
  };
}

/**
 * Process import job - validate and create contacts
 * @param {Object} jobData - Job data { userId, fileBuffer, options }
 * @param {Function} progressCallback - Callback to report progress (processed, total)
 * @returns {Object} Import results
 */
async function processImportJob(jobData, progressCallback) {
  const { userId, fileBuffer, options = {} } = jobData;
  const skipDuplicates = options.skipDuplicates !== false; // Default to true
  
  const results = {
    created: 0,
    skipped: 0,
    errors: [],
  };
  
  try {
    // Parse Excel file
    const rows = parseExcelFile(fileBuffer);
    const total = rows.length;
    
    logger.info({ userId, total }, 'Starting contact import');
    
    if (total === 0) {
      throw new Error('Excel file is empty or has no data rows');
    }
    
    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      // Validate row
      const validation = validateContactRow(row, i);
      
      if (!validation.valid) {
        // Add validation errors
        validation.errors.forEach(error => {
          results.errors.push({
            row: validation.rowIndex,
            field: 'validation',
            message: error,
          });
        });
        results.skipped++;
        progressCallback(i + 1, total);
        continue;
      }
      
      const contactData = validation.data;
      
      // Check for duplicate (by phone)
      if (skipDuplicates) {
        const existing = await prisma.contact.findUnique({
          where: {
            ownerId_phone: {
              ownerId: userId,
              phone: contactData.phone,
            },
          },
        });
        
        if (existing) {
          results.skipped++;
          results.errors.push({
            row: validation.rowIndex,
            field: 'phone',
            message: `Contact with phone ${contactData.phone} already exists (skipped)`,
          });
          progressCallback(i + 1, total);
          continue;
        }
      }
      
      // Create contact
      try {
        const { hash } = newUnsubTokenHash();
        
        await prisma.contact.create({
          data: {
            ownerId: userId,
            phone: contactData.phone,
            email: contactData.email,
            firstName: contactData.firstName,
            lastName: contactData.lastName,
            gender: contactData.gender,
            birthday: contactData.birthday ? new Date(contactData.birthday) : null,
            isSubscribed: contactData.isSubscribed,
            unsubscribeTokenHash: hash,
          },
        });
        
        results.created++;
      } catch (dbError) {
        // Database error (e.g., constraint violation)
        logger.error({ 
          row: validation.rowIndex, 
          error: dbError.message,
          phone: contactData.phone 
        }, 'Failed to create contact');
        
        results.errors.push({
          row: validation.rowIndex,
          field: 'database',
          message: `Failed to create contact: ${dbError.message}`,
        });
        results.skipped++;
      }
      
      // Report progress
      progressCallback(i + 1, total);
    }
    
    logger.info({ 
      userId, 
      created: results.created, 
      skipped: results.skipped, 
      errors: results.errors.length 
    }, 'Contact import completed');
    
    return results;
  } catch (error) {
    logger.error({ userId, error: error.message, stack: error.stack }, 'Import job failed');
    throw error;
  }
}

/**
 * Generate sample Excel template file
 * @returns {Buffer} Excel file buffer
 */
function generateTemplateFile() {
  const sampleData = [
    {
      firstName: 'John',
      lastName: 'Doe',
      phone: '+306984303406',
      email: 'john.doe@example.com',
      gender: 'male',
      birthday: '1990-01-15',
      subscribed: 'Yes',
    },
    {
      firstName: 'Jane',
      lastName: 'Smith',
      phone: '+306984303407',
      email: 'jane.smith@example.com',
      gender: 'female',
      birthday: '1985-05-20',
      subscribed: 'Yes',
    },
    {
      firstName: 'Alex',
      lastName: 'Johnson',
      phone: '+306984303408',
      email: 'alex@example.com',
      gender: 'other',
      birthday: '1995-12-10',
      subscribed: 'No',
    },
  ];
  
  // Create workbook
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Contacts');
  
  // Generate buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  
  return buffer;
}

module.exports = {
  parseExcelFile,
  validateContactRow,
  processImportJob,
  generateTemplateFile,
};

