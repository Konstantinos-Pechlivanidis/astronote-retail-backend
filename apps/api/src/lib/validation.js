// apps/api/src/lib/validation.js
// Validation utilities for contact fields

/**
 * Validate gender value
 * @param {string} gender - Gender value
 * @returns {boolean} True if valid
 */
function isValidGender(gender) {
  if (!gender) {
    return false;
  }
  const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
  return validGenders.includes(String(gender).toLowerCase());
}

/**
 * Normalize gender value
 * @param {string} gender - Gender value
 * @returns {string|null} Normalized gender or null
 */
function normalizeGender(gender) {
  if (!gender) {
    return null;
  }
  const normalized = String(gender).toLowerCase().trim();
  if (isValidGender(normalized)) {
    return normalized;
  }
  return null;
}

/**
 * Validate birthday (must be in the past and reasonable age)
 * @param {string|Date} birthday - Birthday date
 * @returns {boolean} True if valid
 */
function isValidBirthday(birthday) {
  if (!birthday) {
    return false;
  }
  
  try {
    const date = birthday instanceof Date ? birthday : new Date(birthday);
    
    // Check if valid date
    if (isNaN(date.getTime())) {
      return false;
    }
    
    // Must be in the past
    if (date >= new Date()) {
      return false;
    }
    
    // Must be reasonable (not more than 150 years ago, not in the future)
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 150);
    if (date < minDate) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculate age from birthday
 * @param {Date|string} birthday - Birthday date
 * @returns {number|null} Age in years or null if invalid
 */
function calculateAge(birthday) {
  if (!birthday) {
    return null;
  }
  
  try {
    const birthDate = birthday instanceof Date ? birthday : new Date(birthday);
    if (isNaN(birthDate.getTime())) {
      return null;
    }
    
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age >= 0 ? age : null;
  } catch {
    return null;
  }
}

/**
 * Validate email format
 * @param {string} email - Email address
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const trimmed = email.trim();
  if (!trimmed) {
    return false;
  }
  
  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed) && trimmed.length <= 320;
}

/**
 * Age group constants
 */
const AGE_GROUPS = {
  '18_24': { min: 18, max: 24 },
  '25_39': { min: 25, max: 39 },
  '40_plus': { min: 40, max: null } // 40+ means no upper limit
};

/**
 * Validate age group value
 * @param {string} ageGroup - Age group value
 * @returns {boolean} True if valid
 */
function isValidAgeGroup(ageGroup) {
  if (!ageGroup) {
    return false;
  }
  return Object.keys(AGE_GROUPS).includes(ageGroup);
}

/**
 * Normalize age group value
 * @param {string} ageGroup - Age group value
 * @returns {string|null} Normalized age group or null
 */
function normalizeAgeGroup(ageGroup) {
  if (!ageGroup) {
    return null;
  }
  const normalized = String(ageGroup).toLowerCase().trim();
  // Accept both '40_plus' and '40+' formats
  if (normalized === '40+' || normalized === '40_plus') {
    return '40_plus';
  }
  if (isValidAgeGroup(normalized)) {
    return normalized;
  }
  return null;
}

/**
 * Check if a contact's age matches the specified age group
 * @param {Date|string} birthday - Contact's birthday
 * @param {string} ageGroup - Age group to check (18_24, 25_39, 40_plus)
 * @returns {boolean} True if contact matches age group
 */
function matchesAgeGroup(birthday, ageGroup) {
  if (!birthday || !ageGroup) {
    return false;
  }
  
  const age = calculateAge(birthday);
  if (age === null) {
    return false;
  }
  
  const group = AGE_GROUPS[ageGroup];
  if (!group) {
    return false;
  }
  
  // Must be at least 18 (adults only)
  if (age < 18) {
    return false;
  }
  
  // Check lower bound
  if (age < group.min) {
    return false;
  }
  
  // Check upper bound (if exists)
  if (group.max !== null && age > group.max) {
    return false;
  }
  
  return true;
}

module.exports = {
  isValidGender,
  normalizeGender,
  isValidBirthday,
  calculateAge,
  isValidEmail,
  isValidAgeGroup,
  normalizeAgeGroup,
  matchesAgeGroup,
  AGE_GROUPS
};

