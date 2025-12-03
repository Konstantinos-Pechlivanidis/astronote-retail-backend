// apps/api/src/services/listSegmentation.service.js
// Dynamic list segmentation service for filtering contacts by gender and age
const prisma = require('../lib/prisma');
const { calculateAge } = require('../lib/validation');

/**
 * Get contacts matching list segmentation filters
 * @param {number} listId - List ID
 * @param {number} ownerId - Owner ID (for scoping)
 * @returns {Promise<Array>} Array of contact IDs that match the filters
 */
async function getContactsMatchingFilters(listId, ownerId) {
  // Get list with filters
  const list = await prisma.list.findFirst({
    where: { id: listId, ownerId },
    select: {
      id: true,
      filterGender: true,
      filterAgeMin: true,
      filterAgeMax: true
    }
  });

  if (!list) {
    throw new Error('List not found');
  }

  // Build where clause for contacts
  const where = {
    ownerId,
    isSubscribed: true // Only subscribed contacts
  };

  // Filter by gender if specified
  if (list.filterGender) {
    where.gender = list.filterGender;
  }

  // Filter by age if specified
  if (list.filterAgeMin !== null || list.filterAgeMax !== null) {
    // We need to calculate age from birthday
    // This requires fetching contacts and filtering in memory
    // For better performance with large datasets, consider using database functions
    const allContacts = await prisma.contact.findMany({
      where: {
        ownerId,
        isSubscribed: true,
        ...(list.filterGender ? { gender: list.filterGender } : {}),
        birthday: { not: null } // Only contacts with birthday can be age-filtered
      },
      select: {
        id: true,
        birthday: true
      }
    });

    // Filter by age
    const matchingContacts = allContacts.filter(contact => {
      if (!contact.birthday) {return false;}
      
      const age = calculateAge(contact.birthday);
      if (age === null) {return false;}

      // Must be at least 18 (adults only requirement)
      if (age < 18) {return false;}

      if (list.filterAgeMin !== null && age < list.filterAgeMin) {return false;}
      if (list.filterAgeMax !== null && age > list.filterAgeMax) {return false;}

      return true;
    });

    return matchingContacts.map(c => c.id);
  } else {
    // No age filtering, but still need to filter by 18+ (adults only)
    // Fetch contacts with birthday to verify age
    const allContacts = await prisma.contact.findMany({
      where: {
        ...where,
        birthday: { not: null } // Need birthday to verify age
      },
      select: {
        id: true,
        birthday: true
      }
    });

    // Filter to only include 18+ contacts
    const matchingContacts = allContacts.filter(contact => {
      if (!contact.birthday) {return false;}
      const age = calculateAge(contact.birthday);
      return age !== null && age >= 18;
    });

    return matchingContacts.map(c => c.id);
  }
}

/**
 * Sync list memberships based on segmentation filters
 * Automatically adds/removes contacts based on list filters
 * @param {number} listId - List ID
 * @param {number} ownerId - Owner ID
 * @returns {Promise<{added: number, removed: number}>} Count of contacts added/removed
 */
async function syncListMemberships(listId, ownerId) {
  // Get matching contact IDs
  const matchingContactIds = await getContactsMatchingFilters(listId, ownerId);

  // Get current memberships
  const currentMemberships = await prisma.listMembership.findMany({
    where: { listId },
    select: { contactId: true }
  });

  const currentContactIds = new Set(currentMemberships.map(m => m.contactId));
  const targetContactIds = new Set(matchingContactIds);

  // Find contacts to add
  const toAdd = matchingContactIds.filter(id => !currentContactIds.has(id));
  
  // Find contacts to remove
  const toRemove = Array.from(currentContactIds).filter(id => !targetContactIds.has(id));

  // Perform updates in transaction
  await prisma.$transaction(async (tx) => {
    // Add new memberships
    if (toAdd.length > 0) {
      await tx.listMembership.createMany({
        data: toAdd.map(contactId => ({ listId, contactId })),
        skipDuplicates: true
      });
    }

    // Remove old memberships
    if (toRemove.length > 0) {
      await tx.listMembership.deleteMany({
        where: {
          listId,
          contactId: { in: toRemove }
        }
      });
    }
  });

  return {
    added: toAdd.length,
    removed: toRemove.length,
    total: matchingContactIds.length
  };
}

/**
 * Get list statistics (total contacts matching filters)
 * @param {number} listId - List ID
 * @param {number} ownerId - Owner ID
 * @returns {Promise<number>} Total matching contacts
 */
async function getListMatchCount(listId, ownerId) {
  const matchingContactIds = await getContactsMatchingFilters(listId, ownerId);
  return matchingContactIds.length;
}

module.exports = {
  getContactsMatchingFilters,
  syncListMemberships,
  getListMatchCount
};

