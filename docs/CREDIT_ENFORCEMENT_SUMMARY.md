# Credit Enforcement - Implementation Summary

## ✅ Complete Implementation

Message credits are now enforced consistently across all SMS sending points in the system.

## Implementation Details

### 1. Centralized SMS Service ✅

**File**: `apps/api/src/services/sms.service.js`

- **Function**: `sendSMSWithCredits()`
- **Features**:
  - Checks balance before sending
  - Debits 1 credit upfront
  - Sends SMS via Mitto
  - Refunds on hard failures
  - Keeps debit on retryable errors

### 2. Campaign Messages ✅

**Files**: 
- `apps/api/src/services/campaignEnqueue.service.js` - Debits upfront
- `apps/worker/src/sms.worker.js` - Refunds on hard failures

**Flow**:
1. When enqueuing a campaign, all credits are debited upfront (number of recipients)
2. If insufficient credits, campaign is reverted to 'draft' status
3. Individual messages are sent via SMS worker
4. On hard failure, 1 credit is refunded per failed message
5. Retryable errors keep the debit (will retry)

**Status**: ✅ Working correctly

### 3. Welcome Automation ✅

**File**: `apps/api/src/services/automation.service.js`

- Uses `sendSMSWithCredits()` for credit enforcement
- Checks credits before sending
- Debits 1 credit per message
- Refunds on hard failures
- Returns clear error if insufficient credits

**Status**: ✅ Implemented

### 4. Birthday Automation ✅

**File**: `apps/api/src/services/automation.service.js`

- Uses `sendSMSWithCredits()` for credit enforcement
- Processes each contact individually
- Checks credits before each send
- Continues processing even if some contacts fail
- Logs insufficient credits warnings

**Status**: ✅ Implemented

### 5. Credit Purchase ✅

**File**: `apps/api/src/routes/stripe.webhooks.js`

- Credits are added when Stripe checkout completes
- Transaction recorded in `CreditTransaction` table
- Wallet balance updated atomically

**Status**: ✅ Working correctly

## Credit Flow Diagram

```
Purchase Package
    ↓
Credits Added to Wallet
    ↓
Send SMS Request
    ↓
Check Balance (sufficient?)
    ├─ NO → Return "insufficient_credits" error
    └─ YES → Debit 1 Credit
            ↓
        Send SMS via Mitto
            ↓
        Success?
        ├─ YES → Done (credit consumed)
        └─ NO → Error Type?
            ├─ Retryable → Keep debit (will retry)
            └─ Hard Failure → Refund 1 Credit
```

## Error Handling

### Insufficient Credits
- **Response**: `{ sent: false, reason: 'insufficient_credits', balance: 0, error: '...' }`
- **Behavior**: SMS is not sent, no credit is debited
- **User Action**: Purchase a package to add credits

### Send Failure (Retryable)
- **Response**: `{ sent: false, reason: 'send_failed_retryable', error: '...' }`
- **Behavior**: Credit remains debited, will retry
- **Examples**: Network errors, timeouts, rate limits, server errors

### Send Failure (Hard)
- **Response**: `{ sent: false, reason: 'send_failed', error: '...' }`
- **Behavior**: Credit is refunded automatically
- **Examples**: Invalid phone number, authentication errors, invalid sender

## Testing Checklist

- [x] Campaign enqueue checks credits upfront
- [x] Campaign enqueue blocks if insufficient credits
- [x] Welcome automation checks credits before sending
- [x] Welcome automation blocks if insufficient credits
- [x] Birthday automation checks credits before sending
- [x] Birthday automation blocks if insufficient credits
- [x] Credits are refunded on hard failures
- [x] Credits are kept on retryable errors
- [x] Purchase adds credits to wallet
- [x] Transaction history is recorded

## API Endpoints

### Check Balance
```
GET /api/billing/balance
```

### View Transactions
```
GET /api/billing/transactions?page=1&pageSize=10
```

### Purchase Package
```
POST /api/billing/purchase
```

## Database Tables

### Wallet
- `id` - Primary key
- `ownerId` - Store owner ID (unique)
- `balance` - Current credit balance
- `updatedAt` - Last update timestamp

### CreditTransaction
- `id` - Primary key
- `ownerId` - Store owner ID
- `type` - `credit`, `debit`, or `refund`
- `amount` - Positive integer (credits)
- `balanceAfter` - Balance after transaction
- `reason` - Transaction reason (e.g., "enqueue:campaign:123")
- `campaignId` - Optional campaign reference
- `messageId` - Optional message reference
- `meta` - Optional JSON metadata
- `createdAt` - Transaction timestamp

## Summary

✅ **All SMS sending points enforce credits**
✅ **Credits checked before every send**
✅ **Credits debited upfront (campaigns) or per message (automations)**
✅ **Credits refunded on hard failures**
✅ **Clear error messages for insufficient credits**
✅ **Transaction history for audit trail**
✅ **Consistent implementation across all sending points**

The credit enforcement system is production-ready and fully integrated.

