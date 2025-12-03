# System-Defined Segmentation Implementation

## Overview

The campaign system now uses **system-defined segments** instead of custom lists. Users can create campaigns by selecting predefined filters (gender and age groups) rather than managing custom lists.

## Key Changes

### 1. Campaign Model Updates

**New Fields**:
- `filterGender` (Gender?): Filter by gender (null = Any, 'male', 'female', etc.)
- `filterAgeGroup` (AgeGroup?): Filter by age group (null = Any, 'age_18_24', 'age_25_39', 'age_40_plus')
- `listId` (Int?): Made optional for backward compatibility with legacy campaigns

**New Enum**:
- `AgeGroup`: `age_18_24`, `age_25_39`, `age_40_plus`

### 2. Age Groups

The system supports three predefined age groups:
- **18-24**: Ages 18 to 24 (inclusive)
- **25-39**: Ages 25 to 39 (inclusive)
- **40+**: Ages 40 and above (no upper limit)

**Important**: Only contacts aged 18+ are included (adults only requirement).

### 3. Gender Filter

- **Any** (null): Includes all contacts regardless of gender
- **Male**: Only male contacts
- **Female**: Only female contacts
- **Other**: Only contacts with gender 'other'
- **Prefer not to say**: Only contacts with gender 'prefer_not_to_say'

**Note**: Contacts without a gender value are included when filter is set to "Any".

### 4. Name Search

- Optional filter for preview/search purposes
- Searches both `firstName` and `lastName` fields
- Case-insensitive partial match
- **Not saved** in campaign - only used for preview/filtering

## API Endpoints

### Create Campaign

**POST** `/api/campaigns`

**Request Body**:
```json
{
  "name": "Summer Sale Campaign",
  "templateId": 1,
  "filterGender": "female",        // Optional: null (Any), "male", "female", etc.
  "filterAgeGroup": "25_39",       // Optional: null (Any), "18_24", "25_39", "40_plus"
  "scheduledAt": "2024-06-01T10:00:00Z"  // Optional: ISO date string
}
```

**Response**: Campaign object with `filterGender` and `filterAgeGroup` fields

### Preview Audience

**POST** `/api/campaigns/preview-audience`

**Request Body**:
```json
{
  "filterGender": "female",        // Optional
  "filterAgeGroup": "25_39",       // Optional
  "nameSearch": "john"             // Optional: search by name
}
```

**Response**:
```json
{
  "count": 150,
  "preview": [
    {
      "id": 1,
      "phone": "+306984303406",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "gender": "male",
      "birthday": "1990-01-15T00:00:00.000Z"
    }
  ],
  "hasMore": true
}
```

### Get Campaign

**GET** `/api/campaigns/:id`

**Response**: Campaign object with `filterGender` and `filterAgeGroup` (normalized to '18_24', '25_39', '40_plus' format)

## Audience Building Logic

The `audience.service.js` builds the audience dynamically:

1. **Base Filter**: Only subscribed contacts (`isSubscribed: true`)
2. **Owner Scope**: Only contacts belonging to the store (`ownerId`)
3. **Gender Filter**: Applied if `filterGender` is provided
4. **Age Filter**: 
   - If `filterAgeGroup` is provided, filter by age group
   - If no age group, still filter out contacts under 18 (adults only)
   - Contacts without birthday are excluded (can't verify age)
5. **Name Search**: Applied if provided (for preview only)

## Campaign Enqueue

When a campaign is enqueued:

1. **Check for filters**: If `filterGender` or `filterAgeGroup` is set, use new segmentation
2. **Legacy support**: If `listId` is set (and no filters), use legacy list memberships
3. **Build audience**: Dynamically build audience based on filters
4. **Create messages**: Create `CampaignMessage` records for all matching contacts
5. **Enqueue jobs**: Add SMS sending jobs to the queue

## Migration

**File**: `prisma/migrations/20241231000000_add_campaign_segmentation/migration.sql`

**Changes**:
- Creates `AgeGroup` enum
- Makes `listId` nullable
- Adds `filterGender` column
- Adds `filterAgeGroup` column
- Adds indexes for filtering

**To Apply**:
```bash
npx prisma migrate dev
```

## Backward Compatibility

- **Legacy campaigns** with `listId` will continue to work
- **New campaigns** should use `filterGender` and `filterAgeGroup`
- **Preview endpoint** works with both old and new campaigns

## Validation

### Gender Values
- Valid: `null` (Any), `'male'`, `'female'`, `'other'`, `'prefer_not_to_say'`
- Invalid values return 400 error

### Age Group Values
- Valid: `null` (Any), `'18_24'`, `'25_39'`, `'40_plus'` (or `'40+'`)
- Invalid values return 400 error

## Examples

### Example 1: All Female Contacts, 25-39
```json
{
  "name": "Women 25-39 Campaign",
  "templateId": 1,
  "filterGender": "female",
  "filterAgeGroup": "25_39"
}
```

### Example 2: Any Gender, 18-24
```json
{
  "name": "Young Adults Campaign",
  "templateId": 1,
  "filterGender": null,
  "filterAgeGroup": "18_24"
}
```

### Example 3: All Adults (40+)
```json
{
  "name": "Mature Audience Campaign",
  "templateId": 1,
  "filterGender": null,
  "filterAgeGroup": "40_plus"
}
```

## Benefits

1. **Simpler UX**: No need to manage custom lists
2. **Larger Audiences**: Predefined age groups maximize audience size
3. **Reusable**: Same filters can be used across multiple campaigns
4. **Dynamic**: Audience built at campaign creation/enqueue time
5. **Flexible**: Name search available for preview/search

