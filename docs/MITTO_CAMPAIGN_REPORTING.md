# Mitto Integration & Campaign Reporting

## Overview

The Mitto SMS integration is complete and **automatically integrates with existing campaign reporting**. The system already tracks sent, delivered, and failed message counts for each campaign.

## How It Works

### 1. Message Status Flow

```
Send SMS → Worker → Mitto API → Store messageId
                                    ↓
                            Status Updates Via:
                                1. Webhooks (automatic)
                                2. Manual refresh (API)
                                3. Bulk refresh (API)
                                    ↓
                            Update CampaignMessage.status
                                    ↓
                            Campaign Stats Automatically Updated
```

### 2. Status Updates

Message statuses are updated in three ways:

#### A. Automatic (Webhooks)
- Mitto sends DLR (Delivery Reports) to `/webhooks/mitto/dlr`
- Status automatically updated to `delivered` or `failed`
- **No action required** - works automatically

#### B. Manual Refresh (Single Message)
```bash
POST /api/mitto/refresh-status
Body: { "providerMessageId": "01K8RBH8A6J1410YE2M9G780PK" }
```

#### C. Bulk Refresh (Campaign)
```bash
POST /api/mitto/refresh-status-bulk
Body: { "campaignId": 1 }
```
- Refreshes all messages in a campaign (up to 100)
- Updates statuses based on Mitto `deliveryStatus`
- Invalidates campaign stats cache

### 3. Campaign Statistics

Campaign stats **already include** Mitto status information:

**Endpoint**: `GET /api/v1/campaigns/:id/stats`

**Response**:
```json
{
  "campaignId": 1,
  "sent": 150,           // Total sent (sent + delivered + failed)
  "delivered": 142,      // Successfully delivered
  "failed": 8,           // Failed to deliver
  "redemptions": 45,     // Tracking link redemptions
  "unsubscribes": 2,     // Unsubscribes since campaign start
  "deliveredRate": 0.9467,  // 142/150 = 94.67%
  "conversionRate": 0.3169, // 45/142 = 31.69%
  "firstSentAt": "2024-01-15T10:00:00Z"
}
```

**Status Mapping**:
- `sent` = messages with status `sent`, `delivered`, or `failed`
- `delivered` = messages with status `delivered` (from Mitto)
- `failed` = messages with status `failed` (from Mitto)

### 4. Status Mapping

Mitto `deliveryStatus` → Internal `status`:

| Mitto Status | Internal Status | Campaign Stats |
|-------------|----------------|----------------|
| `Delivered`, `delivered` | `delivered` | Counted in `delivered` |
| `Failure`, `Failed`, `failed` | `failed` | Counted in `failed` |
| Others (`Pending`, `Sent`, etc.) | `sent` | Counted in `sent` |

## Campaign Reporting Endpoints

### Get Campaign Stats
```bash
GET /api/v1/campaigns/:id/stats
Authorization: Bearer {token}
```

**Returns**:
- `sent` - Total messages sent
- `delivered` - Successfully delivered (from Mitto)
- `failed` - Failed to deliver (from Mitto)
- `deliveredRate` - Delivery success rate
- `conversionRate` - Redemption rate

### Get Multiple Campaign Stats
```bash
GET /api/v1/campaigns/stats?ids=1,2,3
Authorization: Bearer {token}
```

**Returns**: Array of stats for each campaign

### List Campaigns with Stats
```bash
GET /api/v1/campaigns?withStats=true&page=1&pageSize=10
Authorization: Bearer {token}
```

**Returns**: Campaign list with embedded stats

## Refreshing Campaign Statuses

### Option 1: Bulk Refresh (Recommended)

Refresh all messages in a campaign:
```bash
POST /api/mitto/refresh-status-bulk
Authorization: Bearer {token}
Content-Type: application/json

{
  "campaignId": 1
}
```

**Response**:
```json
{
  "total": 150,
  "updated": 148,
  "failed": 2,
  "results": [
    { "providerMessageId": "...", "success": true, "updated": 1, ... },
    { "providerMessageId": "...", "success": false, "error": "..." }
  ]
}
```

**Benefits**:
- Updates all messages in campaign at once
- Automatically invalidates campaign stats cache
- Returns detailed results

### Option 2: Scheduled Refresh (Future Enhancement)

You can add a scheduled job to periodically refresh statuses:

```javascript
// Example: Refresh statuses for campaigns sent in last 24 hours
const campaigns = await prisma.campaign.findMany({
  where: {
    ownerId: userId,
    status: { in: ['sending', 'sent'] },
    startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  },
  select: { id: true }
});

for (const campaign of campaigns) {
  await refreshMessageStatusBulk(campaign.id, userId);
}
```

## Current Implementation Status

### ✅ Already Implemented

1. **Campaign Stats Service** (`campaignStats.service.js`):
   - Tracks `sent`, `delivered`, `failed` counts
   - Calculates `deliveredRate` and `conversionRate`
   - Scoped by `ownerId` for security

2. **Mitto Status Refresh** (`mitto.service.js`):
   - `refreshMessageStatus()` - Updates single message
   - `refreshMessageStatusBulk()` - Updates campaign messages
   - Maps Mitto status to internal status
   - Updates database and invalidates cache

3. **API Endpoints**:
   - `GET /api/v1/campaigns/:id/stats` - Get campaign stats
   - `POST /api/mitto/refresh-status-bulk` - Refresh campaign statuses

4. **Automatic Updates**:
   - Webhooks update status automatically
   - Stats cache invalidated on refresh

### 📊 Reporting Features

The current implementation provides:

- ✅ **Sent Count**: Total messages sent
- ✅ **Delivered Count**: Successfully delivered (from Mitto)
- ✅ **Failed Count**: Failed to deliver (from Mitto)
- ✅ **Delivery Rate**: Percentage delivered
- ✅ **Conversion Rate**: Redemption rate
- ✅ **Unsubscribe Count**: Unsubscribes since campaign start
- ✅ **First Sent At**: Campaign start timestamp

## Example Workflow

### 1. Send Campaign
```bash
POST /api/campaigns/:id/enqueue
```
- Messages created with status `queued`
- Worker sends via Mitto
- Status updated to `sent`
- `messageId` stored in `providerMessageId`

### 2. Check Status (Automatic)
- Mitto webhooks update status to `delivered` or `failed`
- Campaign stats automatically reflect changes

### 3. Manual Refresh (If Needed)
```bash
POST /api/mitto/refresh-status-bulk
Body: { "campaignId": 1 }
```
- Fetches latest status from Mitto
- Updates all messages in campaign
- Invalidates stats cache

### 4. View Campaign Report
```bash
GET /api/v1/campaigns/1/stats
```
**Response**:
```json
{
  "campaignId": 1,
  "sent": 150,
  "delivered": 142,
  "failed": 8,
  "deliveredRate": 0.9467,
  "conversionRate": 0.3169
}
```

## Recommendations

### Current Implementation: ✅ Production Ready

The current implementation is **sufficient for marketing phase** because:

1. ✅ **Complete Status Tracking**: All message statuses tracked
2. ✅ **Automatic Updates**: Webhooks handle most updates
3. ✅ **Manual Refresh**: API available when needed
4. ✅ **Campaign Reports**: Stats include all necessary metrics
5. ✅ **Performance**: Cached stats with automatic invalidation

### Optional Enhancements (Future)

If you need more detailed reporting later, consider:

1. **Time-based Breakdown**: Stats by hour/day
2. **Status History**: Track status changes over time
3. **Retry Logic**: Automatic retry for failed messages
4. **Scheduled Refresh**: Cron job to refresh pending statuses
5. **Export Reports**: CSV/PDF export of campaign stats

## Conclusion

**The Mitto integration is complete and fully integrated with campaign reporting.**

- ✅ Message statuses tracked automatically
- ✅ Campaign stats include sent/delivered/failed counts
- ✅ Manual refresh available via API
- ✅ Webhooks provide automatic updates
- ✅ Stats are cached and automatically invalidated

**No additional implementation needed for marketing phase.**

The existing campaign stats endpoints already provide all necessary reporting:
- Total sent
- Delivered count (from Mitto)
- Failed count (from Mitto)
- Delivery rate
- Conversion rate

You can use `POST /api/mitto/refresh-status-bulk` with `campaignId` to refresh all message statuses for a campaign and get an updated report.

