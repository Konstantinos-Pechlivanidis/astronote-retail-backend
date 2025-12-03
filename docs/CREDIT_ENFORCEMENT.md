# Message Credits / Billing Enforcement

## Overview

The system enforces message credits consistently across all SMS sending points. Each SMS message consumes exactly 1 credit, and credits are checked before sending to prevent sending when insufficient balance is available.

## Credit Flow

### 1. Credit Purchase
When a user purchases a package via Stripe:
- Credits are added to the wallet balance
- Transaction is recorded in `CreditTransaction` table
- Processed in `apps/api/src/routes/stripe.webhooks.js`

### 2. Credit Consumption
Credits are consumed when SMS messages are sent:
- **Campaigns**: Debited upfront when enqueuing (all messages at once)
- **Automations**: Debited per message when sending
- **One-off messages**: Debited per message when sending

### 3. Credit Refunds
Credits are refunded on hard failures (non-retryable errors):
- Campaign messages: Refunded in SMS worker on hard failure
- Automation messages: Refunded automatically in `sms.service.js`

## Implementation

### Centralized SMS Service

**File**: `apps/api/src/services/sms.service.js`

The `sendSMSWithCredits()` function provides centralized credit enforcement:

1. **Check Balance**: Verifies sufficient credits before sending
2. **Debit Upfront**: Deducts 1 credit before sending
3. **Send SMS**: Calls Mitto API to send message
4. **Handle Failures**: 
   - Retryable errors: Keep debit (will retry)
   - Hard failures: Refund the credit

**Usage:**
```javascript
const { sendSMSWithCredits } = require('./sms.service');

const result = await sendSMSWithCredits({
  ownerId: 123,
  destination: '+306984303406',
  text: 'Hello!',
  sender: 'MyStore',
  meta: {
    reason: 'automation:welcome',
    campaignId: null,
    messageId: null
  }
});

if (result.sent) {
  // Success
} else if (result.reason === 'insufficient_credits') {
  // Blocked: not enough credits
} else {
  // Send failed (retryable or hard failure)
}
```

### Campaign Messages

**File**: `apps/api/src/services/campaignEnqueue.service.js`

- Credits are debited **upfront** when enqueuing a campaign
- Amount = number of recipients
- If insufficient credits, campaign is reverted to 'draft' status
- Individual message failures are handled in the SMS worker (refunds on hard failures)

**File**: `apps/worker/src/sms.worker.js`

- For campaigns, credits were already debited upfront
- On hard failure, 1 credit is refunded per failed message
- Retryable errors keep the debit (will retry)

### Automation Messages

**File**: `apps/api/src/services/automation.service.js`

Both welcome and birthday automations use `sendSMSWithCredits()`:

- **Welcome Automation**: 
  - Triggered when new contact opts in
  - Checks credits, debits, sends, refunds on hard failure
  
- **Birthday Automation**:
  - Processed daily for all stores
  - Each contact processed individually with credit check
  - Continues processing even if some contacts fail

### Error Handling

**Retryable Errors** (keep debit, will retry):
- Network errors
- Timeouts
- Rate limits (429)
- Server errors (5xx)

**Hard Failures** (refund credit):
- Invalid phone number (4xx)
- Authentication errors (4xx)
- Invalid sender (4xx)
- Other client errors (4xx)

## Database Schema

### Wallet
```prisma
model Wallet {
  id        Int      @id @default(autoincrement())
  ownerId   Int      @unique
  balance   Int      @default(0) // credits balance
  updatedAt DateTime @updatedAt
}
```

### CreditTransaction
```prisma
model CreditTransaction {
  id           Int           @id @default(autoincrement())
  ownerId      Int
  type         CreditTxnType // credit, debit, refund
  amount       Int           // positive integer
  balanceAfter Int           // snapshot after transaction
  reason       String?
  campaignId   Int?
  messageId    Int?
  meta         Json?
  createdAt    DateTime      @default(now())
}
```

## API Responses

### Insufficient Credits

When credits are insufficient, the system returns:

```json
{
  "sent": false,
  "reason": "insufficient_credits",
  "balance": 0,
  "error": "Not enough credits to send SMS. Please purchase a package."
}
```

### Send Failure

```json
{
  "sent": false,
  "reason": "send_failed" | "send_failed_retryable",
  "error": "Error message from provider",
  "balanceAfter": 99
}
```

### Success

```json
{
  "sent": true,
  "messageId": "01KAY04MQR6AEV0PNJYGZW8JEW",
  "providerMessageId": "01KAY04MQR6AEV0PNJYGZW8JEW",
  "trafficAccountId": "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
  "balanceAfter": 99
}
```

## Testing

### Test Credit Enforcement

1. **Check Balance**: `GET /api/billing/balance`
2. **Purchase Package**: `POST /api/billing/purchase` (via Stripe)
3. **Verify Credits Added**: `GET /api/billing/transactions`
4. **Send SMS** (campaign/automation) and verify credit deducted
5. **Check Balance Again**: Should be reduced by 1 per message

### Test Insufficient Credits

1. Set balance to 0 (or low value)
2. Attempt to send SMS (campaign/automation)
3. Verify error response: `insufficient_credits`
4. Verify no SMS was sent

### Test Refunds

1. Send SMS with invalid phone number (hard failure)
2. Verify credit was refunded
3. Check `CreditTransaction` table for refund entry

## Summary

- ✅ Credits checked before every SMS send
- ✅ Credits debited upfront (campaigns) or per message (automations)
- ✅ Credits refunded on hard failures
- ✅ Consistent enforcement across all SMS sending points
- ✅ Clear error messages for insufficient credits
- ✅ Transaction history for audit trail

