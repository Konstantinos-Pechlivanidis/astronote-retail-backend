# Stripe Billing Integration

## Overview

This document describes the Stripe billing integration implementation for the SMS marketing backend. The integration provides a production-ready payment flow using Stripe Checkout.

## Architecture

### Flow Diagram

```
1. User selects package
   └─> Frontend calls POST /api/billing/purchase
       └─> Backend creates Stripe checkout session
           └─> Returns checkout URL

2. User completes payment on Stripe
   └─> Stripe redirects to success URL

3. Stripe sends webhook
   └─> POST /webhooks/stripe
       └─> Verify signature
       └─> Handle checkout.session.completed
           └─> Update Purchase status to 'paid'
           └─> Credit wallet
```

## Database Schema Changes

### Purchase Model Updates

Added Stripe-related fields:
- `stripeSessionId` - Stripe checkout session ID (unique)
- `stripePaymentIntentId` - Stripe payment intent ID
- `stripeCustomerId` - Stripe customer ID
- `stripePriceId` - Stripe price ID used
- `currency` - Currency code (EUR, USD, etc.)
- `status` - Changed default from 'paid' to 'pending'
- `updatedAt` - Added for tracking status changes

### Package Model Updates

Added optional Stripe price ID fields:
- `stripePriceIdEur` - Stripe price ID for EUR
- `stripePriceIdUsd` - Stripe price ID for USD

## Environment Variables

Required:
- `STRIPE_SECRET_KEY` - Stripe secret key (sk_live_... or sk_test_...)

### Subscription Price IDs (Required for Subscriptions)

For subscription plans to work, you must configure recurring price IDs in Stripe and set these environment variables:

- `STRIPE_PRICE_ID_SUB_STARTER_EUR` - Recurring price ID for Starter plan (€40/month) in EUR
- `STRIPE_PRICE_ID_SUB_PRO_EUR` - Recurring price ID for Pro plan (€240/month) in EUR
- `STRIPE_PRICE_ID_CREDIT_TOPUP_EUR` - (Optional) One-time price ID for credit top-ups in EUR

**Important Notes:**
1. These price IDs must be configured as **recurring prices** in your Stripe dashboard
2. The price type must be `recurring` (not `one_time`)
3. The recurring interval should be `month` for monthly subscriptions
4. To find/create these prices:
   - Go to Stripe Dashboard → Products → Create Product
   - Set up as "Recurring" pricing
   - Copy the Price ID (starts with `price_...`)
   - Set the corresponding environment variable

**Example:**
```bash
STRIPE_PRICE_ID_SUB_STARTER_EUR=price_1234567890abcdef
STRIPE_PRICE_ID_SUB_PRO_EUR=price_0987654321fedcba
```
- `STRIPE_WEBHOOK_SECRET` - Webhook signing secret from Stripe dashboard

Optional (for price ID mapping):
- `STRIPE_PRICE_ID_{PACKAGE_NAME}_{CURRENCY}` - Specific package price IDs
  - Example: `STRIPE_PRICE_ID_STARTER_EUR=price_123...`
  - Example: `STRIPE_PRICE_ID_STARTER_USD=price_456...`
- `STRIPE_PRICE_ID_{CURRENCY}` - Fallback price ID for currency
  - Example: `STRIPE_PRICE_ID_EUR=price_789...`
- `FRONTEND_URL` or `APP_URL` - Base URL for success/cancel redirects

## API Endpoints

### GET /api/billing/packages

List available packages with Stripe price IDs.

**Query Parameters:**
- `currency` (optional) - EUR or USD (default: EUR)

**Response:**
```json
[
  {
    "id": 1,
    "name": "Starter",
    "units": 1000,
    "priceCents": 999,
    "stripePriceId": "price_123...",
    "available": true,
    "stripePriceIdEur": "price_123...",
    "stripePriceIdUsd": "price_456..."
  }
]
```

### POST /api/billing/purchase

Create a Stripe checkout session for a package.

**Request Body:**
```json
{
  "packageId": 1,
  "currency": "EUR"
}
```

**Response:**
```json
{
  "ok": true,
  "purchase": {
    "id": 123,
    "status": "pending",
    "units": 1000,
    "currency": "EUR"
  },
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_test_..."
}
```

### GET /api/billing/purchases

List user's purchase history.

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `pageSize` (optional) - Items per page (default: 10, max: 100)

### GET /api/billing/purchase/:id/status

Check purchase status (useful after redirect from Stripe).

**Response:**
```json
{
  "id": 123,
  "status": "paid",
  "units": 1000,
  "currency": "EUR",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:01:00.000Z",
  "package": {
    "id": 1,
    "name": "Starter",
    "units": 1000
  }
}
```

### POST /webhooks/stripe

Stripe webhook endpoint (public, signature verified).

**Events Handled:**
- `checkout.session.completed` - Payment successful
- `payment_intent.succeeded` - Payment succeeded (backup)
- `payment_intent.payment_failed` - Payment failed

## Stripe Service

### `createCheckoutSession(params)`

Creates a Stripe checkout session with:
- Package metadata (ownerId, packageId, units, currency)
- Success/cancel URLs
- Customer email (if provided)

### `getStripePriceId(packageName, currency)`

Resolves Stripe price ID with priority:
1. Package database field (`stripePriceIdEur`/`stripePriceIdUsd`)
2. Environment variable (`STRIPE_PRICE_ID_{PACKAGE}_{CURRENCY}`)
3. Fallback environment variable (`STRIPE_PRICE_ID_{CURRENCY}`)
4. Returns `null` if not found

## Webhook Processing

### Security

- Webhook signature verification using `STRIPE_WEBHOOK_SECRET`
- All webhook events are persisted to `WebhookEvent` table for auditing

### Idempotency

- Purchase status is checked before processing
- If already `paid`, webhook is acknowledged but no action taken
- Prevents duplicate wallet credits

### Error Handling

- Webhooks always return 200 to prevent Stripe retries
- Errors are logged for manual investigation
- Failed payments update purchase status to `failed`

## Implementation Details

### Purchase Status Flow

1. **pending** - Created when checkout session is created
2. **paid** - Updated when webhook confirms payment
3. **failed** - Updated when payment fails

### Wallet Credit

When payment is confirmed:
1. Purchase status updated to `paid`
2. Wallet credited with package units
3. Credit transaction created with metadata:
   - Purchase ID
   - Package ID
   - Stripe session ID
   - Stripe payment intent ID
   - Currency

### Transaction Safety

- Purchase update and wallet credit are wrapped in a Prisma transaction
- Ensures atomicity: either both succeed or both fail

## Setup Instructions

### 1. Install Dependencies

```bash
cd apps/api
npm install
```

### 2. Run Database Migration

```bash
npm run prisma:migrate
npm run prisma:generate
```

### 3. Configure Stripe

1. Create products and prices in Stripe Dashboard
2. Set environment variables:
   ```bash
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_ID_STARTER_EUR=price_...
   STRIPE_PRICE_ID_STARTER_USD=price_...
   FRONTEND_URL=https://your-frontend.com
   ```

### 4. Configure Webhook in Stripe Dashboard

1. Go to Developers > Webhooks
2. Add endpoint: `https://your-api.com/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### 5. Test the Integration

1. Use Stripe test mode keys for development
2. Test checkout flow end-to-end
3. Verify webhook processing
4. Check wallet credits are applied correctly

## Testing

### Test Mode

Use Stripe test mode:
- Test secret key: `sk_test_...`
- Test webhook secret: `whsec_test_...`
- Test cards: https://stripe.com/docs/testing

### Manual Testing

1. Create a purchase:
   ```bash
   curl -X POST http://localhost:3001/api/billing/purchase \
     -H "Authorization: Bearer {token}" \
     -H "Content-Type: application/json" \
     -d '{"packageId": 1, "currency": "EUR"}'
   ```

2. Complete payment on Stripe checkout page

3. Check purchase status:
   ```bash
   curl http://localhost:3001/api/billing/purchase/123/status \
     -H "Authorization: Bearer {token}"
   ```

4. Verify wallet balance:
   ```bash
   curl http://localhost:3001/api/billing/balance \
     -H "Authorization: Bearer {token}"
   ```

## Error Scenarios

### Missing Price ID

If Stripe price ID is not found:
- Returns 400 error: "Stripe price ID not found for package {name} ({currency})"
- Check environment variables or package database fields

### Stripe Not Configured

If `STRIPE_SECRET_KEY` is not set:
- Returns 503 error: "Payment processing unavailable"
- Service gracefully degrades

### Webhook Signature Mismatch

If webhook signature verification fails:
- Returns 400 error
- Event is not processed
- Check `STRIPE_WEBHOOK_SECRET` configuration

## Security Considerations

1. **Webhook Verification**: All webhooks are signature-verified
2. **Metadata Validation**: Owner ID and package ID are validated
3. **Idempotency**: Prevents duplicate processing
4. **Transaction Safety**: Atomic operations prevent partial updates
5. **Error Logging**: All errors are logged for investigation

## Future Enhancements

- Subscription support (recurring payments)
- Invoice generation
- Refund handling
- Payment method management
- Customer portal integration

