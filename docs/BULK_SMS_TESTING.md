# Bulk SMS Testing Guide

This document outlines the test scenarios for the Mitto bulk messaging implementation.

## Test Scenarios

### 1. Unit Tests

#### 1.1 Mitto Service (`mitto.service.js`)

**Test: `sendBulkMessages()` - Success**
- Input: Array of 3 valid message objects
- Expected: Returns `{ bulkId, messages: [{ messageId, trafficAccountId }] }`
- Verify: All messages have messageId

**Test: `sendBulkMessages()` - Empty Array**
- Input: Empty array
- Expected: Throws error "messages array is required and must not be empty"

**Test: `sendBulkMessages()` - Invalid Message Format**
- Input: Array with message missing `trafficAccountId`
- Expected: Throws error about missing required fields

**Test: `sendBulkMessages()` - API Error Handling**
- Mock API to return 500 error
- Expected: Error is properly formatted and thrown

#### 1.2 Bulk SMS Service (`smsBulk.service.js`)

**Test: `sendBulkSMSWithCredits()` - Success (All Messages)**
- Input: Array of 5 messages with valid data
- Mock: Subscription active, sufficient credits, Mitto API success
- Expected: All messages return `sent: true` with messageIds, credits debited per message

**Test: `sendBulkSMSWithCredits()` - Inactive Subscription**
- Input: Array of messages
- Mock: Subscription inactive
- Expected: All messages return `sent: false, reason: 'inactive_subscription'`, no credits debited

**Test: `sendBulkSMSWithCredits()` - Insufficient Credits**
- Input: Array of 10 messages
- Mock: Balance = 5 credits
- Expected: All messages return `sent: false, reason: 'insufficient_credits'`, no credits debited

**Test: `sendBulkSMSWithCredits()` - Partial Success**
- Input: Array of 5 messages
- Mock: Mitto returns 3 successful, 2 failed (no messageId)
- Expected: 3 messages `sent: true`, 2 messages `sent: false`, credits debited only for successful

**Test: `sendBulkSMSWithCredits()` - Unsubscribe Link Appended**
- Input: Message with `contactId`
- Expected: Final text includes unsubscribe link

**Test: `sendBulkSMSWithCredits()` - Credit Debit Failure**
- Input: Valid messages, successful send
- Mock: Credit debit throws error
- Expected: Message still marked as sent, error logged

#### 1.3 Worker (`sms.worker.js`)

**Test: `processBatchJob()` - Success**
- Input: Batch job with 5 messageIds
- Mock: All messages found, bulk send successful
- Expected: All messages updated with `bulkId`, `providerMessageId`, `status: 'sent'`

**Test: `processBatchJob()` - Partial Failure**
- Input: Batch job with 5 messageIds
- Mock: 3 successful, 2 failed in response
- Expected: 3 messages `status: 'sent'`, 2 messages `status: 'failed'`

**Test: `processBatchJob()` - Network Error (Retryable)**
- Input: Batch job
- Mock: Network error (no status code)
- Expected: Messages remain `status: 'queued'`, error thrown for retry

**Test: `processBatchJob()` - Invalid Phone (Non-retryable)**
- Input: Batch job with invalid phone numbers
- Mock: Mitto returns 400 error
- Expected: Messages marked `status: 'failed'`, no retry

**Test: `processIndividualJob()` - Backward Compatibility**
- Input: Individual job with `messageId`
- Expected: Processes using old `sendSingle()` method

### 2. Integration Tests

#### 2.1 Campaign Enqueue Flow

**Test: Campaign Enqueue with Bulk SMS Enabled**
- Setup: `USE_BULK_SMS=true`, `SMS_BATCH_SIZE=200`
- Action: Enqueue campaign with 500 messages
- Expected: 
  - 3 batch jobs enqueued (200, 200, 100)
  - All jobs have type `sendBulkSMS`
  - Job data includes `campaignId`, `ownerId`, `messageIds`

**Test: Campaign Enqueue with Bulk SMS Disabled**
- Setup: `USE_BULK_SMS=false`
- Action: Enqueue campaign with 500 messages
- Expected: 500 individual jobs enqueued (type `sendSMS`)

**Test: Campaign Enqueue - Batch Size Boundary**
- Setup: `SMS_BATCH_SIZE=200`
- Action: Enqueue campaign with exactly 200 messages
- Expected: 1 batch job with 200 messageIds

#### 2.2 Worker Processing Flow

**Test: Full Campaign Send Flow**
- Setup: Campaign with 10 messages, bulk SMS enabled
- Action: Enqueue campaign, process all jobs
- Expected:
  - All messages sent via bulk endpoint
  - All messages have `bulkId` set
  - All messages have `providerMessageId` set
  - Campaign aggregates updated correctly
  - Credits debited correctly

**Test: Large Campaign (1000+ messages)**
- Setup: Campaign with 1500 messages
- Action: Enqueue and process
- Expected:
  - 8 batch jobs (7x200 + 1x100)
  - All batches processed successfully
  - Campaign status becomes `completed`

#### 2.3 Status Refresh

**Test: Refresh Bulk Statuses**
- Setup: Campaign with messages having same `bulkId`
- Action: Call `refreshBulkStatuses(bulkId)`
- Expected: All messages with that `bulkId` have status refreshed

**Test: Refresh Campaign Statuses (with bulkId)**
- Setup: Campaign with mixed bulkId and non-bulkId messages
- Action: Call `refreshCampaignStatuses(campaignId, ownerId)`
- Expected: All messages refreshed regardless of bulkId

### 3. Edge Cases & Error Scenarios

**Test: Empty Batch**
- Input: Batch job with empty `messageIds` array
- Expected: Job completes without error, logs warning

**Test: Messages Not Found**
- Input: Batch job with invalid messageIds
- Expected: Job completes, logs warning, no errors thrown

**Test: Mixed Owner IDs in Batch**
- Input: Batch with messages from different owners (shouldn't happen, but test)
- Expected: Error thrown or filtered out

**Test: Duplicate MessageIds in Batch**
- Input: Batch with same messageId twice
- Expected: Handled gracefully (Prisma will handle duplicates)

**Test: Very Large Batch (1000+ messages)**
- Input: Batch with 1000 messages
- Expected: Successfully processed, all messages updated

**Test: Network Timeout**
- Mock: Mitto API times out
- Expected: Retryable error, batch retried

**Test: Rate Limiting (429)**
- Mock: Mitto returns 429
- Expected: Retryable error, batch retried with backoff

### 4. Credit Debit Verification

**Test: Credits Debited Only for Successful Sends**
- Setup: Batch with 5 messages, 3 succeed, 2 fail
- Expected: 3 credits debited, 2 credits not debited

**Test: Credit Debit Transaction Logging**
- Setup: Successful batch send
- Expected: CreditTransaction records created with correct `campaignId`, `messageId`, `bulkId` in meta

**Test: Insufficient Credits Check**
- Setup: Campaign with 100 messages, balance = 50
- Expected: Enqueue fails before creating messages, no credits debited

### 5. Database Verification

**Test: bulkId Stored Correctly**
- Action: Send batch
- Expected: All messages in batch have same `bulkId` value

**Test: bulkId Index Performance**
- Action: Query messages by `bulkId`
- Expected: Query uses index, fast performance

**Test: Migration Rollback**
- Action: Rollback migration
- Expected: `bulkId` column removed, existing code still works (bulkId is nullable)

### 6. Performance Tests

**Test: Batch vs Individual Send Performance**
- Setup: Campaign with 1000 messages
- Measure: Time to send all messages
- Expected: Bulk sending significantly faster (fewer API calls)

**Test: Worker Concurrency with Batches**
- Setup: Multiple batch jobs in queue
- Expected: Worker processes batches concurrently (respects concurrency limit)

## Test Implementation Notes

### Mocking Strategy

1. **Mitto API**: Mock `mittoRequest()` function to return controlled responses
2. **Database**: Use test database or Prisma mock
3. **Redis/Queue**: Use in-memory queue or mock BullMQ
4. **Wallet Service**: Mock credit debit to verify calls

### Test Data Setup

- Create test users with subscriptions
- Create test campaigns with messages
- Set up test contacts
- Configure test environment variables

### Running Tests

```bash
# Unit tests
npm test -- services/smsBulk.service.test.js
npm test -- services/mitto.service.test.js
npm test -- worker/sms.worker.test.js

# Integration tests
npm test -- integration/bulk-sms.test.js

# All tests
npm test
```

## Manual Testing Checklist

- [ ] Enable bulk SMS: `USE_BULK_SMS=true`
- [ ] Set batch size: `SMS_BATCH_SIZE=200`
- [ ] Create campaign with 500 messages
- [ ] Verify batch jobs created in Redis
- [ ] Verify messages sent via bulk endpoint
- [ ] Verify `bulkId` stored in database
- [ ] Verify credits debited correctly
- [ ] Verify campaign aggregates updated
- [ ] Test status refresh by `bulkId`
- [ ] Test rollback: disable bulk SMS, verify individual sends work
- [ ] Test with small batch (5 messages)
- [ ] Test with large batch (1000 messages)
- [ ] Test partial failure scenario
- [ ] Test network error retry

## Success Criteria

All tests should pass:
- ✅ Unit tests: 100% pass rate
- ✅ Integration tests: All scenarios covered
- ✅ No credit debit errors
- ✅ No database constraint violations
- ✅ Proper error handling and logging
- ✅ Backward compatibility maintained

