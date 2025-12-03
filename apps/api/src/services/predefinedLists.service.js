// apps/api/src/services/predefinedLists.service.js
// Service for generating virtual predefined lists based on gender and age groups
// These lists are not stored in the database but computed on-the-fly

const { buildAudience } = require('./audience.service');
// const { mapAgeGroupToApi } = require('../lib/routeHelpers'); // Unused - kept for potential future use

/**
 * Get predefined system lists for a user
 * These are virtual lists based on gender and age group filters
 * @param {number} ownerId - Owner ID
 * @returns {Promise<Array>} Array of predefined list objects
 */
async function getPredefinedLists(ownerId) {
  try {
    const lists = [];

    // All contacts (no filters) - always first
    try {
      const allContacts = await buildAudience(ownerId, null, null, null);
      lists.push({
        id: 'all', // Virtual ID (string)
        name: 'All Contacts',
        description: 'All subscribed contacts (18+)',
        isSystem: true,
        filterGender: null,
        filterAgeGroup: null,
        memberCount: allContacts.length
      });
    } catch (error) {
      // If "All Contacts" fails, still add it with 0 count
      lists.push({
        id: 'all',
        name: 'All Contacts',
        description: 'All subscribed contacts (18+)',
        isSystem: true,
        filterGender: null,
        filterAgeGroup: null,
        memberCount: 0
      });
    }

    // Gender-based lists
    const genders = ['male', 'female', 'other', 'prefer_not_to_say'];
    const genderPromises = genders.map(async (gender) => {
      try {
        const contacts = await buildAudience(ownerId, gender, null, null);
        return {
          id: `gender_${gender}`, // Virtual ID (string)
          name: `All ${gender.charAt(0).toUpperCase() + gender.slice(1)} Contacts`,
          description: `All subscribed ${gender} contacts (18+)`,
          isSystem: true,
          filterGender: gender,
          filterAgeGroup: null,
          memberCount: contacts.length
        };
      } catch (error) {
        // If this gender list fails, return it with 0 count
        return {
          id: `gender_${gender}`,
          name: `All ${gender.charAt(0).toUpperCase() + gender.slice(1)} Contacts`,
          description: `All subscribed ${gender} contacts (18+)`,
          isSystem: true,
          filterGender: gender,
          filterAgeGroup: null,
          memberCount: 0
        };
      }
    });
    const genderLists = await Promise.all(genderPromises);
    lists.push(...genderLists);

    // Age group-based lists
    const ageGroups = [
      { key: '18_24', name: '18-24', min: 18, max: 24 },
      { key: '25_39', name: '25-39', min: 25, max: 39 },
      { key: '40_plus', name: '40+', min: 40, max: null }
    ];

    const agePromises = ageGroups.map(async (ageGroup) => {
      try {
        const contacts = await buildAudience(ownerId, null, ageGroup.key, null);
        return {
          id: `age_${ageGroup.key}`, // Virtual ID (string)
          name: `Age ${ageGroup.name}`,
          description: `All subscribed contacts aged ${ageGroup.name} (18+)`,
          isSystem: true,
          filterGender: null,
          filterAgeGroup: ageGroup.key,
          memberCount: contacts.length
        };
      } catch (error) {
        // If this age group list fails, return it with 0 count
        return {
          id: `age_${ageGroup.key}`,
          name: `Age ${ageGroup.name}`,
          description: `All subscribed contacts aged ${ageGroup.name} (18+)`,
          isSystem: true,
          filterGender: null,
          filterAgeGroup: ageGroup.key,
          memberCount: 0
        };
      }
    });
    const ageLists = await Promise.all(agePromises);
    lists.push(...ageLists);

  // Combined gender + age group lists (optional - can be commented out if too many)
  // Uncomment if you want all combinations
  /*
  const combinedPromises = [];
  for (const gender of genders) {
    for (const ageGroup of ageGroups) {
      combinedPromises.push(
        buildAudience(ownerId, gender, ageGroup.key, null).then(contacts => ({
          id: `gender_${gender}_age_${ageGroup.key}`, // Virtual ID (string)
          name: `${gender.charAt(0).toUpperCase() + gender.slice(1)} ${ageGroup.name}`,
          description: `All subscribed ${gender} contacts aged ${ageGroup.name}`,
          isSystem: true,
          filterGender: gender,
          filterAgeGroup: ageGroup.key,
          memberCount: contacts.length
        }))
      );
    }
  }
  const combinedLists = await Promise.all(combinedPromises);
  lists.push(...combinedLists);
  */

    return lists;
  } catch (error) {
    // Return at least "All Contacts" even if there's an error
    return [{
      id: 'all',
      name: 'All Contacts',
      description: 'All subscribed contacts (18+)',
      isSystem: true,
      filterGender: null,
      filterAgeGroup: null,
      memberCount: 0
    }];
  }
}

/**
 * Get contacts for a predefined list
 * @param {string} listId - Virtual list ID (e.g., 'gender_male', 'age_18_24')
 * @param {number} ownerId - Owner ID
 * @param {number} page - Page number
 * @param {number} pageSize - Page size
 * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
 */
async function getPredefinedListContacts(listId, ownerId, page = 1, pageSize = 20) {
  // Parse virtual list ID
  let filterGender = null;
  let filterAgeGroup = null;

  if (listId === 'all') {
    // No filters
  } else if (listId.startsWith('gender_')) {
    const gender = listId.replace('gender_', '');
    if (gender.includes('_age_')) {
      // Combined: gender_male_age_18_24
      const parts = gender.split('_age_');
      filterGender = parts[0];
      filterAgeGroup = parts[1];
    } else {
      // Gender only: gender_male
      filterGender = gender;
    }
  } else if (listId.startsWith('age_')) {
    // Age only: age_18_24
    filterAgeGroup = listId.replace('age_', '');
  }

  // Get all matching contacts
  const allContacts = await buildAudience(ownerId, filterGender, filterAgeGroup, null);
  const total = allContacts.length;

  // Paginate
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const items = allContacts.slice(start, end);

  return {
    items,
    total,
    page,
    pageSize
  };
}

module.exports = {
  getPredefinedLists,
  getPredefinedListContacts
};

