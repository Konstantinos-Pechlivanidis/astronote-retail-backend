// apps/api/src/services/audience.service.js
// Service for building campaign audiences based on system-defined segments
const prisma = require('../lib/prisma');
const { calculateAge, matchesAgeGroup, normalizeGender, normalizeAgeGroup } = require('../lib/validation');
const pino = require('pino');

const logger = pino({ name: 'audience-service' });

/**
 * Build audience contacts based on filters
 * @param {number} ownerId - Owner ID (store)
 * @param {string|null} filterGender - Gender filter (null = Any, 'male', 'female', etc.)
 * @param {string|null} filterAgeGroup - Age group filter (null = Any, '18_24', '25_39', '40_plus')
 * @param {string|null} nameSearch - Optional name search (searches firstName and lastName)
 * @returns {Promise<Array>} Array of contacts matching filters
 */
async function buildAudience(ownerId, filterGender = null, filterAgeGroup = null, nameSearch = null) {
  if (!ownerId || typeof ownerId !== 'number' || ownerId <= 0) {
    logger.warn({ ownerId }, 'Invalid ownerId in buildAudience');
    return [];
  }

  // Base where clause - only subscribed contacts, 18+ (adults only)
  const where = {
    ownerId,
    isSubscribed: true
  };

  // Gender filter
  // Handle both null and undefined as "Any" (no filter)
  if (filterGender !== null && filterGender !== undefined) {
    const normalizedGender = normalizeGender(filterGender);
    if (normalizedGender) {
      where.gender = normalizedGender;
    } else {
      // If filterGender is provided but invalid, return empty (strict filtering)
      logger.warn({ ownerId, filterGender }, 'Invalid filterGender in buildAudience');
      return [];
    }
  }
  // If filterGender is null/undefined, include all genders (Any)

  // Name search filter (searches firstName and lastName)
  if (nameSearch && nameSearch.trim()) {
    const searchTerm = nameSearch.trim();
    where.OR = [
      { firstName: { contains: searchTerm, mode: 'insensitive' } },
      { lastName: { contains: searchTerm, mode: 'insensitive' } }
    ];
  }

  // Fetch all matching contacts (we'll filter by age in memory since we need to calculate age)
  let contacts = [];
  try {
    contacts = await prisma.contact.findMany({
      where,
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        gender: true,
        birthday: true
      }
    });
  } catch (err) {
    logger.error({ ownerId, err: err.message }, 'Error fetching contacts in buildAudience');
    return [];
  }

  // Filter by age group if specified
  if (filterAgeGroup) {
    const normalizedAgeGroup = normalizeAgeGroup(filterAgeGroup);
    if (normalizedAgeGroup) {
      return contacts.filter(contact => {
        // Must have birthday to filter by age
        if (!contact.birthday) {return false;}
        return matchesAgeGroup(contact.birthday, normalizedAgeGroup);
      });
    }
    // If filterAgeGroup is provided but invalid, return empty (strict filtering)
    return [];
  }

  // If no age group filter, still filter out contacts under 18 (adults only)
  // BUT: If user explicitly selected "All ages", we should be more lenient
  // For now, we still require birthday and 18+ for compliance
  const filtered = contacts.filter(contact => {
    if (!contact.birthday) {
      // If no birthday, we can't verify age, so exclude for safety (adults only requirement)
      // TODO: Consider making this configurable per business requirements
      return false;
    }
    const age = calculateAge(contact.birthday);
    return age !== null && age >= 18;
  });
  
  return filtered;
}

/**
 * Count audience size based on filters (for preview)
 * @param {number} ownerId - Owner ID (store)
 * @param {string|null} filterGender - Gender filter
 * @param {string|null} filterAgeGroup - Age group filter
 * @param {string|null} nameSearch - Optional name search
 * @returns {Promise<number>} Count of matching contacts
 */
async function countAudience(ownerId, filterGender = null, filterAgeGroup = null, nameSearch = null) {
  const contacts = await buildAudience(ownerId, filterGender, filterAgeGroup, nameSearch);
  return contacts.length;
}

module.exports = {
  buildAudience,
  countAudience
};

