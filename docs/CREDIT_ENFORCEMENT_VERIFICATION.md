# Credit Enforcement - Complete Verification

## ✅ All SMS Sending Points Covered

### 1. Campaign Messages ✅

**Flow:**
1. **Enqueue** (`campaignEnqueue.service.js`):
   - Debits credits upfront for ALL recipients (amount = contact count)
   - If insufficient credits → campaign reverted to 'draft', error returned
   - Creates `CampaignMessage` records with status 'queued'
   - Enqueues jobs to SMS queue

2. **SMS Worker** (`sms.worker.js`):
   - Credits already debited upfront, so worker just sends
   - On success → Message marked as 'sent' (credit already consumed)
   - On hard failure → Refunds 1 credit per failed message
   - On retryable error → Keeps debit, will retry

**Status**: ✅ **Correct** - Credits debited upfront, refunded on hard failures

### 2. Welcome Automation ✅

**Flow:**
1. Triggered when new contact opts in (via `POST /api/contacts` or NFC flow)
2. Uses `sendSMSWithCredits()` from `sms.service.js`
3. Checks balance → Debits 1 credit → Sends SMS
4. On hard failure → Refunds credit automatically
5. On retryable error → Keeps debit (will retry)

**Status**: ✅ **Correct** - Full credit enforcement via `sendSMSWithCredits()`

### 3. Birthday Automation ✅

**Flow:**
1. Processed daily for all stores with active birthday automations
2. For each contact with birthday today:
   - Uses `sendSMSWithCredits()` from `sms.service.js`
   - Checks balance → Debits 1 credit → Sends SMS
   - On hard failure → Refunds credit automatically
   - On retryable error → Keeps debit (will retry)
3. Continues processing even if some contacts fail

**Status**: ✅ **Correct** - Full credit enforcement via `sendSMSWithCredits()`

### 4. NFC / Opt-in Flows ✅

**Flow:**
1. NFC form submission creates/updates contact
2. If new contact created → Welcome automation triggered
3. Welcome automation uses `sendSMSWithCredits()` (see #2 above)

**Status**: ✅ **Correct** - No direct SMS sending, uses welcome automation

### 5. One-off Messages ❌ (Not Implemented)

**Status**: No one-off message sending endpoint exists. If needed in future, should use `sendSMSWithCredits()`.

## Credit Enforcement Summary

| SMS Sending Point | Credit Check | Credit Debit | Credit Refund | Status |
|-------------------|--------------|--------------|---------------|--------|
| Campaigns (enqueue) | ✅ Upfront | ✅ Upfront (all) | ✅ On hard fail | ✅ Complete |
| Campaigns (worker) | N/A | N/A (already done) | ✅ On hard fail | ✅ Complete |
| Welcome Automation | ✅ Before send | ✅ Per message | ✅ On hard fail | ✅ Complete |
| Birthday Automation | ✅ Before send | ✅ Per message | ✅ On hard fail | ✅ Complete |
| NFC Flows | ✅ Via automation | ✅ Via automation | ✅ Via automation | ✅ Complete |

## Implementation Details

### Centralized Service
- **File**: `apps/api/src/services/sms.service.js`
- **Function**: `sendSMSWithCredits()`
- **Used by**: Welcome automation, Birthday automation
- **Features**:
  - Balance check before sending
  - Debit 1 credit upfront
  - Send SMS via Mitto
  - Refund on hard failures
  - Keep debit on retryable errors

### Campaign Flow
- **Enqueue**: `apps/api/src/services/campaignEnqueue.service.js`
  - Debits all credits upfront
  - Blocks if insufficient credits
  
- **Worker**: `apps/worker/src/sms.worker.js`
  - Sends message (credit already debited)
  - Refunds on hard failures

### Automation Flow
- **Welcome**: `apps/api/src/services/automation.service.js`
  - Uses `sendSMSWithCredits()`
  
- **Birthday**: `apps/api/src/services/automation.service.js`
  - Uses `sendSMSWithCredits()`

## Credit Purchase

**File**: `apps/api/src/routes/stripe.webhooks.js`

- Credits added when Stripe checkout completes
- Transaction recorded in `CreditTransaction` table
- Wallet balance updated atomically

**Status**: ✅ **Working correctly**

## Error Handling

### Insufficient Credits
- **Response**: `{ sent: false, reason: 'insufficient_credits', balance: 0, error: '...' }`
- **Behavior**: SMS not sent, no credit debited
- **User Action**: Purchase package

### Send Failure (Retryable)
- **Response**: `{ sent: false, reason: 'send_failed_retryable', error: '...' }`
- **Behavior**: Credit remains debited, will retry
- **Examples**: Network errors, timeouts, rate limits, server errors

### Send Failure (Hard)
- **Response**: `{ sent: false, reason: 'send_failed', error: '...' }`
- **Behavior**: Credit refunded automatically
- **Examples**: Invalid phone, auth errors, invalid sender

## Verification Checklist

- [x] Campaigns check credits before enqueuing
- [x] Campaigns debit credits upfront (all recipients)
- [x] Campaigns block if insufficient credits
- [x] Campaign worker refunds on hard failures
- [x] Welcome automation checks credits before sending
- [x] Welcome automation debits per message
- [x] Welcome automation blocks if insufficient credits
- [x] Welcome automation refunds on hard failures
- [x] Birthday automation checks credits before sending
- [x] Birthday automation debits per message
- [x] Birthday automation blocks if insufficient credits
- [x] Birthday automation refunds on hard failures
- [x] NFC flows trigger welcome automation (with credit enforcement)
- [x] Purchase adds credits to wallet
- [x] Transaction history recorded for all operations

## Conclusion

✅ **All SMS sending points enforce credits correctly**

- Campaigns: Debit upfront, refund on hard failures
- Automations: Check, debit, send, refund on hard failures
- NFC flows: Use welcome automation (with credit enforcement)
- Purchase: Adds credits correctly

The credit enforcement system is **complete and production-ready**.

