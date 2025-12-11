# Message Sending Guide - Retail App

## Overview

This document provides comprehensive documentation for all SMS message sending functionalities in the Retail app. The system supports three main sending methods: **Campaign Messages** (bulk), **Automation Messages** (individual), and **Single Test Messages** (individual).

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Campaign Messages (Bulk)](#campaign-messages-bulk)
3. [Automation Messages (Individual)](#automation-messages-individual)
4. [Single Test Messages](#single-test-messages)
5. [Mitto API Integration](#mitto-api-integration)
6. [Rate Limiting](#rate-limiting)
7. [Credit Management](#credit-management)
8. [Status Tracking](#status-tracking)
9. [Error Handling](#error-handling)
10. [Configuration](#configuration)

---

## Architecture Overview

### Message Sending Methods

```
┌─────────────────────────────────────────────────────────┐
│              Message Sending Methods                     │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Campaigns   │  │ Automations  │  │ Test/Single  │
│   (Bulk)     │  │ (Individual) │  │ (Individual) │
└──────────────┘  └──────────────┘  └──────────────┘
        │                 │                 │
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Queue+Worker │  │ Direct Send  │  │ Direct Send  │
│   (Async)    │  │  (Sync)      │  │  (Sync)      │
└──────────────┘  └──────────────┘  └──────────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │   Mitto API Service   │
              │  - sendBulkMessages() │
              │  - sendSingle()       │
              └──────────────────────┘
```

### Service Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Service Layers                        │
└─────────────────────────────────────────────────────────┘

1. Application Services (Business Logic)
   ├── campaignEnqueue.service.js    (Campaign enqueue)
   ├── automation.service.js          (Automation triggers)
   └── sms.service.js                 (Single messages)

2. SMS Services (Credit & Validation)
   ├── smsBulk.service.js            (Bulk with credits)
   └── sms.service.js                 (Single with credits)

3. Mitto Service (API Integration)
   └── mitto.service.js
       ├── sendBulkMessages()         (New bulk endpoint)
       ├── sendSingle()               (Single endpoint)
       └── sendBulkStatic()           (Legacy bulk - deprecated)

4. Infrastructure
   ├── rateLimiter.service.js        (Rate limiting)
   ├── wallet.service.js             (Credit management)
   └── statusRefresh.service.js      (Status updates)
```

---

## Campaign Messages (Bulk)

### Overview

Campaign messages are sent in bulk using Mitto's bulk messaging endpoint. This is the **primary method** for sending marketing campaigns to multiple recipients.

### Features

- ✅ **Bulk Sending**: Multiple messages in a single API call via Mitto's bulk endpoint
- ✅ **Queue-Based**: Asynchronous processing via Redis/BullMQ
- ✅ **Scalable**: Handles campaigns from hundreds to millions of messages
- ✅ **Fixed Batching**: Simple, predictable fixed batch size (default: 5000)
- ✅ **Rate Limited**: Per-traffic-account and per-tenant rate limiting (implemented)
- ✅ **Idempotent**: Multiple layers prevent duplicate sends
- ✅ **Trackable**: Stores `bulkId` and per-message `messageId`
- ✅ **Always Bulk**: Campaigns always use bulk endpoint (no fallback to individual sends)

### Flow

```
1. User clicks "Send Campaign" in UI
   ↓
2. API: POST /api/campaigns/:id/enqueue
   ↓
3. Campaign Enqueue Service
   - Validates campaign, subscription, credits
   - Builds audience (contacts)
   - Creates CampaignMessage records (status='queued')
   - Groups messages into fixed-size batches (default: 5000 per batch)
   ↓
4. Enqueue batch jobs to Redis Queue
   ↓
5. Worker picks up batch job
   ↓
6. Process batch:
   - Fetch messages from database
   - Prepare messages (resolve senders, append links)
   - Check rate limits
   - Call Mitto bulk endpoint
   ↓
7. Update database:
   - Store bulkId on all messages
   - Store messageId per message
   - Update status: 'sent' or 'failed'
   - Debit credits (only for successful sends)
   ↓
8. Update campaign aggregates
   ↓
9. Webhook updates status (DLR)
```

### Implementation

**Service**: `apps/api/src/services/campaignEnqueue.service.js`

**Function**: `enqueueCampaign(campaignId)`

**Key Features**:
- Audience building (segmentation filters)
- Message creation with tracking IDs
- Batch grouping (fixed batch size: SMS_BATCH_SIZE)
- Job enqueueing to Redis (always bulk jobs)

**Worker**: `apps/worker/src/sms.worker.js`

**Function**: `processBatchJob(campaignId, ownerId, messageIds, job)`

**Key Features**:
- Idempotency checks (only process unsent messages)
- Message preparation (unsubscribe links, offer links)
- Bulk sending via `sendBulkSMSWithCredits()`
- Status updates and credit debiting

### Batch Sizing

**Fixed Batch Size**:
- All campaigns use a single, fixed batch size
- Mitto's bulk API can handle 1M+ messages per request, so we use a simple fixed batch size to protect our infrastructure
- Default: 5000 messages per batch
- This keeps logic simple, predictable, and easy to monitor

**Configuration**:
```bash
SMS_BATCH_SIZE=5000  # Fixed batch size for all campaigns
```

**How It Works**:
- Campaign with 50,000 messages = 10 batches of 5,000
- Each batch is processed as a separate job
- Simple, predictable, and easy to monitor

### API Endpoints

**Enqueue Campaign**:
```http
POST /api/campaigns/:id/enqueue
Authorization: Bearer <token>

Response:
{
  "queued": 500,
  "enqueuedJobs": 3
}
```

**Get Campaign Status**:
```http
GET /api/campaigns/:id/status
Authorization: Bearer <token>

Response:
{
  "campaign": {
    "id": 1,
    "name": "Summer Sale",
    "status": "sending",
    "total": 500,
    "sent": 350,
    "failed": 10
  },
  "metrics": {
    "queued": 140,
    "success": 350,      // Successfully sent messages (status='sent') - Phase 2.2
    "processed": 360,    // Processed messages (success + failed) - Phase 2.2
    "failed": 10         // Failed messages (status='failed') - Phase 2.2
  }
}
```

**Refresh Status**:
```http
POST /api/campaigns/:id/refresh-status
Authorization: Bearer <token>

Response:
{
  "refreshed": 500,
  "updated": 25,
  "errors": 0
}
```

### Database Schema

**CampaignMessage**:
```prisma
model CampaignMessage {
  id                Int       @id
  ownerId           Int
  campaignId        Int
  contactId         Int
  to                String
  text              String   @db.Text
  
  // Tracking
  trackingId        String   @unique
  
  // Status
  status            MessageStatus  // 'queued' | 'sent' | 'failed'
  
  // Mitto Integration
  providerMessageId String?   // Individual messageId from Mitto
  bulkId            String?   // Batch identifier from Mitto
  
  // Error Handling
  error             String?
  retryCount        Int      @default(0)
  
  // Timestamps
  createdAt         DateTime
  sentAt            DateTime?
  failedAt          DateTime?
}
```

### Status Transitions

```
queued → sent      (on successful send)
queued → failed    (on non-retryable error)
queued → queued    (on retryable error, for retry)
```

### Idempotency

**Multiple Layers**:
1. **Database-Level**: Only process messages with `status='queued'` and `providerMessageId=null`
2. **Job-Level**: Unique job IDs prevent duplicate jobs
3. **Retry Safety**: Only update queued messages on retry

### Rate Limiting

**Implemented Rate Limits**:
- ✅ **Per-Traffic-Account**: 100 requests/second (default) - **IMPLEMENTED**
- ✅ **Per-Tenant**: 50 requests/second (default) - **IMPLEMENTED**
- ✅ **Global Queue**: Configurable via BullMQ queue settings - **IMPLEMENTED**
- Both per-traffic-account and per-tenant limits must pass for request to proceed

**Configuration**:
```bash
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100  # Requests per second per traffic account
RATE_LIMIT_TENANT_MAX=50            # Requests per second per tenant
QUEUE_RATE_MAX=50                   # Global queue rate limit
```

**Implementation**:
- Rate limiting is implemented in `rateLimiter.service.js`
- Automatically checked before sending in `smsBulk.service.js`
- Uses Redis for distributed rate limiting across multiple workers
- Fail-open: If Redis is unavailable, requests are allowed (prevents blocking)

**Rate Limit Error Handling (Phase 2.1)**:
- ✅ **Retryable**: Rate limit errors (`rate_limit_exceeded`) are treated as retryable
- ✅ **Exponential Backoff**: Automatic retry with exponential backoff (3s, 6s, 12s, 24s, 48s)
- ✅ **Max Attempts**: Configurable via `QUEUE_ATTEMPTS` (default: 5 attempts)
- ✅ **Behavior**: When rate limit is exceeded, the batch job is retried after backoff delay
- ✅ **Final Failure**: After max attempts, messages are marked as `failed` with `reason: 'rate_limit_exceeded'`
- **Rationale**: Short-term rate limit spikes are automatically handled, preventing permanent failures from temporary conditions

---

## Automation Messages (Individual)

### Overview

Automation messages are triggered automatically based on events (welcome messages, birthday messages). They are sent **individually** (one message per API call) and processed **synchronously**.

### Types

1. **Welcome Messages**: Sent when a new contact is added
2. **Birthday Messages**: Sent on a contact's birthday (daily batch processing)

### Features

- ✅ **Event-Driven**: Automatically triggered by system events
- ✅ **Individual Sending**: One message per API call
- ✅ **Direct Send**: No queue, processed synchronously
- ✅ **Personalized**: Supports merge tags (`{{first_name}}`, `{{last_name}}`)
- ✅ **Unsubscribe Links**: Automatically appended

### Flow

```
1. Event Trigger
   - Welcome: New contact added
   - Birthday: Daily scheduled job
   ↓
2. Automation Service
   - Check if automation is active
   - Find eligible contacts
   - Render message template
   ↓
3. Send SMS
   - Call sendSMSWithCredits()
   - Check subscription & credits
   - Send via Mitto single endpoint
   ↓
4. Create AutomationMessage Record
   - Store message details
   - Track status (sent/failed)
   ↓
5. Update Credits
   - Debit credits on success
```

### Implementation

**Service**: `apps/api/src/services/automation.service.js`

**Functions**:
- `triggerWelcomeAutomation(ownerId, contact)` - Welcome message
- `processBirthdayAutomations()` - Birthday messages (batch)

**Sending Method**: `sendSMSWithCredits()` from `sms.service.js`

### Welcome Messages

**Trigger**: When a new contact is added

**Function**: `triggerWelcomeAutomation(ownerId, contact)`

**Process**:
1. Get or create welcome automation
2. Check if automation is active
3. Render message with merge tags
4. Send via `sendSMSWithCredits()`
5. Create `AutomationMessage` record

**Example Message**:
```
Hi {{first_name}}, welcome to our community! 🎉

To unsubscribe, tap: https://astronote-retail-frontend.onrender.com/retail/unsubscribe/{token}
```

### Birthday Messages

**Trigger**: Daily scheduled job (cron)

**Function**: `processBirthdayAutomations()`

**Process**:
1. Find all active birthday automations
2. Find contacts with birthday today
3. For each contact:
   - Render message with merge tags
   - Send via `sendSMSWithCredits()`
   - Create `AutomationMessage` record

**Example Message**:
```
Happy Birthday {{first_name}}! 🎂 We hope you have a wonderful day!

To unsubscribe, tap: https://astronote-retail-frontend.onrender.com/retail/unsubscribe/{token}
```

### API Endpoints

**Get Automations**:
```http
GET /api/automations
Authorization: Bearer <token>

Response:
{
  "welcome": {
    "id": 1,
    "type": "welcome_message",
    "isActive": true,
    "messageBody": "Hi {{first_name}}, welcome! 🎉"
  },
  "birthday": {
    "id": 2,
    "type": "birthday_message",
    "isActive": true,
    "messageBody": "Happy Birthday {{first_name}}! 🎂"
  }
}
```

**Update Automation**:
```http
PUT /api/automations/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "isActive": true,
  "messageBody": "Hi {{first_name}}, welcome to our store! 🎉"
}
```

### Database Schema

**Automation**:
```prisma
model Automation {
  id          Int       @id
  ownerId     Int
  type        AutomationType  // 'welcome_message' | 'birthday_message'
  isActive    Boolean   @default(false)
  messageBody String    @db.Text
}

model AutomationMessage {
  id                Int       @id
  ownerId           Int
  automationId      Int
  contactId         Int
  to                String
  text              String     @db.Text
  trackingId        String     @unique
  status            MessageStatus
  providerMessageId String?
  error             String?
  sentAt            DateTime?
  failedAt          DateTime?
}
```

### Merge Tags

Supported merge tags:
- `{{first_name}}` - Contact's first name
- `{{last_name}}` - Contact's last name

**Example**:
```
Hi {{first_name}}, welcome to our community! 🎉
```

Renders to:
```
Hi John, welcome to our community! 🎉
```

---

## Single Test Messages

### Overview

Single test messages are used for testing and one-off sends. They are sent **individually** (one message per API call) and processed **synchronously**.

### Features

- ✅ **Direct Send**: No queue, immediate processing
- ✅ **Simple**: Single API call
- ✅ **Testing**: Useful for testing message content
- ✅ **Credit Enforcement**: Checks subscription and credits

### Implementation

**Service**: `apps/api/src/services/sms.service.js`

**Function**: `sendSMSWithCredits({ ownerId, destination, text, sender, meta, contactId })`

**Process**:
1. Check subscription status
2. Check credit balance
3. Append unsubscribe link (if contactId provided)
4. Send via `sendSingle()` from `mitto.service.js`
5. Debit credits on success

### Usage

**Direct Call**:
```javascript
const { sendSMSWithCredits } = require('./services/sms.service');

const result = await sendSMSWithCredits({
  ownerId: 1,
  destination: '+306984303406',
  text: 'Test message',
  meta: { reason: 'test:send' }
});

if (result.sent) {
  console.log('Message sent:', result.messageId);
} else {
  console.error('Send failed:', result.error);
}
```

### Response Format

```javascript
{
  sent: true,
  messageId: "01KAY04MQR6AEV0PNJYGZW8JEW",
  providerMessageId: "01KAY04MQR6AEV0PNJYGZW8JEW",
  trafficAccountId: "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
  balanceAfter: 99
}
```

Or on failure:
```javascript
{
  sent: false,
  reason: 'insufficient_credits',
  balance: 0,
  error: 'Not enough credits to send SMS. Please purchase credits.'
}
```

---

## Mitto API Integration

### Endpoints

#### 1. Bulk Messages (New - Primary)

**Endpoint**: `POST /api/v1.1/Messages/sendmessagesbulk`

**Service**: `apps/api/src/services/mitto.service.js`

**Function**: `sendBulkMessages(messages)`

**Request**:
```json
{
  "messages": [
    {
      "trafficAccountId": "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
      "destination": "+306984303406",
      "sms": {
        "text": "Hi, test msg.",
        "sender": "Sendly"
      }
    }
  ]
}
```

**Response**:
```json
{
  "bulkId": "5998ea4a-2403-48d4-b230-998fd4dd63f2",
  "messages": [
    {
      "trafficAccountId": "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
      "messageId": "01KC69MT19BRK5MSXG1V95YPHX"
    }
  ]
}
```

**Usage**: Campaign messages (bulk sending)

#### 2. Single Messages

**Endpoint**: `POST /api/v1.1/Messages/send`

**Service**: `apps/api/src/services/mitto.service.js`

**Function**: `sendSingle({ userId, destination, text, sender, trafficAccountId })`

**Request**:
```json
{
  "trafficAccountId": "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
  "destination": "+306984303406",
  "sms": {
    "text": "Hi, test msg.",
    "sender": "Sendly"
  }
}
```

**Response**:
```json
{
  "messages": [
    {
      "trafficAccountId": "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
      "messageId": "01KC69MT19BRK5MSXG1V95YPHX"
    }
  ]
}
```

**Usage**: Automation messages, test messages

#### 3. Get Message Status

**Endpoint**: `GET /api/v1.1/Messages/{messageId}`

**Service**: `apps/api/src/services/mitto.service.js`

**Function**: `getMessageStatus(messageId)`

**Response**:
```json
{
  "messageId": "01KC69MT19BRK5MSXG1V95YPHX",
  "text": "Hi, test msg.",
  "sender": {
    "id": "82b05498-2dc7-4f44-9b94-778a8fad3494",
    "name": "Mitto - Repath SMS"
  },
  "deliveryStatus": "Delivered",
  "messageParts": 1,
  "createdAt": "2025-12-11T08:50:04.5000993Z",
  "updatedAt": "2025-12-11T08:50:10.4140965Z",
  "trafficAccountId": "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7"
}
```

**Usage**: Status refresh, detailed metrics

### Authentication

**Header**: `X-Mitto-API-Key: {{MITTO_API_KEY}}`

**Configuration**:
```bash
MITTO_API_KEY=your-api-key
SMS_TRAFFIC_ACCOUNT_ID=your-traffic-account-id
MITTO_API_BASE=https://messaging.mittoapi.com
MITTO_SENDER=YourSenderName
```

### Sender Resolution

**Priority Order**:
1. Override sender (if provided)
2. User's `senderName` (from database)
3. Environment variable `MITTO_SENDER`
4. Error if none found

---

## Rate Limiting

### Overview

Rate limiting prevents overwhelming the Mitto API and ensures fair resource distribution across tenants.

### Types

#### 1. Per-Traffic-Account Limiting

**Purpose**: Respect Mitto's rate limits per traffic account

**Default**: 100 requests/second per traffic account

**Configuration**:
```bash
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100
RATE_LIMIT_TRAFFIC_ACCOUNT_WINDOW_MS=1000
```

#### 2. Per-Tenant Limiting

**Purpose**: Prevent one tenant from consuming all capacity

**Default**: 50 requests/second per tenant

**Configuration**:
```bash
RATE_LIMIT_TENANT_MAX=50
RATE_LIMIT_TENANT_WINDOW_MS=1000
```

#### 3. Global Queue Limiting

**Purpose**: Prevent queue overload

**Default**: 50 jobs/second

**Configuration**:
```bash
QUEUE_RATE_MAX=50
QUEUE_RATE_DURATION_MS=1000
```

### Implementation

**Service**: `apps/api/src/services/rateLimiter.service.js`

**Functions**:
- `checkTrafficAccountLimit(trafficAccountId)` - Check traffic account limit
- `checkTenantLimit(ownerId)` - Check tenant limit
- `checkAllLimits(trafficAccountId, ownerId)` - Check both limits

**Integration**: Automatically checked in `smsBulk.service.js` before sending

### Behavior

- **Fail-Open**: If Redis is unavailable, requests are allowed (prevents blocking)
- **Sliding Window**: Uses Redis counters with expiration
- **Distributed**: Works across multiple worker instances

---

## Credit Management

### Overview

Credits are debited **only after successful send** (when `messageId` is received from Mitto). This ensures users are only charged for messages that were actually sent.

### Credit Flow

```
1. Check Subscription
   ↓ (if inactive, block send)
2. Check Balance
   ↓ (if insufficient, block send)
3. Send Message
   ↓ (if successful, get messageId)
4. Debit Credits
   ↓ (only if messageId received)
5. Update Balance
```

### Credit Debit

**Campaign Messages**:
- Credits debited per message after successful send
- Partial failures: Only successful messages debit credits
- Failed messages: No credits debited

**Automation Messages**:
- Credits debited after successful send
- Failed sends: No credits debited

**Single Messages**:
- Credits debited after successful send
- Failed sends: No credits debited

### Credit Transaction Records

**Campaign Messages**:
```javascript
{
  reason: 'sms:send:campaign:123',
  campaignId: 123,
  messageId: 456,
  meta: {
    providerMessageId: '01KC69MT19BRK5MSXG1V95YPHX',
    bulkId: '5998ea4a-2403-48d4-b230-998fd4dd63f2'
  }
}
```

**Automation Messages**:
```javascript
{
  reason: 'automation:welcome',
  meta: {
    automationType: 'welcome_message',
    automationId: 1
  }
}
```

---

## Status Tracking

### Status Types

**Message Status**:
- `queued` - Message is queued for sending
- `sent` - Message was successfully sent (includes "Delivered" from Mitto)
- `failed` - Message failed to send

**Campaign Status**:
- `draft` - Campaign is a draft
- `scheduled` - Campaign is scheduled for future send
- `sending` - Campaign is currently being sent
- `paused` - Campaign is paused
- `completed` - All messages have been processed
- `failed` - Campaign failed

### Status Updates

#### 1. Webhooks (DLR)

**Endpoint**: `POST /webhooks/mitto/dlr`

**Process**:
- Mitto sends delivery status updates
- Webhook handler updates `CampaignMessage` status
- Campaign aggregates updated automatically

**Status Mapping**:
- `Delivered` → `sent`
- `Sent` → `sent`
- `Failure` → `failed`

#### 2. Status Refresh

**Manual Refresh**:
```http
POST /api/campaigns/:id/refresh-status
```

**Bulk Refresh**:
```http
POST /api/mitto/refresh-status-bulk
```

**Process**:
- Fetches status from Mitto for each message
- Updates database records
- Updates campaign aggregates

#### 3. Per-Message Status

**Endpoint**: `GET /api/mitto/message/:messageId`

**Returns**: Detailed message information from Mitto

### Campaign Aggregates (Phase 2.2)

**Service**: `apps/api/src/services/campaignAggregates.service.js`

**Function**: `updateCampaignAggregates(campaignId, ownerId)`

**Updates**:
- `total` - Total messages in campaign
- `sent` - Successfully sent messages (status='sent' only) - **Phase 2.2: Clear semantics**
- `processed` - Processed messages (sent + failed) - **Phase 2.2: New field**
- `failed` - Failed messages (status='failed')
- `status` - Campaign status (sending → completed when all processed)

**Metrics Calculation (Phase 2.2)**:
- `success` = count of messages with `status='sent'` (successfully sent)
- `failed` = count of messages with `status='failed'` (failed to send)
- `processed` = `success + failed` (all processed messages)
- `queued` = count of messages with `status='queued'` (pending)

**API Response** (`GET /api/campaigns/:id/status`):
```json
{
  "campaign": {
    "id": 1,
    "total": 500,
    "sent": 350,        // Successfully sent (status='sent')
    "processed": 360,   // Processed (sent + failed)
    "failed": 10        // Failed (status='failed')
  },
  "metrics": {
    "queued": 140,
    "success": 350,     // Successfully sent messages
    "processed": 360,   // Processed messages (success + failed)
    "failed": 10        // Failed messages
  }
}
```

**UI Labels** (Recommended):
- **"Total"**: Total messages in campaign
- **"Queued"**: Messages waiting to be sent
- **"Success"** or **"Sent"**: Successfully sent messages (status='sent')
- **"Processed"**: Total processed messages (success + failed)
- **"Failed"**: Failed messages (status='failed')

---

## Error Handling

### Error Types

#### 1. Subscription Errors

**Code**: `INACTIVE_SUBSCRIPTION`

**Message**: "Active subscription required to send SMS. Please subscribe to a plan."

**Handling**: Block send, return error immediately

#### 2. Credit Errors

**Code**: `INSUFFICIENT_CREDITS`

**Message**: "Not enough credits to send SMS. Please purchase credits."

**Handling**: Block send, return error immediately

#### 3. Rate Limit Errors (Phase 2.1)

**Code**: `RATE_LIMIT_EXCEEDED`

**Message**: "Rate limit exceeded. Will retry after backoff."

**Handling**: 
- ✅ **Retryable**: Rate limit errors are treated as retryable (transient condition)
- ✅ **Automatic Retry**: Worker automatically retries with exponential backoff
- ✅ **Backoff Strategy**: 3s, 6s, 12s, 24s, 48s (configurable via `QUEUE_BACKOFF_MS`)
- ✅ **Max Attempts**: 5 attempts (configurable via `QUEUE_ATTEMPTS`)
- ✅ **Final Failure**: After max attempts, messages marked as `failed` with `reason: 'rate_limit_exceeded'`
- **Rationale**: Short-term rate limit spikes are automatically handled, preventing permanent failures

#### 4. Send Errors

**Retryable**:
- Network errors (no status code)
- Server errors (5xx)
- Rate limiting (429)

**Non-Retryable**:
- Client errors (4xx, except 429)
- Invalid phone numbers
- Invalid message content

### Retry Logic

**Campaign Messages**:
- Max 5 retry attempts
- Exponential backoff: 3s, 6s, 12s, 24s, 48s
- Only retryable errors trigger retries

**Automation Messages**:
- No automatic retries (one-time sends)
- Failed messages logged for manual review

### Error Logging

**Structured Logging**:
```javascript
logger.error({
  campaignId: 123,
  ownerId: 1,
  batchId: 'batch-456',
  error: err.message,
  retryable: true
}, 'Batch send failed');
```

---

## Configuration

### Environment Variables

#### Required

```bash
# Mitto API
MITTO_API_KEY=your-api-key
SMS_TRAFFIC_ACCOUNT_ID=your-traffic-account-id

# Database
DATABASE_URL=postgresql://...
DIRECT_DATABASE_URL=postgresql://...

# Redis (for queue)
REDIS_URL=redis://...
```

#### Optional

```bash
# Batch Configuration (Campaigns)
SMS_BATCH_SIZE=5000  # Fixed batch size for campaigns (default: 5000)

# Worker Configuration
WORKER_CONCURRENCY=5  # Batches processed simultaneously

# Rate Limiting
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100
RATE_LIMIT_TRAFFIC_ACCOUNT_WINDOW_MS=1000
RATE_LIMIT_TENANT_MAX=50
RATE_LIMIT_TENANT_WINDOW_MS=1000

# Queue Configuration
QUEUE_RATE_MAX=50
QUEUE_RATE_DURATION_MS=1000
QUEUE_ATTEMPTS=5
QUEUE_BACKOFF_MS=3000

# URLs
FRONTEND_URL=https://astronote-retail-frontend.onrender.com
UNSUBSCRIBE_BASE_URL=https://astronote-retail-frontend.onrender.com
OFFER_BASE_URL=https://astronote-retail-frontend.onrender.com

# Mitto
MITTO_API_BASE=https://messaging.mittoapi.com
MITTO_SENDER=YourSenderName
```

### Recommended Settings

**Production**:
```bash
SMS_BATCH_SIZE=5000              # Fixed batch size for campaigns
WORKER_CONCURRENCY=5              # Batches processed simultaneously
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100
RATE_LIMIT_TENANT_MAX=50
```

**Staging**:
```bash
SMS_BATCH_SIZE=1000              # Smaller batches for testing
WORKER_CONCURRENCY=2
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=50
RATE_LIMIT_TENANT_MAX=25
```

**Development**:
```bash
SMS_BATCH_SIZE=100               # Small batches for local testing
WORKER_CONCURRENCY=1
```

---

## Best Practices

### Campaign Messages

1. **Batch Sizing**: Use default (200) for most campaigns
2. **Large Campaigns**: System automatically uses larger batches
3. **Monitoring**: Monitor queue depth and processing times
4. **Error Handling**: Check campaign status regularly

### Automation Messages

1. **Message Content**: Keep messages concise and personalized
2. **Merge Tags**: Use `{{first_name}}` and `{{last_name}}` for personalization
3. **Testing**: Test automation messages before activating
4. **Monitoring**: Monitor automation message success rates

### Single Messages

1. **Testing**: Use for testing message content and formatting
2. **Debugging**: Useful for troubleshooting send issues
3. **One-Off Sends**: For special cases or manual sends

### General

1. **Credits**: Always ensure sufficient credits before sending
2. **Subscription**: Verify active subscription before sending
3. **Rate Limits**: Be aware of rate limits, especially for large campaigns
4. **Status Updates**: Use webhooks for real-time status, refresh for reconciliation

---

## Troubleshooting

### Campaign Not Sending

**Check**:
1. Campaign status (must be `draft`, `scheduled`, or `paused`)
2. Subscription status (must be active)
3. Credit balance (must be sufficient)
4. Queue status (check Redis connection)
5. Worker status (check worker logs)

### Messages Stuck in Queue

**Check**:
1. Worker is running
2. Redis connection is healthy
3. Rate limits not exceeded
4. Mitto API is accessible

### Partial Failures

**Normal Behavior**: Some messages may fail (invalid numbers, etc.)

**Check**:
1. Individual message errors in database
2. Campaign aggregates for success rate
3. Retry failed messages if needed

### Rate Limit Errors

**Solution**:
1. Reduce batch size
2. Increase rate limit configuration
3. Wait and retry

---

## API Reference

### Campaign Endpoints

**Enqueue Campaign**:
```http
POST /api/campaigns/:id/enqueue
Authorization: Bearer <token>
```

**Get Campaign Status**:
```http
GET /api/campaigns/:id/status
Authorization: Bearer <token>
```

**Refresh Campaign Status**:
```http
POST /api/campaigns/:id/refresh-status
Authorization: Bearer <token>
```

### Automation Endpoints

**Get Automations**:
```http
GET /api/automations
Authorization: Bearer <token>
```

**Update Automation**:
```http
PUT /api/automations/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "isActive": true,
  "messageBody": "Hi {{first_name}}, welcome! 🎉"
}
```

### Mitto Endpoints

**Get Message Status**:
```http
GET /api/mitto/message/:messageId
Authorization: Bearer <token>
```

**Refresh Status Bulk**:
```http
POST /api/mitto/refresh-status-bulk
Authorization: Bearer <token>
Content-Type: application/json

{
  "campaignId": 123
}
```

---

## Implementation Notes

### Campaign Sending

**Always Bulk**: Campaigns always use the bulk endpoint (`/Messages/sendmessagesbulk`). There is no fallback to individual sends for campaigns.

**Fixed Batching**: All campaigns use a fixed batch size (default: 5000). This simplifies logic and makes monitoring predictable.

**Queue + Worker**: All campaign sends go through:
1. `enqueueCampaign()` → Creates messages and enqueues jobs
2. Redis/BullMQ → Job queue
3. Worker → Processes batches
4. `sendBulkMessages()` → Mitto bulk endpoint

### Individual Sending

**Automations & Test Messages**: These continue to use the single send endpoint (`/Messages/send`) for 1→1 sends. This is appropriate for their lower volume and synchronous nature.

### Database Migrations

**Required Migrations**:
1. `20250124000000_add_bulk_id_to_campaign_message` - Adds `bulkId` field
2. `20250124000001_add_retry_count_to_campaign_message` - Adds `retryCount` field

**Run**:
```bash
npx prisma migrate deploy --schema=prisma/schema.prisma
```

---

## Summary

### Message Sending Methods

| Method | Type | Processing | Endpoint | Use Case |
|--------|------|------------|----------|----------|
| **Campaigns** | Bulk | Async (Queue) | `/Messages/sendmessagesbulk` | Marketing campaigns to multiple recipients |
| **Automations** | Individual | Sync (Direct) | `/Messages/send` | Welcome/birthday messages |
| **Test/Single** | Individual | Sync (Direct) | `/Messages/send` | Testing, one-off sends |

### Key Features

- ✅ **Bulk Sending**: Campaigns always use bulk endpoint (`/Messages/sendmessagesbulk`)
- ✅ **Fixed Batching**: Simple, predictable fixed batch size (default: 5000)
- ✅ **Individual Sending**: Automations and tests use single endpoint (`/Messages/send`)
- ✅ **Credit Safety**: Credits only debited after successful send
- ✅ **Rate Limiting**: Per-traffic-account and per-tenant limits (implemented)
- ✅ **Idempotency**: Multiple layers prevent duplicate sends
- ✅ **Status Tracking**: Webhooks + manual refresh
- ✅ **Error Handling**: Comprehensive error handling and retries

---

**Last Updated**: 2025-01-24  
**Version**: 2.0 (Bulk SMS Implementation)

