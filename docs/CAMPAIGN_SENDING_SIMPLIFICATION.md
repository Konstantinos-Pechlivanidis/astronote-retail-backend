# Campaign Sending Simplification

## Summary

Campaign sending has been simplified to use a fixed batch size approach, removing dynamic batching rules and ensuring campaigns always use the bulk endpoint.

## Changes Made

### 1. Simplified Batching Logic

**Before**:
- Dynamic batch sizing based on campaign size:
  - < 100 messages → 100 per batch
  - 100-1000 → 200 per batch
  - 1000-10000 → 300 per batch
  - > 10000 → 500 per batch
- Two-tier batching for very large campaigns (500k+)

**After**:
- Single fixed batch size for all campaigns
- Default: `SMS_BATCH_SIZE=5000`
- Simple, predictable logic: fetch N messages, send bulk, repeat

**Rationale**:
- Mitto's bulk API can handle 1M+ messages per request
- Dynamic rules were unnecessary complexity
- Fixed size makes monitoring and debugging easier

### 2. Removed USE_BULK_SMS Toggle for Campaigns

**Before**:
- `USE_BULK_SMS` flag could disable bulk sending
- Fallback to individual sends if flag was false
- Dual code paths for campaigns

**After**:
- Campaigns always use bulk endpoint
- No fallback to individual sends
- Single code path: `enqueueCampaign()` → queue → worker → `sendBulkMessages()`

**Rationale**:
- Campaigns should always use bulk for efficiency
- No realistic scenario where individual sends are needed
- Simpler codebase, easier maintenance

### 3. Worker Simplification

**Before**:
- Worker checked `USE_BULK_SMS` flag
- Could process individual jobs for campaigns

**After**:
- Worker always processes `sendBulkSMS` jobs for campaigns
- Individual jobs (`sendSMS`) only for automations and test messages
- Clear separation: campaigns = bulk, automations/test = individual

### 4. Rate Limiting Status

**Implemented**:
- ✅ Per-traffic-account rate limiting (100 req/s default)
- ✅ Per-tenant rate limiting (50 req/s default)
- ✅ Global queue rate limiting (via BullMQ)
- ✅ Integrated into `smsBulk.service.js`

**Status**: All rate limiting features are implemented and active.

## Code Changes

### Files Modified

1. **`apps/api/src/services/campaignEnqueue.service.js`**:
   - Removed dynamic batch sizing logic
   - Removed `USE_BULK_SMS` check
   - Always enqueues `sendBulkSMS` jobs with fixed batch size
   - Removed fallback to individual sends

2. **`apps/worker/src/sms.worker.js`**:
   - Removed `USE_BULK_SMS` flag check
   - Always processes `sendBulkSMS` jobs for campaigns
   - Individual jobs only for automations/test messages

3. **`docs/MESSAGE_SENDING_GUIDE.md`**:
   - Updated to reflect fixed batch size
   - Removed references to dynamic batching
   - Clarified rate limiting implementation status
   - Removed `USE_BULK_SMS` references

## Configuration

### Environment Variables

**Required**:
```bash
SMS_BATCH_SIZE=5000  # Fixed batch size for campaigns (default: 5000)
```

**Optional** (with defaults):
```bash
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100  # Per-traffic-account limit
RATE_LIMIT_TENANT_MAX=50             # Per-tenant limit
WORKER_CONCURRENCY=5                 # Worker concurrency
```

### Recommended Settings

**Production**:
```bash
SMS_BATCH_SIZE=5000
WORKER_CONCURRENCY=5
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100
RATE_LIMIT_TENANT_MAX=50
```

**Staging**:
```bash
SMS_BATCH_SIZE=1000
WORKER_CONCURRENCY=2
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=50
RATE_LIMIT_TENANT_MAX=25
```

## How It Works Now

### Campaign Flow

```
1. User clicks "Send Campaign"
   ↓
2. POST /api/campaigns/:id/enqueue
   ↓
3. campaignEnqueue.service.js:
   - Builds audience
   - Creates CampaignMessage records (status='queued')
   - Groups into fixed-size batches (SMS_BATCH_SIZE)
   - Enqueues sendBulkSMS jobs to Redis
   ↓
4. Worker picks up sendBulkSMS job
   ↓
5. Worker:
   - Fetches queued messages for batch
   - Prepares payload (sender resolution, links)
   - Checks rate limits
   - Calls sendBulkMessages() → /Messages/sendmessagesbulk
   ↓
6. Updates database:
   - Stores bulkId and messageIds
   - Updates status (sent/failed)
   - Debits credits
   ↓
7. Repeat until all batches processed
```

### Example: 50,000 Message Campaign

- Batch size: 5000
- Number of batches: 10
- Each batch processed as separate job
- Simple, predictable, easy to monitor

## Benefits

1. **Simplicity**: Fixed batch size is easier to understand and maintain
2. **Predictability**: Same batch size for all campaigns makes monitoring consistent
3. **Performance**: Mitto handles large batches efficiently
4. **Reliability**: Single code path reduces bugs and edge cases
5. **Maintainability**: Less code, clearer logic

## Testing

### Test Scenarios

1. **Small Campaign** (< 5000 messages):
   - Should create 1 batch
   - Should process correctly

2. **Medium Campaign** (5000-50000 messages):
   - Should create multiple batches
   - Should process all batches

3. **Large Campaign** (50000+ messages):
   - Should create many batches
   - Should process efficiently
   - Should respect rate limits

4. **Rate Limiting**:
   - Should respect per-traffic-account limit
   - Should respect per-tenant limit
   - Should fail gracefully when limits exceeded

## Migration

### No Migration Required

- Existing campaigns in queue will continue to process
- New campaigns automatically use simplified logic
- No database changes needed
- No configuration changes required (unless tuning batch size)

### Optional: Tune Batch Size

If you want to adjust batch size:
```bash
# Increase for fewer jobs (faster processing)
SMS_BATCH_SIZE=10000

# Decrease for more granular control
SMS_BATCH_SIZE=2000
```

## Status

✅ **Complete**: All changes implemented and documented

**Date**: 2025-01-24

