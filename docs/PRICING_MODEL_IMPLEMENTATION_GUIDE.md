# Pricing Model Implementation Guide
## Technical, Flow, and Action-Based Documentation

**Version:** 1.0  
**Last Updated:** 2025-01-XX  
**Purpose:** Complete technical documentation for implementing the subscription + credit-based pricing model in retail-backend and porting it to shopify-backend.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [Core Services](#core-services)
4. [API Endpoints](#api-endpoints)
5. [Stripe Integration](#stripe-integration)
6. [Webhook Handlers](#webhook-handlers)
7. [Credit System](#credit-system)
8. [Subscription Management](#subscription-management)
9. [Implementation Flow](#implementation-flow)
10. [Migration Guide for Shopify Backend](#migration-guide-for-shopify-backend)
11. [Frontend Integration](#frontend-integration)
12. [Testing & Verification](#testing--verification)

---

## Architecture Overview

### Pricing Model Components

The pricing system consists of three main components:

1. **Subscriptions** - Recurring billing with included free credits
2. **Credit Top-ups** - Pay-as-you-go credit purchases
3. **Credit Packages** - Predefined credit bundles (subscription required)

### System Flow

```
User Action → Frontend → Backend API → Stripe Checkout
                                          ↓
                                    User Payment
                                          ↓
                                    Stripe Webhooks
                                          ↓
                                    Backend Processing
                                          ↓
                                    Credit Allocation
                                          ↓
                                    Database Update
```

### Key Principles

1. **Idempotency**: All operations are idempotent to handle webhook retries
2. **Atomicity**: Wallet operations use database transactions
3. **Credit Enforcement**: Credits are checked before SMS sending
4. **No Expiration**: Credits never expire
5. **Subscription Gating**: Credit packages require active subscription

---

## Database Schema

### Core Models

#### User/Shop Model (Retail: User, Shopify: Shop)

```prisma
model User {  // Retail: User, Shopify: Shop
  id                        Int/String
  // Subscription fields
  stripeCustomerId          String?
  stripeSubscriptionId      String?
  planType                  SubscriptionPlanType?  // 'starter' | 'pro'
  subscriptionStatus        SubscriptionStatus      // 'active' | 'inactive' | 'cancelled'
  lastFreeCreditsAllocatedAt DateTime?
  
  // Relations
  Wallet                    Wallet?
  CreditTransaction         CreditTransaction[]
  Purchase                  Purchase[]
}
```

#### Wallet Model

```prisma
model Wallet {
  id        Int/String   @id
  ownerId   Int/String   @unique  // Retail: userId, Shopify: shopId
  balance   Int          @default(0)  // credits balance
  updatedAt DateTime     @updatedAt
  
  transactions CreditTransaction[]
}
```

#### CreditTransaction Model

```prisma
model CreditTransaction {
  id           Int/String      @id
  ownerId      Int/String      // Retail: userId, Shopify: shopId
  type         CreditTxnType   // 'credit' | 'debit' | 'refund'
  amount       Int              // positive integer (credits)
  balanceAfter Int              // snapshot of wallet balance after this txn
  reason       String?          @db.VarChar(200)  // e.g., 'subscription:starter:cycle', 'stripe:topup'
  campaignId   Int/String?
  messageId    Int/String?
  meta         Json?            // invoiceId, sessionId, planType, etc.
  createdAt    DateTime         @default(now())
  walletId     Int/String?
  
  @@index([ownerId])
  @@index([campaignId])
  @@index([messageId])
  @@index([walletId])
  @@index([createdAt])
  @@index([reason])
  @@index([ownerId, reason])  // For idempotency checks
}
```

#### Package Model

```prisma
model Package {
  id         Int/String   @id
  name       String       @unique
  units      Int          // credits included
  priceCents Int          // price in cents (for reference)
  active     Boolean      @default(true)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
  Purchase   Purchase[]
  
  // Stripe price IDs (optional, can be set via env or admin)
  stripePriceIdEur String? @db.VarChar(255)
  stripePriceIdUsd String? @db.VarChar(255)
  
  @@index([stripePriceIdEur])
  @@index([stripePriceIdUsd])
}
```

#### Purchase Model

```prisma
model Purchase {
  id         Int/String      @id
  ownerId    Int/String      // Retail: userId, Shopify: shopId
  packageId  Int/String
  package    Package
  units      Int
  priceCents Int
  status     PaymentStatus   @default(pending)  // 'pending' | 'paid' | 'failed' | 'refunded'
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
  
  // Stripe integration
  stripeSessionId       String? @unique
  stripePaymentIntentId String?
  stripeCustomerId      String?
  stripePriceId         String?
  currency              String? @db.VarChar(3)
  
  @@index([ownerId])
  @@index([packageId])
  @@index([stripeSessionId])
  @@index([status])
  @@index([ownerId, status])
}
```

### Enums

```prisma
enum SubscriptionPlanType {
  starter
  pro
}

enum SubscriptionStatus {
  active
  inactive
  cancelled
}

enum CreditTxnType {
  credit  // e.g. admin topup, purchase, subscription credits
  debit   // e.g. campaign enqueue
  refund  // e.g. immediate provider hard-fail, stripe refund
}

enum PaymentStatus {
  pending
  paid
  failed
  refunded
}
```

---

## Core Services

### 1. Subscription Service

**Location:** `apps/api/src/services/subscription.service.js`

**Key Functions:**

```javascript
// Plan configuration
const PLANS = {
  starter: {
    priceEur: 40,        // €40/month
    freeCredits: 100,    // 100 credits/month
    stripePriceIdEnv: 'STRIPE_PRICE_ID_SUB_STARTER_EUR'
  },
  pro: {
    priceEur: 240,       // €240/year
    freeCredits: 500,    // 500 credits/year
    stripePriceIdEnv: 'STRIPE_PRICE_ID_SUB_PRO_EUR'
  }
};

// Credit pricing
const CREDIT_PRICE_EUR = 0.045; // Base price per credit
const VAT_RATE = 0.24; // 24% VAT

// Core functions
- getFreeCreditsForPlan(planType)
- getPlanConfig(planType)
- isSubscriptionActive(ownerId)
- getSubscriptionStatus(ownerId)
- allocateFreeCredits(ownerId, planType, invoiceId, stripeSubscription)
- activateSubscription(ownerId, stripeCustomerId, stripeSubscriptionId, planType)
- deactivateSubscription(ownerId, reason)
- calculateTopupPrice(credits)
- getBillingPeriodStart(stripeSubscription, now)
```

**Key Implementation Details:**

1. **Credit Allocation Idempotency:**
   - Checks `CreditTransaction` with `reason: 'subscription:{planType}:cycle'` and `meta.invoiceId`
   - Prevents duplicate allocations on webhook retries

2. **Billing Period Detection:**
   - Uses `stripeSubscription.current_period_start` if available
   - Falls back to `lastFreeCreditsAllocatedAt` for monthly billing
   - Prevents multiple allocations in the same billing period

3. **Subscription Activation:**
   - Validates plan type ('starter' or 'pro')
   - Updates all subscription fields atomically
   - Keeps historical data (planType, stripeCustomerId) on cancellation

### 2. Wallet Service

**Location:** `apps/api/src/services/wallet.service.js`

**Key Functions:**

```javascript
- ensureWallet(ownerId)  // Creates wallet if doesn't exist
- getBalance(ownerId)     // Returns current balance
- credit(ownerId, amount, opts, tx)   // Add credits
- debit(ownerId, amount, opts, tx)   // Consume credits (throws on insufficient)
- refund(ownerId, amount, opts, tx)  // Return credits
```

**Key Implementation Details:**

1. **Atomic Operations:**
   - All operations use `prisma.$transaction()` or accept `tx` parameter
   - Wallet balance and transaction records updated together
   - Prevents race conditions

2. **Insufficient Credits:**
   - `debit()` throws `INSUFFICIENT_CREDITS` error if balance would go negative
   - Error is caught by calling code (campaigns, SMS service)

3. **Transaction Records:**
   - Every operation creates a `CreditTransaction` record
   - Includes `balanceAfter` snapshot for audit trail
   - `reason` field describes the transaction purpose

### 3. Stripe Service

**Location:** `apps/api/src/services/stripe.service.js`

**Key Functions:**

```javascript
- getStripePriceId(packageName, currency, packageDb)
- getStripeSubscriptionPriceId(planType, currency)
- getStripeCreditTopupPriceId(currency)
- createCheckoutSession(params)  // For packages
- createSubscriptionCheckoutSession(params)  // For subscriptions
- createCreditTopupCheckoutSession(params)  // For top-ups
- getCheckoutSession(sessionId)
- updateSubscription(subscriptionId, planType)
- cancelSubscription(subscriptionId)
- getCustomerPortalUrl(params)
- verifyWebhookSignature(payload, signature)
```

**Key Implementation Details:**

1. **Price ID Resolution:**
   - Priority: Package DB field → Environment variable → null
   - Format: `STRIPE_PRICE_ID_{PACKAGE_NAME}_{CURRENCY}`

2. **Subscription Validation:**
   - Verifies price exists in Stripe
   - Validates price is recurring type
   - Returns clear error messages

3. **Webhook Security:**
   - All webhooks verified using `STRIPE_WEBHOOK_SECRET`
   - Invalid signatures rejected

---

## API Endpoints

### Subscription Endpoints

#### GET `/api/subscriptions/current`
Get current subscription status.

**Response:**
```json
{
  "active": true,
  "planType": "starter",
  "status": "active",
  "stripeCustomerId": "cus_xxx",
  "stripeSubscriptionId": "sub_xxx",
  "lastFreeCreditsAllocatedAt": "2025-01-01T00:00:00Z",
  "plan": {
    "priceEur": 40,
    "freeCredits": 100,
    "stripePriceIdEnv": "STRIPE_PRICE_ID_SUB_STARTER_EUR"
  }
}
```

#### POST `/api/subscriptions/subscribe`
Create subscription checkout session.

**Request:**
```json
{
  "planType": "starter" | "pro"
}
```

**Response:**
```json
{
  "ok": true,
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_xxx",
  "planType": "starter"
}
```

**Validation:**
- Plan type must be 'starter' or 'pro'
- User must not have active subscription
- Returns error if already subscribed

#### POST `/api/subscriptions/update`
Update subscription plan (upgrade/downgrade).

**Request:**
```json
{
  "planType": "starter" | "pro"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Subscription updated to starter plan successfully",
  "planType": "starter"
}
```

**Validation:**
- User must have active subscription
- Plan type must be different from current plan
- Idempotency check via Stripe metadata

#### POST `/api/subscriptions/cancel`
Cancel subscription.

**Response:**
```json
{
  "ok": true,
  "message": "Subscription cancelled successfully"
}
```

**Process:**
1. Cancels subscription in Stripe
2. Immediately updates local DB to 'cancelled'
3. Webhook handler also processes cancellation

#### GET `/api/subscriptions/portal`
Get Stripe Customer Portal URL.

**Response:**
```json
{
  "ok": true,
  "portalUrl": "https://billing.stripe.com/..."
}
```

### Billing Endpoints

#### GET `/api/billing/balance`
Get wallet balance and subscription status.

**Response:**
```json
{
  "balance": 500,
  "subscription": {
    "active": true,
    "planType": "starter",
    "status": "active"
  }
}
```

#### GET `/api/billing/transactions`
Get credit transaction history.

**Query Parameters:**
- `page` (default: 1)
- `pageSize` (default: 10, max: 100)

**Response:**
```json
{
  "page": 1,
  "pageSize": 10,
  "total": 50,
  "items": [...]
}
```

#### GET `/api/billing/packages`
List active credit packages (subscription required).

**Response:**
```json
[
  {
    "id": 1,
    "name": "Starter 500",
    "units": 500,
    "priceCents": 5000,
    "stripePriceId": "price_xxx",
    "available": true
  }
]
```

**Access Control:**
- Returns empty array if subscription is not active

#### POST `/api/billing/purchase`
Create checkout session for credit package.

**Request:**
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
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_xxx",
  "purchaseId": 123
}
```

**Validation:**
- Package must exist and be active
- User must have active subscription
- Creates `Purchase` record with status 'pending'

#### POST `/api/billing/topup`
Create checkout session for credit top-up.

**Request:**
```json
{
  "credits": 1000
}
```

**Response:**
```json
{
  "ok": true,
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_xxx",
  "credits": 1000,
  "priceEur": 55.80,
  "priceBreakdown": {
    "credits": 1000,
    "priceEur": 45.00,
    "vatAmount": 10.80,
    "priceEurWithVat": 55.80
  }
}
```

**Validation:**
- Credits must be positive integer
- Maximum: 1,000,000 credits per purchase
- Available to all users (subscription not required)

#### GET `/api/billing/topup/calculate`
Calculate price for given number of credits.

**Query Parameters:**
- `credits` (required)

**Response:**
```json
{
  "credits": 1000,
  "priceEur": 45.00,
  "vatAmount": 10.80,
  "priceEurWithVat": 55.80
}
```

---

## Stripe Integration

### Environment Variables

```bash
# Required
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Subscription Price IDs
STRIPE_PRICE_ID_SUB_STARTER_EUR=price_xxx
STRIPE_PRICE_ID_SUB_PRO_EUR=price_xxx

# Credit Top-up Price ID (optional)
STRIPE_PRICE_ID_CREDIT_TOPUP_EUR=price_xxx

# Package Price IDs (optional, can also be in DB)
STRIPE_PRICE_ID_{PACKAGE_NAME}_EUR=price_xxx
STRIPE_PRICE_ID_{PACKAGE_NAME}_USD=price_xxx
```

### Stripe Configuration

1. **Subscription Prices:**
   - Starter: Recurring monthly price (€40/month)
   - Pro: Recurring yearly price (€240/year)

2. **Credit Top-up:**
   - One-time payment
   - Price calculated dynamically (credits × €0.045 + 24% VAT)

3. **Credit Packages:**
   - One-time payment
   - Predefined prices in Stripe

### Webhook Endpoint

**URL:** `POST /api/stripe/webhooks`

**Required Events:**
- `checkout.session.completed`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `charge.refunded`
- `customer.subscription.deleted`
- `customer.subscription.updated`

---

## Webhook Handlers

### 1. checkout.session.completed

**Handler:** `handleCheckoutCompleted()`

**Process:**
1. Extract metadata: `type`, `ownerId`
2. Route based on `type`:
   - `'subscription'` → `handleCheckoutSessionCompletedForSubscription()`
   - `'credit_topup'` → `handleCheckoutSessionCompletedForTopup()`
   - Legacy: Package purchase → `handleCheckoutCompleted()` (package branch)

**Subscription Flow:**
1. Extract: `ownerId`, `planType`
2. Get subscription ID from session
3. Retrieve subscription from Stripe
4. Activate subscription in database
5. Allocate free credits (invoice ID: `sub_{subscriptionId}`)

**Top-up Flow:**
1. Extract: `ownerId`, `credits`, `priceEur`
2. Validate payment amount (fraud prevention)
3. Check idempotency (session ID)
4. Credit wallet atomically

**Package Flow:**
1. Extract: `ownerId`, `packageId`, `units`
2. Find `Purchase` record by session ID
3. Verify status is 'pending'
4. Credit wallet with package units
5. Update `Purchase.status = 'paid'`

### 2. invoice.payment_succeeded

**Handler:** `handleInvoicePaymentSucceeded()`

**Filtering:**
- Skip `billing_reason = 'subscription_create'` (handled by checkout.session.completed)
- Process only `billing_reason = 'subscription_cycle'` (recurring billing)

**Process:**
1. Extract: `subscriptionId`, `customerId`, `invoiceId`
2. Find user by `stripeCustomerId`
3. Verify `stripeSubscriptionId` matches
4. Verify `subscriptionStatus = 'active'`
5. Retrieve subscription from Stripe
6. Allocate free credits (idempotent, invoice ID: `invoice.id`)

### 3. invoice.payment_failed

**Handler:** `handleInvoicePaymentFailed()`

**Filtering:**
- Process only `billing_reason = 'subscription_cycle'` or `'subscription_update'`

**Process:**
1. Find user by `stripeCustomerId`
2. Verify `stripeSubscriptionId` matches
3. Retrieve subscription from Stripe
4. Update subscription status:
   - `past_due` or `unpaid` → `'inactive'`
   - `cancelled` → `'cancelled'`

### 4. charge.refunded

**Handler:** `handleChargeRefunded()`

**Process:**
1. Find `CreditTransaction` with `meta.paymentIntentId = charge.payment_intent`
2. Determine credits to deduct (from transaction `amount`)
3. Deduct credits from wallet (atomic)
4. Create refund transaction
5. If associated with `Purchase`, update `Purchase.status = 'refunded'`

### 5. customer.subscription.deleted

**Handler:** `handleSubscriptionDeleted()`

**Process:**
1. Find user by `stripeSubscriptionId`
2. Deactivate subscription: `subscriptionStatus = 'cancelled'`

### 6. customer.subscription.updated

**Handler:** `handleSubscriptionUpdated()`

**Process:**
1. Find user by `stripeSubscriptionId`
2. Extract `planType` from subscription metadata or price ID
3. Map Stripe status to local status:
   - `active` or `trialing` → `'active'`
   - `cancelled`, `unpaid`, `incomplete_expired` → `'cancelled'`
   - `past_due`, `incomplete`, `paused` → `'inactive'`
4. Update `subscriptionStatus` and/or `planType` if changed

---

## Credit System

### Credit Pricing

- **Base Price:** €0.045 per credit
- **VAT Rate:** 24% (Greece)
- **Final Price:** €0.0558 per credit (€0.045 × 1.24)

### Credit Consumption

- **Rule:** Each SMS message consumes exactly 1 credit
- **Enforcement:** Credits checked before SMS sending
- **Insufficient Credits:** Operation fails, returns error

### Credit Sources

1. **Subscription Free Credits:**
   - Starter: 100 credits/month
   - Pro: 500 credits/year
   - Allocated on billing cycle renewal

2. **Credit Top-ups:**
   - Custom amount (user specifies)
   - Available to all users
   - One-time payment

3. **Credit Packages:**
   - Predefined amounts
   - Requires active subscription
   - One-time payment

4. **Refunds:**
   - Credits deducted on refund
   - Creates refund transaction

### Credit Expiration

**Rule:** Credits never expire.

**Implementation:**
- No expiration logic in codebase
- Credits remain in wallet indefinitely

---

## Subscription Management

### Subscription Lifecycle

1. **Sign-up:** User creates account (no subscription)
2. **Subscribe:** User selects plan → Stripe Checkout → Webhook activates → Free credits allocated
3. **Renewal:** Stripe generates invoice → Webhook processes → Free credits allocated
4. **Update:** User changes plan → Stripe subscription updated → Local DB updated
5. **Cancel:** User cancels → Stripe subscription cancelled → Local DB updated to 'cancelled'

### Subscription Status

- **active:** Subscription is active, receiving free credits
- **inactive:** Subscription paused or payment failed
- **cancelled:** Subscription cancelled, no future credits

### Plan Changes

**Behavior:** Changing plans does not allocate free credits immediately.

**Reason:** Free credits are allocated only on billing cycle renewals.

**Note:** User must wait until next billing cycle to receive credits for new plan.

---

## Implementation Flow

### Complete User Journey

#### 1. User Signs Up
```
User Registration → Account Created → Wallet Created (balance = 0)
```

#### 2. User Subscribes
```
POST /api/subscriptions/subscribe
  → Create Stripe Checkout Session
  → Redirect to Stripe
  → User Completes Payment
  → Webhook: checkout.session.completed
    → Activate Subscription
    → Allocate Free Credits (100 or 500)
  → User Redirected to Success Page
```

#### 3. Subscription Renewal
```
Stripe Generates Invoice
  → Webhook: invoice.payment_succeeded
    → Verify Subscription Active
    → Allocate Free Credits (idempotent)
  → User Receives Credits
```

#### 4. User Purchases Credits
```
Option A: Credit Top-up
  POST /api/billing/topup
    → Calculate Price
    → Create Stripe Checkout Session
    → User Completes Payment
    → Webhook: checkout.session.completed
      → Credit Wallet
    → User Receives Credits

Option B: Credit Package
  GET /api/billing/packages (subscription required)
  POST /api/billing/purchase
    → Create Stripe Checkout Session
    → User Completes Payment
    → Webhook: checkout.session.completed
      → Credit Wallet
      → Update Purchase Status
    → User Receives Credits
```

#### 5. User Sends SMS
```
Campaign Enqueue / SMS Send
  → Check Wallet Balance
  → If Sufficient: Debit Credits → Send SMS
  → If Insufficient: Return Error → Block Send
```

#### 6. Payment Fails
```
Stripe Payment Fails
  → Webhook: invoice.payment_failed
    → Update Subscription Status to 'inactive'
  → User Can Update Payment Method
  → Stripe Retries Payment
```

#### 7. User Cancels
```
POST /api/subscriptions/cancel
  → Cancel Stripe Subscription
  → Update Local DB to 'cancelled'
  → User Retains Existing Credits
  → No Future Free Credits
```

---

## Migration Guide for Shopify Backend

### Current State Analysis

**Shopify Backend Already Has:**
- ✅ Subscription fields on `Shop` model
- ✅ `Wallet` model (with `balance` field)
- ✅ `CreditTransaction` model
- ✅ Subscription service (shopId-based)
- ✅ Basic webhook handlers

**Shopify Backend Missing:**
- ❌ `Package` model
- ❌ `Purchase` model
- ❌ Credit top-up functionality
- ❌ Complete webhook handlers
- ❌ Credit package purchase flow
- ❌ Billing API endpoints

### Migration Steps

#### Step 1: Database Schema Updates

**1.1 Add Package Model**

```prisma
model Package {
  id         String   @id @default(cuid())
  name       String   @unique
  units      Int      // credits included
  priceCents Int      // price in cents
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  Purchase   Purchase[]
  
  stripePriceIdEur String? @db.VarChar(255)
  stripePriceIdUsd String? @db.VarChar(255)
  
  @@index([stripePriceIdEur])
  @@index([stripePriceIdUsd])
}
```

**1.2 Add Purchase Model**

```prisma
model Purchase {
  id         String        @id @default(cuid())
  shopId     String
  packageId  String
  package    Package       @relation(fields: [packageId], references: [id], onDelete: Restrict)
  units      Int
  priceCents Int
  status     PaymentStatus @default(pending)
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt
  
  stripeSessionId       String? @unique
  stripePaymentIntentId String?
  stripeCustomerId      String?
  stripePriceId         String?
  currency              String? @db.VarChar(3)
  
  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)
  
  @@index([shopId])
  @@index([packageId])
  @@index([stripeSessionId])
  @@index([status])
  @@index([shopId, status])
}
```

**1.3 Add PaymentStatus Enum**

```prisma
enum PaymentStatus {
  pending
  paid
  failed
  refunded
}
```

**1.4 Update Shop Model**

Add relation:
```prisma
model Shop {
  // ... existing fields
  Purchase Purchase[]
}
```

**1.5 Run Migration**

```bash
npx prisma migrate dev --name add_packages_and_purchases
```

#### Step 2: Update Wallet Service

**2.1 Ensure shopId-based Implementation**

Update `services/wallet.js` to use `shopId` instead of `storeId`:

```javascript
// Change from:
exports.getBalance = async (storeId) => { ... }

// To:
exports.getBalance = async (shopId) => { ... }
```

**2.2 Verify Atomic Operations**

Ensure all wallet operations use transactions:
- `credit(shopId, amount, opts, tx)`
- `debit(shopId, amount, opts, tx)`
- `refund(shopId, amount, opts, tx)`

#### Step 3: Update Subscription Service

**3.1 Verify shopId-based Functions**

Ensure all functions use `shopId`:
- `isSubscriptionActive(shopId)`
- `getSubscriptionStatus(shopId)`
- `allocateFreeCredits(shopId, planType, invoiceId, stripeSubscription)`
- `activateSubscription(shopId, stripeCustomerId, stripeSubscriptionId, planType)`
- `deactivateSubscription(shopId, reason)`

**3.2 Add calculateTopupPrice Function**

```javascript
export function calculateTopupPrice(credits) {
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new Error('Invalid credits amount');
  }

  const basePrice = credits * CREDIT_PRICE_EUR;
  const vatAmount = basePrice * VAT_RATE;
  const totalPrice = basePrice + vatAmount;

  return {
    credits,
    priceEur: Number(basePrice.toFixed(2)),
    vatAmount: Number(vatAmount.toFixed(2)),
    priceEurWithVat: Number(totalPrice.toFixed(2)),
  };
}
```

#### Step 4: Update Stripe Service

**4.1 Add Credit Top-up Functions**

```javascript
// Add to services/stripe.js

export async function createCreditTopupCheckoutSession({
  shopId,
  shopEmail,
  credits,
  priceEur,
  currency = 'EUR',
  successUrl,
  cancelUrl
}) {
  // Implementation similar to retail-backend
  // Use shopId instead of ownerId
  // Calculate price dynamically
}
```

**4.2 Add Package Functions**

```javascript
export async function createPackageCheckoutSession({
  shopId,
  shopEmail,
  package: pkg,
  currency = 'EUR',
  successUrl,
  cancelUrl
}) {
  // Implementation similar to retail-backend
  // Use shopId instead of ownerId
}
```

#### Step 5: Create Billing Routes

**5.1 Create `routes/billing.js`**

Copy from retail-backend and adapt:
- Change `req.user.id` to `req.shop.id` (or however shop is accessed)
- Change `ownerId` to `shopId` in all functions
- Update error messages if needed

**Key Routes:**
- `GET /api/billing/balance`
- `GET /api/billing/transactions`
- `GET /api/billing/packages`
- `POST /api/billing/purchase`
- `POST /api/billing/topup`
- `GET /api/billing/topup/calculate`

#### Step 6: Update Webhook Handlers

**6.1 Update `controllers/stripe-webhooks.js`**

Add handlers for:
- `checkout.session.completed` (subscription, top-up, package)
- `invoice.payment_succeeded` (renewal)
- `invoice.payment_failed` (payment failure)
- `charge.refunded` (refunds)
- `customer.subscription.deleted` (cancellation)
- `customer.subscription.updated` (status sync)

**Key Changes:**
- Use `shopId` instead of `userId`
- Use `Shop` model instead of `User` model
- Update all database queries

#### Step 7: Update Subscription Routes

**7.1 Update `routes/subscriptions.js`**

Ensure all routes use `shopId`:
- `GET /api/subscriptions/current`
- `POST /api/subscriptions/subscribe`
- `POST /api/subscriptions/update`
- `POST /api/subscriptions/cancel`
- `GET /api/subscriptions/portal`

#### Step 8: Seed Packages

**8.1 Create Seed Script**

```javascript
// scripts/seed-packages.js
const packages = [
  { name: 'Starter 500', units: 500, priceCents: 5000 },
  { name: 'Professional 2000', units: 2000, priceCents: 20000 },
  // ... more packages
];

// Upsert packages
for (const pkg of packages) {
  await prisma.package.upsert({
    where: { name: pkg.name },
    update: pkg,
    create: pkg
  });
}
```

#### Step 9: Environment Variables

**9.1 Add Required Variables**

```bash
# Subscription Price IDs
STRIPE_PRICE_ID_SUB_STARTER_EUR=price_xxx
STRIPE_PRICE_ID_SUB_PRO_EUR=price_xxx

# Credit Top-up (optional)
STRIPE_PRICE_ID_CREDIT_TOPUP_EUR=price_xxx

# Package Price IDs (optional, can be in DB)
STRIPE_PRICE_ID_STARTER_500_EUR=price_xxx
STRIPE_PRICE_ID_PROFESSIONAL_2000_EUR=price_xxx
```

#### Step 10: Testing

**10.1 Test Subscription Flow**
1. Create subscription checkout session
2. Complete payment
3. Verify webhook processes correctly
4. Verify credits allocated

**10.2 Test Credit Top-up**
1. Create top-up checkout session
2. Complete payment
3. Verify webhook processes correctly
4. Verify credits added

**10.3 Test Credit Packages**
1. Verify packages only available with subscription
2. Create package purchase checkout session
3. Complete payment
4. Verify webhook processes correctly
5. Verify credits added

**10.4 Test Renewals**
1. Wait for billing cycle (or use Stripe test mode)
2. Verify webhook processes correctly
3. Verify credits allocated (idempotent)

**10.5 Test Failures**
1. Test payment failure handling
2. Test refund processing
3. Test cancellation

---

## Frontend Integration

### Required API Calls

#### 1. Get Subscription Status

```typescript
const response = await fetch('/api/subscriptions/current', {
  headers: { Authorization: `Bearer ${token}` }
});
const { active, planType, status, plan } = await response.json();
```

#### 2. Subscribe to Plan

```typescript
const response = await fetch('/api/subscriptions/subscribe', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ planType: 'starter' })
});
const { checkoutUrl } = await response.json();
window.location.href = checkoutUrl;
```

#### 3. Get Credit Packages

```typescript
const response = await fetch('/api/billing/packages', {
  headers: { Authorization: `Bearer ${token}` }
});
const packages = await response.json();
// Returns empty array if subscription not active
```

#### 4. Purchase Credit Package

```typescript
const response = await fetch('/api/billing/purchase', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ packageId: 1, currency: 'EUR' })
});
const { checkoutUrl } = await response.json();
window.location.href = checkoutUrl;
```

#### 5. Credit Top-up

```typescript
// Calculate price
const calcResponse = await fetch(
  `/api/billing/topup/calculate?credits=1000`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const price = await calcResponse.json();

// Create checkout
const response = await fetch('/api/billing/topup', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ credits: 1000 })
});
const { checkoutUrl } = await response.json();
window.location.href = checkoutUrl;
```

#### 6. Get Balance

```typescript
const response = await fetch('/api/billing/balance', {
  headers: { Authorization: `Bearer ${token}` }
});
const { balance, subscription } = await response.json();
```

### Frontend Components

#### Subscription Card Component

```typescript
// Features:
// - Display current subscription status
// - Show plan details (price, credits)
// - Subscribe button (if not subscribed)
// - Manage/Cancel buttons (if subscribed)
// - Link to Stripe Customer Portal
```

#### Credit Packages Component

```typescript
// Features:
// - Display available packages (only if subscribed)
// - Show package details (credits, price)
// - Purchase button
// - Popular badge
```

#### Credit Top-up Component

```typescript
// Features:
// - Credit amount input
// - Price calculator
// - Price breakdown (base, VAT, total)
// - Purchase button
// - Available to all users
```

#### Balance Display Component

```typescript
// Features:
// - Current balance
// - Subscription status
// - Recent transactions link
```

---

## Testing & Verification

### Manual Testing Checklist

#### Subscription Flow
- [ ] User can subscribe to Starter plan
- [ ] User can subscribe to Pro plan
- [ ] Webhook processes subscription correctly
- [ ] Free credits allocated on subscription
- [ ] User cannot subscribe if already subscribed
- [ ] Subscription status displayed correctly

#### Renewal Flow
- [ ] Renewal invoice processed correctly
- [ ] Free credits allocated on renewal
- [ ] Idempotency prevents duplicate allocations
- [ ] Billing period detection works correctly

#### Credit Top-up Flow
- [ ] User can calculate top-up price
- [ ] User can purchase top-up
- [ ] Webhook processes top-up correctly
- [ ] Credits added to wallet
- [ ] Idempotency prevents duplicate credits

#### Credit Packages Flow
- [ ] Packages only visible with subscription
- [ ] User can purchase package
- [ ] Webhook processes package correctly
- [ ] Credits added to wallet
- [ ] Purchase status updated

#### Payment Failures
- [ ] Payment failure updates subscription status
- [ ] User can update payment method
- [ ] Stripe retries payment correctly

#### Cancellation
- [ ] User can cancel subscription
- [ ] Subscription status updated to 'cancelled'
- [ ] Existing credits retained
- [ ] No future free credits allocated

### Automated Testing

#### Unit Tests

```javascript
// Test subscription service
describe('Subscription Service', () => {
  test('getFreeCreditsForPlan returns correct credits', () => {
    expect(getFreeCreditsForPlan('starter')).toBe(100);
    expect(getFreeCreditsForPlan('pro')).toBe(500);
  });

  test('calculateTopupPrice calculates correctly', () => {
    const result = calculateTopupPrice(1000);
    expect(result.priceEur).toBe(45.00);
    expect(result.vatAmount).toBe(10.80);
    expect(result.priceEurWithVat).toBe(55.80);
  });
});
```

#### Integration Tests

```javascript
// Test subscription flow
describe('Subscription Flow', () => {
  test('complete subscription flow', async () => {
    // 1. Create subscription checkout
    // 2. Simulate webhook
    // 3. Verify subscription active
    // 4. Verify credits allocated
  });
});
```

### Webhook Testing

Use Stripe CLI for local webhook testing:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhooks
stripe trigger checkout.session.completed
stripe trigger invoice.payment_succeeded
```

---

## Critical Implementation Notes

### 1. Idempotency

**Always check for existing transactions before processing:**
- Subscription credits: Check `CreditTransaction` with `reason` and `meta.invoiceId`
- Top-ups: Check `CreditTransaction` with `reason: 'stripe:topup'` and `meta.sessionId`
- Packages: Check `Purchase.status = 'paid'`

### 2. Atomic Operations

**Always use transactions for wallet operations:**
- Wallet balance and transaction records updated together
- Prevents race conditions
- Ensures consistency

### 3. Error Handling

**Retryable Errors (return 500):**
- Database connection issues
- Network timeouts
- Temporary service unavailability

**Non-retryable Errors (return 200):**
- Validation errors
- Business logic errors
- Data not found

### 4. Webhook Ordering

**Handle race conditions:**
- `checkout.session.completed` handles first allocation
- `invoice.payment_succeeded` skips `subscription_create` invoices
- Only process `subscription_cycle` invoices for renewals

### 5. Credit Enforcement

**Always check balance before SMS sending:**
- Campaign enqueue: Check total credits needed
- SMS sending: Check balance before each message
- Return clear error if insufficient

---

## Summary

This document provides a complete technical guide for implementing the subscription + credit-based pricing model. The system is designed to be:

- **Idempotent:** Handles webhook retries safely
- **Atomic:** Ensures data consistency
- **Scalable:** Supports multiple pricing models
- **Secure:** Validates all payments and webhooks
- **Auditable:** Complete transaction history

The migration guide for Shopify backend provides step-by-step instructions for porting the retail-backend implementation, with key differences being:
- `shopId` instead of `userId`
- `Shop` model instead of `User` model
- Shopify-specific authentication middleware

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-XX  
**Maintained By:** Development Team

