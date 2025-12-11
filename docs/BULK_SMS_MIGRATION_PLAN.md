# Bulk SMS Migration Plan & Rollback Guide

This document outlines the step-by-step process for migrating to Mitto's bulk messaging endpoint and how to rollback if needed.

## Pre-Migration Checklist

- [ ] Database backup created
- [ ] Code deployed to staging environment
- [ ] Staging tests passed
- [ ] Monitoring and alerting configured
- [ ] Team notified of migration window
- [ ] Rollback plan reviewed and understood

## Migration Steps

### Step 1: Deploy Database Migration

**Action**: Run Prisma migration to add `bulkId` column

```bash
# In production
cd astronote-retail-backend
npx prisma migrate deploy --schema=prisma/schema.prisma
```

**Verification**:
```sql
-- Verify column exists
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'CampaignMessage' AND column_name = 'bulkId';

-- Should return: bulkId | text | YES
```

**Rollback**: If migration fails, it can be rolled back:
```sql
ALTER TABLE "CampaignMessage" DROP COLUMN IF EXISTS "bulkId";
DROP INDEX IF EXISTS "CampaignMessage_bulkId_idx";
```

### Step 2: Deploy Backend Code

**Action**: Deploy updated backend code (all services and worker)

**Files Changed**:
- `apps/api/src/services/mitto.service.js` - Added `sendBulkMessages()`
- `apps/api/src/services/smsBulk.service.js` - New file
- `apps/api/src/services/campaignEnqueue.service.js` - Batch grouping logic
- `apps/api/src/services/statusRefresh.service.js` - Added `refreshBulkStatuses()`
- `apps/worker/src/sms.worker.js` - Batch processing support

**Verification**:
- Backend starts without errors
- Worker starts without errors
- No linting errors
- All services load correctly

### Step 3: Configure Environment Variables

**Action**: Set environment variables (do NOT enable bulk SMS yet)

```bash
# Add to .env file (but keep USE_BULK_SMS=false initially)
SMS_BATCH_SIZE=200
USE_BULK_SMS=false  # Keep disabled for now
```

**Verification**:
- Environment variables loaded correctly
- Default batch size is 200 if not set
- Bulk SMS remains disabled

### Step 4: Verify Backward Compatibility

**Action**: Test that existing individual sends still work

**Test**:
1. Create a small test campaign (5 messages)
2. Verify it sends via individual endpoint (check logs)
3. Verify messages are sent successfully
4. Verify credits are debited correctly

**Expected**: Everything works as before (individual sends)

### Step 5: Enable Bulk SMS (Gradual Rollout)

**Option A: All at Once**
```bash
# Enable for all campaigns
USE_BULK_SMS=true
```

**Option B: Gradual Rollout (Recommended)**
- Start with 10% of campaigns
- Monitor for 1 hour
- Increase to 50% if no issues
- Monitor for 2 hours
- Enable for 100% if stable

**For gradual rollout**, you can use a feature flag service or modify code to check campaign ID:
```javascript
// In campaignEnqueue.service.js
const USE_BULK_SMS = process.env.USE_BULK_SMS === 'true' && 
  (camp.id % 10 < 1); // Enable for 10% of campaigns
```

### Step 6: Monitor Initial Batches

**Action**: Monitor first few batches closely

**Check**:
- [ ] Batch jobs created in Redis
- [ ] Worker processing batches
- [ ] Messages sent via bulk endpoint (check Mitto logs)
- [ ] `bulkId` stored in database
- [ ] Credits debited correctly
- [ ] Campaign aggregates updated
- [ ] No errors in logs

**Monitoring Queries**:
```sql
-- Check bulkId distribution
SELECT bulkId, COUNT(*) as message_count
FROM "CampaignMessage"
WHERE bulkId IS NOT NULL
GROUP BY bulkId
ORDER BY message_count DESC
LIMIT 10;

-- Check batch sizes
SELECT 
  bulkId,
  COUNT(*) as batch_size,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
FROM "CampaignMessage"
WHERE bulkId IS NOT NULL
GROUP BY bulkId
ORDER BY batch_size DESC;
```

### Step 7: Full Rollout

**Action**: Enable bulk SMS for 100% of campaigns

**Verification**:
- All new campaigns use bulk endpoint
- No increase in error rates
- Performance improved (fewer API calls)
- Credits debiting correctly

## Rollback Procedure

### Immediate Rollback (Feature Flag)

**Action**: Disable bulk SMS via environment variable

```bash
# Set in environment
USE_BULK_SMS=false

# Restart worker (if needed)
# Worker will automatically fall back to individual sends
```

**Time**: < 1 minute

**Impact**: 
- New campaigns will use individual sends
- Existing batch jobs in queue will still process (but can be cleared)
- No data loss

### Full Rollback (Code Revert)

**If needed**: Revert to previous code version

**Steps**:
1. Revert code deployment
2. Keep database migration (bulkId column can stay, it's nullable)
3. Restart services

**Time**: 5-10 minutes

**Impact**: All functionality returns to individual sends

### Database Rollback (Optional)

**Only if needed**: Remove bulkId column

```sql
-- WARNING: This will lose bulkId data
ALTER TABLE "CampaignMessage" DROP COLUMN IF EXISTS "bulkId";
DROP INDEX IF EXISTS "CampaignMessage_bulkId_idx";
```

**Note**: This is usually NOT necessary. The column is nullable and doesn't affect old code.

## Feature Flag Configuration

### Environment Variables

```bash
# Enable/disable bulk SMS
USE_BULK_SMS=true|false

# Batch size (messages per batch)
SMS_BATCH_SIZE=200

# Worker concurrency (batches processed simultaneously)
WORKER_CONCURRENCY=5
```

### Recommended Settings

**Production**:
```bash
USE_BULK_SMS=true
SMS_BATCH_SIZE=200
WORKER_CONCURRENCY=5
```

**Staging**:
```bash
USE_BULK_SMS=true
SMS_BATCH_SIZE=50  # Smaller batches for testing
WORKER_CONCURRENCY=2
```

**Development**:
```bash
USE_BULK_SMS=false  # Use individual sends for easier debugging
SMS_BATCH_SIZE=10
```

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Batch Job Success Rate**
   - Alert if < 95% success rate
   - Query: Count successful vs failed batch jobs

2. **Credit Debit Accuracy**
   - Alert if credits debited != messages sent
   - Query: Compare credit transactions vs sent messages

3. **API Call Reduction**
   - Monitor Mitto API call count
   - Should see significant reduction with bulk sends

4. **Worker Performance**
   - Monitor batch processing time
   - Alert if batches taking > 30 seconds

5. **Error Rates**
   - Monitor error logs for bulk-related errors
   - Alert on any new error patterns

### Monitoring Queries

```sql
-- Batch success rate
SELECT 
  DATE(createdAt) as date,
  COUNT(DISTINCT bulkId) as total_batches,
  COUNT(DISTINCT CASE WHEN status = 'sent' THEN bulkId END) as successful_batches,
  COUNT(DISTINCT CASE WHEN status = 'failed' THEN bulkId END) as failed_batches
FROM "CampaignMessage"
WHERE bulkId IS NOT NULL
  AND createdAt > NOW() - INTERVAL '24 hours'
GROUP BY DATE(createdAt);

-- Average batch size
SELECT 
  bulkId,
  COUNT(*) as batch_size
FROM "CampaignMessage"
WHERE bulkId IS NOT NULL
GROUP BY bulkId;

-- Messages without bulkId (should be 0 if bulk enabled)
SELECT COUNT(*) 
FROM "CampaignMessage"
WHERE bulkId IS NULL 
  AND status = 'sent'
  AND createdAt > NOW() - INTERVAL '1 hour';
```

## Verification Checklist

After migration, verify:

- [ ] Database migration applied successfully
- [ ] Backend code deployed
- [ ] Worker restarted and running
- [ ] Environment variables set correctly
- [ ] Test campaign sent successfully
- [ ] `bulkId` stored in database
- [ ] Credits debited correctly
- [ ] Campaign aggregates updated
- [ ] No errors in logs
- [ ] Performance improved (fewer API calls)
- [ ] Monitoring dashboards updated

## Troubleshooting

### Issue: Batch jobs not processing

**Check**:
1. Worker is running: `ps aux | grep sms.worker`
2. Redis connection: Check worker logs
3. Queue status: Check Redis for jobs
4. Feature flag: Verify `USE_BULK_SMS=true`

**Fix**: Restart worker, check Redis connection

### Issue: Messages not getting bulkId

**Check**:
1. Bulk SMS enabled: `USE_BULK_SMS=true`
2. Worker processing batch jobs (not individual)
3. Database column exists

**Fix**: Verify feature flag, check worker logs

### Issue: Credits not debiting

**Check**:
1. Messages have `messageId` in response
2. Credit debit service working
3. Wallet service logs

**Fix**: Check `smsBulk.service.js` credit debit logic

### Issue: Partial failures in batch

**Expected**: Some messages may fail (invalid numbers, etc.)
**Action**: Check individual message errors, verify retry logic

## Post-Migration Tasks

1. **Monitor for 24-48 hours**
   - Watch error rates
   - Verify credit debiting
   - Check performance metrics

2. **Optimize Batch Size**
   - Monitor batch processing times
   - Adjust `SMS_BATCH_SIZE` if needed
   - Test different sizes (100, 200, 500)

3. **Update Documentation**
   - Update API documentation
   - Update runbooks
   - Document any issues encountered

4. **Clean Up**
   - Remove any temporary code
   - Update feature flag comments
   - Archive migration logs

## Support Contacts

- **Backend Team**: For code issues
- **DevOps**: For infrastructure/deployment
- **Database Team**: For migration issues
- **Mitto Support**: For API issues

## Migration Timeline

**Estimated Time**: 2-4 hours

- Step 1 (Database): 15 minutes
- Step 2 (Deploy): 30 minutes
- Step 3 (Config): 15 minutes
- Step 4 (Verify): 30 minutes
- Step 5 (Enable): 30 minutes
- Step 6 (Monitor): 1-2 hours
- Step 7 (Full Rollout): 15 minutes

**Total**: ~2-4 hours (including monitoring period)

## Success Criteria

Migration is successful when:
- ✅ All campaigns using bulk endpoint
- ✅ No increase in error rates
- ✅ Credits debiting correctly
- ✅ Performance improved
- ✅ No data loss
- ✅ Monitoring shows healthy metrics

