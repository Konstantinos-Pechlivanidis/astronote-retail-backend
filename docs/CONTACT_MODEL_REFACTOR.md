# Contact Model Refactor - Complete Summary

## Overview

This document summarizes the comprehensive refactor of the Contact model to remove metadata dependency, add new fields (gender, birthday), implement E.164 phone validation, and add dynamic list segmentation by gender and age.

## Changes Made

### 1. Prisma Schema Updates ✅

**Contact Model**:
- ❌ **Removed**: `metadata Json?` field
- ✅ **Added**: `gender Gender?` field (enum: male, female, other, prefer_not_to_say)
- ✅ **Added**: `birthday DateTime?` field
- ✅ **Updated**: Phone field comment to indicate E.164 format
- ✅ **Added**: Indexes for `gender`, `birthday`, and composite `[ownerId, gender]`

**List Model**:
- ✅ **Added**: `filterGender Gender?` - Filter by gender (null = all genders)
- ✅ **Added**: `filterAgeMin Int?` - Minimum age filter (null = no minimum)
- ✅ **Added**: `filterAgeMax Int?` - Maximum age filter (null = no maximum)
- ✅ **Added**: Composite index `[ownerId, filterGender]` for gender filtering

**New Enum**:
- ✅ **Created**: `Gender` enum with values: `male`, `female`, `other`, `prefer_not_to_say`

### 2. Phone Validation ✅

**Library Added**: `libphonenumber-js` for proper E.164 format validation

**New File**: `apps/api/src/lib/phone.js`
- `normalizePhoneToE164(phone, defaultCountry)` - Normalizes to E.164 format
- `isValidPhone(phone, defaultCountry)` - Validates phone number
- `formatPhoneForDisplay(phone)` - Formats for display

**Features**:
- Automatic country code detection (default: 'GR')
- E.164 format enforcement (e.g., +306984303406)
- Proper validation with international standards

### 3. Contact Validation ✅

**New File**: `apps/api/src/lib/validation.js`
- `isValidGender(gender)` - Validates gender enum value
- `normalizeGender(gender)` - Normalizes gender to enum
- `isValidBirthday(birthday)` - Validates birthday (must be in past, reasonable age)
- `calculateAge(birthday)` - Calculates age from birthday
- `isValidEmail(email)` - Email format validation

### 4. Contact Routes Updated ✅

**File**: `apps/api/src/routes/contacts.js`

**POST /contacts**:
- ✅ Validates phone using E.164 format
- ✅ Validates email format
- ✅ Validates gender (if provided)
- ✅ Validates birthday (if provided)
- ✅ Stores phone in E.164 format
- ✅ Removed metadata field

**PUT /contacts/:id**:
- ✅ All same validations as POST
- ✅ Supports updating gender and birthday
- ✅ Proper null handling for optional fields

### 5. NFC Service Updated ✅

**File**: `apps/api/src/services/nfc.service.js`

**Changes**:
- ❌ **Removed**: All metadata usage
- ✅ **Updated**: Uses new phone validation (E.164 format)
- ✅ **Added**: Gender and birthday support
- ✅ **Updated**: Contact creation/update without metadata

### 6. Dynamic List Segmentation ✅

**New File**: `apps/api/src/services/listSegmentation.service.js`

**Functions**:
- `getContactsMatchingFilters(listId, ownerId)` - Get contact IDs matching filters
- `syncListMemberships(listId, ownerId)` - Auto-sync list memberships based on filters
- `getListMatchCount(listId, ownerId)` - Get count of matching contacts

**Features**:
- Gender-based filtering
- Age-based filtering (calculated from birthday)
- Automatic membership sync when filters change
- Efficient filtering with proper indexes

### 7. List Routes Updated ✅

**File**: `apps/api/src/routes/lists.js`

**POST /lists**:
- ✅ Accepts `filterGender`, `filterAgeMin`, `filterAgeMax`
- ✅ Validates all filter parameters
- ✅ Auto-syncs memberships if filters are set

**PUT /lists/:listId**:
- ✅ Updates segmentation filters
- ✅ Auto-syncs memberships when filters change
- ✅ Validates all filter parameters

**GET /lists/:listId**:
- ✅ Returns `matchCount` if filters are set

**POST /lists/:listId/sync** (NEW):
- ✅ Manually sync list memberships based on filters
- ✅ Returns added/removed counts

## API Changes

### Contact Creation/Update

**Request Body** (POST /contacts, PUT /contacts/:id):
```json
{
  "phone": "+306984303406",           // Required, E.164 format
  "email": "user@example.com",        // Optional
  "firstName": "John",                // Optional
  "lastName": "Doe",                  // Optional
  "gender": "male",                   // Optional: "male" | "female" | "other" | "prefer_not_to_say"
  "birthday": "1990-01-15"            // Optional: ISO date string
}
```

**Response**: Contact object with all fields (no metadata)

### List Creation/Update

**Request Body** (POST /lists, PUT /lists/:listId):
```json
{
  "name": "Women 25-34",
  "description": "Women aged 25-34",
  "filterGender": "female",           // Optional: "male" | "female" | "other" | "prefer_not_to_say" | null
  "filterAgeMin": 25,                 // Optional: minimum age (0-150) | null
  "filterAgeMax": 34                   // Optional: maximum age (0-150) | null
}
```

**Response**: List object with filters and `matchCount` (if filters set)

### List Sync

**POST /lists/:listId/sync**:
- Manually syncs list memberships based on current filters
- Returns: `{ ok: true, added: 5, removed: 2, total: 50 }`

## Validation Rules

### Phone Number
- ✅ Must be valid international format
- ✅ Automatically normalized to E.164 format (e.g., +306984303406)
- ✅ Country code detection (default: GR)
- ✅ Error: "invalid phone number format (must be valid international format)"

### Gender
- ✅ Must be one of: `male`, `female`, `other`, `prefer_not_to_say`
- ✅ Case-insensitive
- ✅ Can be null/omitted
- ✅ Error: "invalid gender (must be: male, female, other, prefer_not_to_say)"

### Birthday
- ✅ Must be a valid date
- ✅ Must be in the past
- ✅ Must be reasonable (not more than 150 years ago)
- ✅ Used for age calculation (for segmentation)
- ✅ Error: "invalid birthday (must be a valid date in the past)"

### Age Filters
- ✅ `filterAgeMin`: 0-150, or null
- ✅ `filterAgeMax`: 0-150, or null
- ✅ `filterAgeMin` cannot be greater than `filterAgeMax`
- ✅ Age calculated from `birthday` field

## Segmentation Logic

### How It Works

1. **List Creation/Update**: When filters are set, memberships are automatically synced
2. **Manual Sync**: Use `POST /lists/:listId/sync` to manually sync
3. **Filtering**:
   - **Gender**: Direct database filter (efficient with index)
   - **Age**: Calculated from `birthday` field (requires in-memory filtering for now)
4. **Membership Management**: Contacts are automatically added/removed based on filters

### Example Use Cases

**Women 25-34**:
```json
{
  "name": "Women 25-34",
  "filterGender": "female",
  "filterAgeMin": 25,
  "filterAgeMax": 34
}
```

**Men 18+**:
```json
{
  "name": "Men 18+",
  "filterGender": "male",
  "filterAgeMin": 18,
  "filterAgeMax": null
}
```

**All Ages 25-34**:
```json
{
  "name": "Ages 25-34",
  "filterGender": null,
  "filterAgeMin": 25,
  "filterAgeMax": 34
}
```

## Migration

**File**: `prisma/migrations/20241230000000_remove_metadata_add_segmentation/migration.sql`

**Changes**:
1. Drops `metadata` column from `Contact` (if exists)
2. Creates `Gender` enum (if not exists)
3. Adds `gender` and `birthday` columns to `Contact` (if not exists)
4. Adds indexes for performance
5. Adds segmentation filter columns to `List` (if not exists)
6. Adds index for gender filtering

**To Apply**:
```bash
npx prisma migrate dev
```

## Files Modified

### Schema
- ✅ `prisma/schema.prisma` - Updated Contact and List models

### New Files
- ✅ `apps/api/src/lib/phone.js` - Phone validation utilities
- ✅ `apps/api/src/lib/validation.js` - Validation utilities
- ✅ `apps/api/src/services/listSegmentation.service.js` - Segmentation logic

### Updated Files
- ✅ `apps/api/src/routes/contacts.js` - Updated with new fields and validation
- ✅ `apps/api/src/routes/lists.js` - Added segmentation support
- ✅ `apps/api/src/services/nfc.service.js` - Removed metadata, added new fields

### Dependencies
- ✅ `libphonenumber-js` - Added to `apps/api/package.json`

## Testing Recommendations

### Contact Creation
1. ✅ Test with valid E.164 phone number
2. ✅ Test with invalid phone number
3. ✅ Test with gender values
4. ✅ Test with valid/invalid birthday
5. ✅ Test with all fields combined

### List Segmentation
1. ✅ Create list with gender filter
2. ✅ Create list with age filter
3. ✅ Create list with both filters
4. ✅ Update list filters and verify sync
5. ✅ Manually sync list memberships
6. ✅ Verify contacts match filters correctly

## Summary

### Issues Fixed
- ✅ Removed metadata dependency (column doesn't exist in DB)
- ✅ Added gender and birthday fields
- ✅ Implemented E.164 phone validation
- ✅ Added dynamic list segmentation
- ✅ Proper validation for all new fields

### Production Readiness
- ✅ All validations in place
- ✅ Proper error messages
- ✅ Efficient filtering with indexes
- ✅ Automatic membership sync
- ✅ Manual sync endpoint for control

**Status: READY FOR PRODUCTION**

---

*Refactor Date: December 2024*
*Migration: `20241230000000_remove_metadata_add_segmentation`*

