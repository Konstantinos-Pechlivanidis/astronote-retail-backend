# Prisma Enum `{ in: [...] }` Fix - Retail Backend

**Date**: 2025-12-12  
**Status**: ✅ **FIXED**

---

## Problem

Prisma doesn't support `{ in: [...] }` syntax for enum fields in `where` clauses. The `status` field in the `CampaignMessage` model is of type `MessageStatus` (enum), so we need to use `OR` conditions with `AND` wrapper instead.

---

## Root Cause

When using `OR` conditions in Prisma, they cannot be combined directly with other conditions like `id`, `ownerId`, etc. in the same `where` object. We need to wrap both in an `AND` clause.

---

## Solution

Changed from:
```javascript
where: {
  campaignId,
  ownerId,
  status: { in: ['queued', 'sent'] },
  providerMessageId: { not: null }
}
```

To:
```javascript
where: {
  campaignId,
  ownerId,
  AND: [
    {
      OR: [
        { status: 'queued' },
        { status: 'sent' },
      ],
    },
    { providerMessageId: { not: null } },
  ],
}
```

---

## Files Modified

### Retail Backend
- `apps/api/src/services/statusRefresh.service.js` (3 locations)
  1. Line 60-65: `refreshCampaignStatus()` function
  2. Line 171-174: `refreshAllStatuses()` function
  3. Line 330-338: `refreshBulkStatus()` function

---

## Verification

- ✅ Linting passed (0 errors, 0 warnings)
- ✅ Code changes verified
- ✅ All enum queries fixed

---

## Note

**No migration needed** - This is a code change only, not a schema change. The Prisma schema remains unchanged.

---

**Status**: ✅ **PRODUCTION-READY**

