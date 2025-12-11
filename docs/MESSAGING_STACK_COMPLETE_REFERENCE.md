# Messaging Stack - Complete Reference Guide

**Last Updated**: 2025-01-24  
**Application**: astronote-retail-backend  
**Status**: Production-Ready

---

## Table of Contents

1. [Introduction & Scope](#introduction--scope)
2. [Historical Overview – From Legacy to Bulk](#historical-overview--from-legacy-to-bulk)
3. [Current High-Level Architecture](#current-high-level-architecture)
4. [Campaigns – New Bulk SMS Flow (Current State)](#campaigns--new-bulk-sms-flow-current-state)
5. [Automations & Single Test Messages (Current State)](#automations--single-test-messages-current-state)
6. [Rate Limiting & Retry Strategy](#rate-limiting--retry-strategy)
7. [Campaign Metrics & Semantics (API + UI)](#campaign-metrics--semantics-api--ui)
8. [Integration with astronote-retail-frontend](#integration-with-astronote-retail-frontend)
9. [Migration Notes – From Old to New](#migration-notes--from-old-to-new)
10. [Known Limitations & Future Improvements](#known-limitations--future-improvements)

---

## 1. Introduction & Scope

### What This Document Covers

This document provides a **complete reference** for the messaging architecture in the Retail app, focusing on:

- **SMS messaging only** (no email, push notifications, etc.)
- **Three message types**:
  - **Campaigns** (bulk marketing messages)
  - **Automations** (welcome, birthday messages)
  - **Single test messages** (manual testing)
- **The evolution** from the original implementation to the current bulk SMS architecture
- **The current, final state** of the system (as of 2025-01-24)

### Key Focus Areas

1. **Transition History**: How we moved from legacy single-message sending to bulk-based architecture
2. **Current Architecture**: End-to-end flow from UI to Mitto API to database
3. **Integration Details**: How the frontend and backend work together
4. **Technical Implementation**: Services, queues, workers, rate limiting, metrics

### Audience

- **Developers** working on the messaging stack
- **Architects** reviewing system design
- **DevOps** deploying and monitoring the system
- **Product Managers** understanding capabilities and limitations

---

## 2. Historical Overview – From Legacy to Bulk

### Original Implementation (Before Bulk)

#### How Campaigns Used to Be Sent

**Method**: One message per API call to Mitto (loop-based sending)

**Flow**:
```
1. User clicks "Send Campaign"
2. API receives request
3. For each contact in audience:
   - Call Mitto API: POST /Messages/send
   - Wait for response
   - Update CampaignMessage status
   - Debit credit
4. Update campaign aggregates
```

**Code Pattern** (simplified):
```javascript
// Legacy approach (removed)
for (const contact of contacts) {
  const result = await sendSingle({
    destination: contact.phone,
    text: messageText
  });
  // Update DB, debit credit, etc.
}
```

#### Limitations & Performance Issues

1. **Scalability**:
   - Sending 10,000 messages = 10,000 API calls
   - Sequential processing = very slow (minutes to hours)
   - High latency for large campaigns

2. **Rate Limiting**:
   - Easy to hit Mitto rate limits
   - No built-in retry logic for rate limit errors
   - Failed batches required manual intervention

3. **Reliability**:
   - Network errors could fail entire campaign
   - No idempotency guarantees
   - Difficult to track partial failures

4. **Resource Usage**:
   - Blocked API server threads
   - High memory usage for large campaigns
   - No background processing

#### How Automations & Test Messages Worked

**Method**: 1→1 messaging (same as campaigns, but lower volume)

- Welcome messages: Sent when contact is created
- Birthday messages: Sent on contact's birthday
- Test messages: Manual single-message sends

**Flow**: Direct API call to `POST /Messages/send` (synchronous)

**Status**: This approach was acceptable for low-volume, 1→1 scenarios

---

### Motivation for Change

#### Why We Moved to the Mitto Bulk API

1. **Scalability Requirements**:
   - Need to support campaigns with 100k+ messages
   - Legacy approach was too slow and resource-intensive
   - Required background processing

2. **Performance**:
   - Bulk endpoint can handle 1M+ messages per request
   - Mitto handles internal batching
   - Significantly faster than individual sends

3. **Rate Limits & Reliability**:
   - Bulk endpoint has higher rate limits
   - Better error handling and partial failure support
   - Built-in retry mechanisms

4. **Architecture**:
   - Need for queue + worker pattern
   - Asynchronous processing
   - Better observability and monitoring

#### Decision Timeline

1. **Initial Implementation**: Single-message loop (legacy)
2. **Bulk API Discovery**: Mitto introduced bulk endpoint (`/Messages/sendmessagesbulk`)
3. **Architecture Design**: Queue + Worker + Bulk endpoint
4. **Implementation**: Phase 1 (bulk implementation)
5. **Simplification**: Fixed batch size, removed dynamic rules
6. **Phase 2 Improvements**: Rate limit retry, metrics clarity

---

### New Direction

#### Decision Summary

**Campaigns**:
- ✅ **Always use bulk endpoint** (`/Messages/sendmessagesbulk`)
- ✅ **Queue + Worker architecture** (asynchronous, scalable)
- ✅ **Fixed batch size** (default: 5000 messages per batch)
- ✅ **Rate limiting** (per-traffic-account, per-tenant)
- ✅ **Idempotency** (prevent duplicate sends)
- ✅ **No fallback** to individual sends

**Automations & Test Messages**:
- ✅ **Keep 1→1 sends** (appropriate for low volume)
- ✅ **Use single endpoint** (`/Messages/send`)
- ✅ **Synchronous processing** (no queue)
- ✅ **Same credit/unsubscribe logic** as campaigns

**Rationale**:
- Campaigns are high-volume, bulk-appropriate
- Automations are low-volume, 1→1 nature
- Can revisit automations later if volume grows

---

## 3. Current High-Level Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    astronote-retail-frontend                     │
│  (React + TypeScript + React Query)                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP/REST API
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    astronote-retail-backend                      │
│                      (apps/api - Express)                        │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Routes & Controllers                                     │  │
│  │  - /api/campaigns/:id/enqueue                            │  │
│  │  - /api/campaigns/:id/status                             │  │
│  │  - /api/automations/...                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Services Layer                                          │  │
│  │  - campaignEnqueue.service.js                            │  │
│  │  - smsBulk.service.js                                    │  │
│  │  - automation.service.js                                  │  │
│  │  - rateLimiter.service.js                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Queue (BullMQ + Redis)                                  │  │
│  │  - smsQueue (campaign batches)                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ Job Processing
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Worker Process                                │
│                    (apps/worker - Node.js)                       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  SMS Worker (sms.worker.js)                              │  │
│  │  - Processes sendBulkSMS jobs                            │  │
│  │  - Processes sendSMS jobs (automations)                  │  │
│  │  - Handles retries, errors                               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ API Calls
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Mitto API                                    │
│                    (messaging.mittoapi.com)                      │
│                                                                   │
│  - POST /api/v1.1/Messages/sendmessagesbulk (campaigns)         │
│  - POST /api/v1.1/Messages/send (automations/test)             │
│  - GET  /api/v1.1/Messages/{messageId} (status check)          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ DLR Webhooks
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                           │
│                    (Prisma ORM)                                 │
│                                                                   │
│  - Campaign (aggregates: total, sent, failed, processed)        │
│  - CampaignMessage (bulkId, providerMessageId, status)          │
│  - Contact, User, Wallet, etc.                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Retail API (`apps/api`)

**Purpose**: HTTP API server handling requests from frontend

**Key Files**:
- `src/server.js` - Express server setup
- `src/routes/campaigns.js` - Campaign endpoints
- `src/routes/automations.js` - Automation endpoints
- `src/routes/mitto.webhooks.js` - DLR webhook handler

**Responsibilities**:
- Receive HTTP requests
- Validate input
- Enqueue jobs (for campaigns)
- Return responses
- Handle webhooks

#### 2. Worker (`apps/worker`)

**Purpose**: Background job processor for SMS sending

**Key Files**:
- `src/sms.worker.js` - Main SMS worker
- `src/scheduler.worker.js` - Scheduled campaigns
- `src/statusRefresh.worker.js` - Status updates

**Responsibilities**:
- Process queued jobs
- Call Mitto API
- Update database
- Handle retries
- Manage errors

#### 3. Redis

**Purpose**: Queue storage and rate limiting

**Usage**:
- **BullMQ Queue**: Stores `sendBulkSMS` and `sendSMS` jobs
- **Rate Limiting**: Distributed rate limit counters
- **Caching**: Optional caching layer

#### 4. Database (PostgreSQL + Prisma)

**Purpose**: Persistent storage for campaigns, messages, contacts

**Key Models**:
- `Campaign` - Campaign metadata and aggregates
- `CampaignMessage` - Individual message records
- `Contact` - Recipient information
- `Wallet` - Credit balance

#### 5. Mitto API

**Purpose**: SMS provider (external service)

**Endpoints Used**:
- `POST /api/v1.1/Messages/sendmessagesbulk` - Bulk sends
- `POST /api/v1.1/Messages/send` - Single sends
- `GET /api/v1.1/Messages/{messageId}` - Status check

---

### Message Types & Flows

#### 1. Campaigns (Bulk, Async)

**Flow**:
```
User clicks "Send Campaign"
  ↓
Frontend: POST /api/campaigns/:id/enqueue
  ↓
Backend: campaignEnqueue.service.js
  - Validates campaign, subscription, credits
  - Builds audience (contacts)
  - Creates CampaignMessage records (status='queued')
  - Groups into batches (SMS_BATCH_SIZE=5000)
  - Enqueues sendBulkSMS jobs to Redis
  ↓
Returns: { ok: true, enqueuedJobs: N }
  ↓
Worker: sms.worker.js picks up job
  - Fetches queued messages
  - Calls smsBulk.service.js
  - Checks rate limits
  - Calls mitto.service.js → sendBulkMessages()
  - Mitto API: POST /Messages/sendmessagesbulk
  ↓
Mitto Response: { bulkId, messages: [{ messageId, ... }] }
  ↓
Worker: Updates CampaignMessage records
  - Sets providerMessageId, bulkId
  - Updates status: 'sent' or 'failed'
  - Debits credits
  - Updates campaign aggregates
  ↓
DLR Webhook: POST /webhooks/mitto/dlr
  - Updates message status (sent → delivered, etc.)
  - Updates campaign aggregates
  ↓
Frontend: Polls GET /api/campaigns/:id/status
  - Displays metrics: success, processed, failed
```

**Sequence Diagram**:
```
Frontend          API              Queue            Worker           Mitto            DB
   │              │                 │                 │                │               │
   │ POST /enqueue│                 │                 │                │               │
   ├─────────────>│                 │                 │                │               │
   │              │ Build audience  │                 │                │               │
   │              │ Create messages │                 │                │               │
   │              ├──────────────────────────────────────────────────────────────────>│
   │              │ Enqueue jobs    │                 │                │               │
   │              ├────────────────>│                 │                │               │
   │              │ { ok: true }    │                 │                │               │
   │<─────────────┤                 │                 │                │               │
   │              │                 │                 │                │               │
   │              │                 │ Job available    │                │               │
   │              │                 ├─────────────────>│                │               │
   │              │                 │                 │ Fetch messages │               │
   │              │                 │                 ├─────────────────────────────────>│
   │              │                 │                 │ Check rate limit│               │
   │              │                 │                 │ Call bulk API  │               │
   │              │                 │                 ├──────────────────────────────────>│
   │              │                 │                 │                │ { bulkId, ... }│
   │              │                 │                 │<──────────────────────────────────┤
   │              │                 │                 │ Update DB      │               │
   │              │                 │                 ├─────────────────────────────────>│
   │              │                 │                 │                │               │
   │              │                 │                 │                │ DLR webhook   │
   │              │                 │                 │                ├───────────────>│
   │              │                 │                 │                │               │
   │ GET /status  │                 │                 │                │               │
   ├─────────────>│                 │                 │                │               │
   │              │ Query metrics   │                 │                │               │
   │              ├──────────────────────────────────────────────────────────────────>│
   │              │ { success, processed, failed }    │                │               │
   │<─────────────┤                 │                 │                │               │
```

#### 2. Automations (Individual, Sync)

**Flow**:
```
Contact created / Birthday trigger
  ↓
Backend: automation.service.js
  - Validates subscription, credits
  - Calls sms.service.js → sendSMSWithCredits()
  - Calls mitto.service.js → sendSingle()
  - Mitto API: POST /Messages/send
  ↓
Mitto Response: { messageId, ... }
  ↓
Backend: Updates database
  - Creates CampaignMessage record (if tracking needed)
  - Debits credit
  ↓
Returns: Success/Error
```

**Sequence Diagram**:
```
Trigger          API              Mitto            DB
   │              │                 │               │
   │ Trigger      │                 │               │
   ├─────────────>│                 │               │
   │              │ Check credits   │               │
   │              ├─────────────────────────────────>│
   │              │ Send SMS        │               │
   │              ├──────────────────────────────────>│
   │              │                 │ { messageId } │
   │              │<──────────────────────────────────┤
   │              │ Update DB       │               │
   │              ├─────────────────────────────────>│
   │              │ { success }     │               │
   │<─────────────┤                 │               │
```

#### 3. Test Messages (Individual, Sync)

**Flow**: Same as automations (direct API call, synchronous)

---

## 4. Campaigns – New Bulk SMS Flow (Current State)

### End-to-End Flow

#### Step 1: User Initiates Campaign Send

**Frontend**: `src/pages/CreateCampaign.tsx` or `src/pages/CampaignDetails.tsx`

**Action**: User clicks "Send Campaign Now" or "Schedule Campaign"

**API Call**:
```typescript
POST /api/campaigns/:id/enqueue
```

**Request**: No body (campaign ID in URL)

**Response**:
```json
{
  "ok": true,
  "created": 10000,
  "enqueuedJobs": 10000,
  "campaignId": 123
}
```

---

#### Step 2: Campaign Enqueue Service

**File**: `apps/api/src/services/campaignEnqueue.service.js`

**Function**: `enqueueCampaign(campaignId)`

**Process**:

1. **Fetch Campaign**:
   ```javascript
   const camp = await prisma.campaign.findUnique({
     where: { id: campaignId },
     include: { template: true }
   });
   ```

2. **Build Audience**:
   ```javascript
   // Uses audience.service.js
   contacts = await buildAudience(
     camp.ownerId,
     camp.filterGender,
     camp.filterAgeGroup,
     null
   );
   ```
   - Filters by gender, age group (or null = all)
   - Only includes subscribed contacts
   - Returns array of Contact objects

3. **Validate Subscription**:
   ```javascript
   const subscriptionActive = await isSubscriptionActive(camp.ownerId);
   if (!subscriptionActive) {
     return { ok: false, reason: 'inactive_subscription' };
   }
   ```

4. **Check Credits**:
   ```javascript
   const balance = await getBalance(camp.ownerId);
   const requiredCredits = contacts.length;
   if (balance < requiredCredits) {
     return { ok: false, reason: 'insufficient_credits' };
   }
   ```

5. **Create CampaignMessage Records**:
   ```javascript
   const messagesData = contacts.map((contact) => {
     // Render message with merge tags
     const messageText = render(camp.messageText || camp.template.text, {
       first_name: contact.firstName,
       last_name: contact.lastName
     });
     
     // Generate tracking ID and links
     const trackingId = newTrackingId();
     const offerUrl = `${OFFER_BASE_URL}/o/${trackingId}`;
     const unsubscribeToken = generateUnsubscribeToken(...);
     const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${unsubscribeToken}`;
     
     return {
       ownerId: camp.ownerId,
       campaignId: camp.id,
       contactId: contact.id,
       to: contact.phone,
       text: messageText + `\n\nView offer: ${offerUrl}\n\nTo unsubscribe: ${unsubscribeUrl}`,
       trackingId,
       status: 'queued',
       retryCount: 0
     };
   });
   
   // Bulk create in transaction
   await prisma.campaignMessage.createMany({ data: messagesData });
   ```

6. **Update Campaign Status**:
   ```javascript
   await prisma.campaign.updateMany({
     where: { id: camp.id, ownerId: camp.ownerId },
     data: {
       status: 'sending',
       total: contacts.length,
       startedAt: new Date()
     }
   });
   ```

7. **Enqueue Batch Jobs**:
   ```javascript
   const BATCH_SIZE = Number(process.env.SMS_BATCH_SIZE || 5000);
   
   // Group messages into fixed-size batches
   const batches = [];
   for (let i = 0; i < toEnqueue.length; i += BATCH_SIZE) {
     batches.push(toEnqueue.slice(i, i + BATCH_SIZE).map(m => m.id));
   }
   
   // Enqueue each batch as a separate job
   for (const messageIds of batches) {
     await smsQueue.add('sendBulkSMS', {
       campaignId: camp.id,
       ownerId: camp.ownerId,
       messageIds
     }, {
       jobId: `batch:${camp.id}:${Date.now()}:${batchIndex}`,
       attempts: 5,
       backoff: { type: 'exponential', delay: 3000 }
     });
   }
   ```

---

#### Step 3: Worker Processes Batch Job

**File**: `apps/worker/src/sms.worker.js`

**Function**: `processBatchJob(campaignId, ownerId, messageIds, job)`

**Process**:

1. **Fetch Queued Messages**:
   ```javascript
   const messages = await prisma.campaignMessage.findMany({
     where: {
       id: { in: messageIds },
       campaignId,
       ownerId,
       status: 'queued',
       providerMessageId: null  // Idempotency: only process unsent
     },
     include: {
       campaign: { select: { id: true, ownerId: true, createdById: true } },
       contact: { select: { id: true, phone: true } }
     }
   });
   ```

2. **Prepare Bulk Payload**:
   ```javascript
   const bulkMessages = messages.map(msg => ({
     ownerId: msg.campaign.ownerId,
     destination: msg.to,
     text: msg.text,  // Already includes unsubscribe/offer links
     contactId: msg.contact.id,
     createdById: msg.campaign.createdById,
     internalMessageId: msg.id,
     meta: {
       reason: `sms:send:campaign:${msg.campaign.id}`,
       campaignId: msg.campaign.id,
       messageId: msg.id
     }
   }));
   ```

3. **Call Bulk SMS Service**:
   ```javascript
   const result = await sendBulkSMSWithCredits(bulkMessages);
   ```

---

#### Step 4: Bulk SMS Service

**File**: `apps/api/src/services/smsBulk.service.js`

**Function**: `sendBulkSMSWithCredits(messages)`

**Process**:

1. **Check Subscription**:
   ```javascript
   const subscriptionActive = await isSubscriptionActive(ownerId);
   if (!subscriptionActive) {
     return { bulkId: null, results: [...failed results] };
   }
   ```

2. **Check Credits**:
   ```javascript
   const balance = await getBalance(ownerId);
   const requiredCredits = messages.length;
   if (balance < requiredCredits) {
     return { bulkId: null, results: [...failed results] };
   }
   ```

3. **Check Rate Limits**:
   ```javascript
   const rateLimitCheck = await checkAllLimits(trafficAccountId, ownerId);
   if (!rateLimitCheck.allowed) {
     // Phase 2.1: Throw error for retry
     const error = new Error('Rate limit exceeded. Please try again in a moment.');
     error.reason = 'rate_limit_exceeded';
     error.status = 429;
     throw error;
   }
   ```

4. **Call Mitto Bulk API**:
   ```javascript
   const mittoMessages = messages.map(msg => ({
     trafficAccountId: msg.trafficAccountId || TRAFFIC_ACCOUNT_ID,
     destination: msg.destination,
     sms: {
       text: msg.text,
       sender: await resolveSender(msg.createdById, msg.sender)
     }
   }));
   
   const result = await sendBulkMessages({
     userId: messages[0].createdById,
     messages: mittoMessages
   });
   ```

5. **Handle Response**:
   ```javascript
   // Mitto returns: { bulkId, messages: [{ messageId, trafficAccountId }] }
   // Map response to our internal message IDs
   const results = messages.map((msg, idx) => {
     const mittoResponse = result.messages[idx];
     return {
       id: msg.internalMessageId,
       sent: !!mittoResponse?.messageId,
       messageId: mittoResponse?.messageId,
       bulkId: result.bulkId,
       error: mittoResponse?.error || null
     };
   });
   
   // Debit credits only for successful sends
   const successfulCount = results.filter(r => r.sent).length;
   if (successfulCount > 0) {
     await debit(ownerId, successfulCount, `sms:send:campaign:${campaignId}`);
   }
   
   return {
     bulkId: result.bulkId,
     results,
     summary: {
       total: messages.length,
       sent: successfulCount,
       failed: messages.length - successfulCount
     }
   };
   ```

---

#### Step 5: Mitto API Call

**File**: `apps/api/src/services/mitto.service.js`

**Function**: `sendBulkMessages({ userId, messages })`

**Endpoint**: `POST https://messaging.mittoapi.com/api/v1.1/Messages/sendmessagesbulk`

**Headers**:
```
Content-Type: application/json
X-Mitto-API-Key: {MITTO_API_KEY}
```

**Request Payload**:
```json
{
  "messages": [
    {
      "trafficAccountId": "your-traffic-account-id",
      "destination": "+1234567890",
      "sms": {
        "text": "Hello {{first_name}}! View offer: https://...",
        "sender": "YourSender"
      }
    },
    // ... up to 1M+ messages
  ]
}
```

**Response**:
```json
{
  "bulkId": "bulk-12345-abcde",
  "messages": [
    {
      "messageId": "msg-001",
      "trafficAccountId": "your-traffic-account-id"
    },
    {
      "messageId": "msg-002",
      "trafficAccountId": "your-traffic-account-id"
    }
    // ... one per input message
  ]
}
```

---

#### Step 6: Worker Updates Database

**File**: `apps/worker/src/sms.worker.js`

**After receiving result from `sendBulkSMSWithCredits()`**:

```javascript
// Update each message with result
for (const res of result.results) {
  const updateData = {
    updatedAt: new Date(),
    retryCount: { increment: 1 }
  };
  
  if (res.sent) {
    updateData.providerMessageId = res.messageId;
    updateData.bulkId = res.bulkId;
    updateData.sentAt = new Date();
    updateData.status = 'sent';
    updateData.error = null;
  } else {
    updateData.failedAt = new Date();
    updateData.status = 'failed';
    updateData.error = res.error || 'Bulk send failed';
  }
  
  await prisma.campaignMessage.update({
    where: { id: res.id },
    data: updateData
  });
}

// Update campaign aggregates (non-blocking)
await updateCampaignAggregates(campaignId, ownerId);
```

---

#### Step 7: Status Updates (DLR Webhooks)

**File**: `apps/api/src/routes/mitto.webhooks.js`

**Endpoint**: `POST /webhooks/mitto/dlr`

**Process**:

1. **Receive Webhook**:
   ```javascript
   router.post('/webhooks/mitto/dlr', async (req, res) => {
     const { messageId, deliveryStatus, ... } = req.body;
     
     // Find message by providerMessageId
     const message = await prisma.campaignMessage.findFirst({
       where: { providerMessageId: messageId }
     });
     
     if (!message) {
       return res.status(404).json({ error: 'Message not found' });
     }
     
     // Map Mitto status to our status
     const newStatus = mapMittoStatus(deliveryStatus);
     // 'Delivered' → 'sent', 'Failure' → 'failed', etc.
     
     // Update message
     await prisma.campaignMessage.update({
       where: { id: message.id },
       data: {
         status: newStatus,
         updatedAt: new Date()
       }
     });
     
     // Update campaign aggregates
     await updateCampaignAggregates(message.campaignId, message.ownerId);
     
     res.json({ ok: true });
   });
   ```

---

#### Step 8: Frontend Polls Status

**File**: `astronote-retail-frontend/src/hooks/api/useCampaigns.ts`

**Hook**: `useCampaignStatus(campaignId)`

**API Call**:
```typescript
GET /api/campaigns/:id/status
```

**Response**:
```json
{
  "campaign": {
    "id": 123,
    "name": "Weekend Sale",
    "status": "sending",
    "total": 10000,
    "sent": 8500,
    "failed": 200,
    "processed": 8700
  },
  "metrics": {
    "queued": 1300,
    "success": 8500,
    "processed": 8700,
    "failed": 200
  }
}
```

**Frontend Display**: `src/pages/CampaignDetails.tsx`

- Shows real-time metrics
- Updates via polling (every few seconds)
- Displays progress bar, success/failed counts

---

### Implementation Details

#### Main Services & Functions

**Campaign Enqueue**:
- **File**: `apps/api/src/services/campaignEnqueue.service.js`
- **Function**: `enqueueCampaign(campaignId)`
- **Dependencies**: `audience.service.js`, `subscription.service.js`, `wallet.service.js`, `sms.queue.js`

**Bulk SMS Service**:
- **File**: `apps/api/src/services/smsBulk.service.js`
- **Function**: `sendBulkSMSWithCredits(messages)`
- **Dependencies**: `mitto.service.js`, `wallet.service.js`, `rateLimiter.service.js`

**Mitto Service**:
- **File**: `apps/api/src/services/mitto.service.js`
- **Function**: `sendBulkMessages({ userId, messages })`
- **Endpoint**: `POST /api/v1.1/Messages/sendmessagesbulk`

**Worker**:
- **File**: `apps/worker/src/sms.worker.js`
- **Function**: `processBatchJob(campaignId, ownerId, messageIds, job)`
- **Dependencies**: `smsBulk.service.js`, `campaignAggregates.service.js`

**Campaign Aggregates**:
- **File**: `apps/api/src/services/campaignAggregates.service.js`
- **Function**: `updateCampaignAggregates(campaignId, ownerId)`
- **Calculates**: `total`, `sent`, `failed`, `processed`

---

#### Queue & Worker Logic

**Queue Configuration** (`apps/api/src/queues/sms.queue.js`):

```javascript
const smsQueue = new Queue('smsQueue', {
  connection: getRedisClient(),
  defaultJobOptions: {
    attempts: Number(process.env.QUEUE_ATTEMPTS || 5),
    backoff: { 
      type: 'exponential', 
      delay: Number(process.env.QUEUE_BACKOFF_MS || 3000) 
    },
    removeOnComplete: 1000,
    removeOnFail: false
  },
  limiter: {
    max: Number(process.env.QUEUE_RATE_MAX || 20),
    duration: Number(process.env.QUEUE_RATE_DURATION_MS || 1000)
  }
});
```

**Worker Configuration** (`apps/worker/src/sms.worker.js`):

```javascript
const worker = new Worker(
  'smsQueue',
  async (job) => {
    if (job.name === 'sendBulkSMS') {
      await processBatchJob(...);
    } else if (job.name === 'sendSMS') {
      await processIndividualJob(...);
    }
  },
  { 
    connection: getRedisClient(),
    concurrency: Number(process.env.WORKER_CONCURRENCY || 5)
  }
);
```

**Batch Size**:

- **Fixed Size**: `SMS_BATCH_SIZE` (default: 5000)
- **Configuration**: `process.env.SMS_BATCH_SIZE`
- **Logic**: Simple chunking - `messages.slice(i, i + BATCH_SIZE)`
- **No Dynamic Rules**: Removed complex 100/200/300/500 logic

**Example**:
- Campaign with 12,000 messages
- Batch size: 5000
- Result: 3 batches (5000, 5000, 2000)

---

#### Mitto Bulk API Usage

**Endpoint**: `POST https://messaging.mittoapi.com/api/v1.1/Messages/sendmessagesbulk`

**Request Payload Structure**:
```json
{
  "messages": [
    {
      "trafficAccountId": "string",
      "destination": "+1234567890",
      "sms": {
        "text": "Message text",
        "sender": "SenderName"
      }
    }
  ]
}
```

**Response Structure**:
```json
{
  "bulkId": "bulk-12345-abcde",
  "messages": [
    {
      "messageId": "msg-001",
      "trafficAccountId": "your-traffic-account-id"
    }
  ]
}
```

**Key Points**:
- Each message in request gets a `messageId` in response
- `bulkId` is shared across all messages in the batch
- Partial failures are possible (some messages succeed, some fail)
- Mitto handles internal batching (can accept 1M+ messages)

---

#### Database Model & Tracking

**Campaign Model** (`prisma/schema.prisma`):

```prisma
model Campaign {
  id          Int            @id @default(autoincrement())
  ownerId     Int
  name        String
  status      CampaignStatus @default(draft)
  total       Int            @default(0)
  sent        Int            @default(0)  // Actually sent (status='sent')
  failed      Int            @default(0)
  processed   Int?           // sent + failed (Phase 2.2)
  // ... other fields
}
```

**CampaignMessage Model**:

```prisma
model CampaignMessage {
  id                Int            @id @default(autoincrement())
  ownerId           Int
  campaignId        Int
  contactId         Int
  to                String
  text              String         @db.Text
  trackingId        String         @unique
  status            MessageStatus  @default(queued)
  providerMessageId String?        // Mitto messageId
  bulkId            String?       // Mitto bulkId (for batch tracking)
  retryCount        Int            @default(0)
  error             String?
  createdAt         DateTime       @default(now())
  sentAt            DateTime?
  failedAt          DateTime?
  
  @@index([bulkId])
  @@index([providerMessageId])
  @@index([status])
  @@index([campaignId])
  @@index([ownerId, campaignId])
}
```

**Tracking Fields**:

- **`providerMessageId`**: Mitto's `messageId` (for status checks, DLR)
- **`bulkId`**: Mitto's `bulkId` (for batch-level tracking)
- **`status`**: `queued`, `sent`, `failed`
- **`retryCount`**: Number of retry attempts (for idempotency)
- **`error`**: Error message if failed

**Indexes**:

- `bulkId` - Fast lookup of all messages in a batch
- `providerMessageId` - Fast lookup for DLR webhooks
- `status` - Fast filtering by status
- `[ownerId, campaignId]` - Common query pattern
- `[ownerId, status]` - Filtered status queries

---

#### Status Transitions & Error Handling

**Message Status Semantics**:

- **`queued`**: Message is queued for sending (before send attempt)
- **`sent`**: Message was successfully sent (accepted by Mitto or Delivered via DLR)
- **`failed`**: Final failure (API error, rate limit after max retries, invalid number, DLR "Failure")

**Status Transitions**:

```
queued → sent (successful send)
queued → failed (non-retryable error)
queued → queued (retryable error, will retry)
sent → sent (DLR update, no change)
sent → failed (DLR "Failure" status)
```

**Error Handling**:

**Retryable Errors** (Phase 2.1):
- Network errors (no status code)
- Server errors (5xx)
- Rate limit errors (`rate_limit_exceeded`, 429)
- **Behavior**: Worker retries with exponential backoff (3s, 6s, 12s, 24s, 48s)
- **Max Attempts**: 5 (configurable)
- **After Max Attempts**: Mark as `failed`

**Non-Retryable Errors**:
- Client errors (4xx, except 429)
- Invalid phone numbers
- Invalid message content
- **Behavior**: Mark as `failed` immediately

**Partial Failures in Bulk**:

- Mitto bulk API can return partial success
- Some messages succeed, some fail
- **Handling**: Each message result is processed individually
- Successful messages: `status='sent'`, `providerMessageId` set
- Failed messages: `status='failed'`, `error` set
- Campaign aggregates updated accordingly

**Code** (`apps/worker/src/sms.worker.js`):

```javascript
function isRetryable(err) {
  // Phase 2.1: Rate limit errors are retryable
  if (err?.reason === 'rate_limit_exceeded' || 
      err?.message?.includes('rate limit exceeded')) {
    return true;
  }
  
  const status = err?.status;
  if (!status) return true;      // network/timeout
  if (status >= 500) return true; // provider/server error
  if (status === 429) return true; // rate limited
  return false;                    // 4xx hard fail
}

// In processBatchJob:
try {
  const result = await sendBulkSMSWithCredits(bulkMessages);
  // Update successful messages
  // Update failed messages
} catch (e) {
  const retryable = isRetryable(e);
  if (retryable) {
    throw e; // BullMQ will retry
  } else {
    // Mark all messages as failed
  }
}
```

---

## 5. Automations & Single Test Messages (Current State)

### Overview

Automations and test messages **remain 1→1 sends** (not bulk). This is appropriate because:

- **Low Volume**: Welcome/birthday messages are sent individually as events occur
- **1→1 Nature**: Each message is triggered by a specific event (contact created, birthday)
- **Synchronous**: Immediate send is acceptable (no queue needed)
- **Simple**: No complex batching or retry logic needed

### Services & Functions Used

**Automation Service** (`apps/api/src/services/automation.service.js`):

```javascript
// Welcome message
async function sendWelcomeMessage(contactId, ownerId) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || !contact.isSubscribed) return;
  
  // Get automation config
  const automation = await prisma.automation.findFirst({
    where: { ownerId, type: 'welcome_message', enabled: true }
  });
  
  if (!automation) return;
  
  // Render message with merge tags
  const messageText = render(automation.message, {
    first_name: contact.firstName,
    last_name: contact.lastName
  });
  
  // Append unsubscribe link
  const unsubscribeToken = generateUnsubscribeToken(...);
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${unsubscribeToken}`;
  const finalText = messageText + `\n\nTo unsubscribe: ${unsubscribeUrl}`;
  
  // Send via single send service
  await sendSMSWithCredits({
    ownerId,
    destination: contact.phone,
    text: finalText,
    contactId: contact.id,
    meta: { reason: 'sms:send:automation:welcome' }
  });
}
```

**Single SMS Service** (`apps/api/src/services/sms.service.js`):

```javascript
async function sendSMSWithCredits({
  ownerId,
  destination,
  text,
  sender,
  contactId,
  meta
}) {
  // 1. Check subscription
  const subscriptionActive = await isSubscriptionActive(ownerId);
  if (!subscriptionActive) {
    return { sent: false, reason: 'inactive_subscription' };
  }
  
  // 2. Check credits
  const balance = await getBalance(ownerId);
  if (balance < 1) {
    return { sent: false, reason: 'insufficient_credits' };
  }
  
  // 3. Send via Mitto
  const result = await sendSingle({
    userId: ownerId,
    destination,
    text,
    sender
  });
  
  // 4. Debit credit only if successful
  if (result.messageId) {
    await debit(ownerId, 1, meta?.reason || 'sms:send:single');
  }
  
  return {
    sent: !!result.messageId,
    messageId: result.messageId,
    error: result.error
  };
}
```

**Mitto Single Send** (`apps/api/src/services/mitto.service.js`):

```javascript
async function sendSingle({ userId, destination, text, sender }) {
  const finalSender = await resolveSender(userId, sender);
  
  const response = await mittoRequest('POST', '/api/v1.1/Messages/send', {
    trafficAccountId: TRAFFIC_ACCOUNT_ID,
    destination,
    sms: {
      text,
      sender: finalSender
    }
  });
  
  return {
    messageId: response.messageId,
    rawResponse: response
  };
}
```

### Mitto Endpoint Used

**Endpoint**: `POST https://messaging.mittoapi.com/api/v1.1/Messages/send`

**Request**:
```json
{
  "trafficAccountId": "your-traffic-account-id",
  "destination": "+1234567890",
  "sms": {
    "text": "Hello {{first_name}}!",
    "sender": "YourSender"
  }
}
```

**Response**:
```json
{
  "messageId": "msg-12345",
  "trafficAccountId": "your-traffic-account-id"
}
```

### How These Flows Differ from Campaigns

| Aspect | Campaigns | Automations/Test |
|--------|-----------|------------------|
| **Endpoint** | `/Messages/sendmessagesbulk` | `/Messages/send` |
| **Processing** | Async (queue + worker) | Sync (direct API call) |
| **Volume** | High (100s to 100k+ messages) | Low (1 message at a time) |
| **Batching** | Fixed batch size (5000) | No batching |
| **Retry Logic** | Exponential backoff, max 5 attempts | No automatic retries |
| **Rate Limiting** | Per-traffic-account + per-tenant | Basic protection only |
| **Tracking** | `bulkId` + `messageId` | `messageId` only |

### Why Current Approach is Acceptable

1. **Volume**: Automations are low-volume (1 message per event)
2. **Latency**: Immediate send is acceptable (no user waiting)
3. **Simplicity**: No need for complex queue/worker infrastructure
4. **Cost**: Single API calls are efficient for 1→1 scenarios

**Future Consideration**: If automation volume grows significantly (e.g., batch birthday sends), we can migrate to bulk endpoint.

---

## 6. Rate Limiting & Retry Strategy

### Rate Limits (Implemented)

#### Per-Traffic-Account Rate Limiting

**Limit**: 100 requests per second (default)

**Configuration**:
```bash
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100
RATE_LIMIT_TRAFFIC_ACCOUNT_WINDOW_MS=1000
```

**Implementation** (`apps/api/src/services/rateLimiter.service.js`):

```javascript
async function checkTrafficAccountLimit(trafficAccountId) {
  const key = `traffic_account:${trafficAccountId}`;
  return checkRateLimit(key, 100, 1000); // 100 req/s, 1s window
}
```

**What Counts as a Request**:
- Each bulk API call = **1 request** (regardless of message count)
- Example: Sending 5000 messages in one bulk call = 1 request

**Sliding Window**:
- Uses Redis keys with timestamp-based windows
- Key format: `rate_limit:traffic_account:{id}:{windowStart}`
- Window: 1 second (1000ms)
- Counter increments on each request
- Expires after window duration + 1 second (cleanup)

#### Per-Tenant Rate Limiting

**Limit**: 50 requests per second (default)

**Configuration**:
```bash
RATE_LIMIT_TENANT_MAX=50
RATE_LIMIT_TENANT_WINDOW_MS=1000
```

**Implementation**:

```javascript
async function checkTenantLimit(ownerId) {
  const key = `tenant:${ownerId}`;
  return checkRateLimit(key, 50, 1000); // 50 req/s, 1s window
}
```

**Purpose**: Prevent one tenant from consuming all capacity

#### Combined Check

**Implementation** (`apps/api/src/services/rateLimiter.service.js`):

```javascript
async function checkAllLimits(trafficAccountId, ownerId) {
  const [trafficAccountLimit, tenantLimit] = await Promise.all([
    checkTrafficAccountLimit(trafficAccountId),
    checkTenantLimit(ownerId)
  ]);
  
  const allowed = trafficAccountLimit.allowed && tenantLimit.allowed;
  
  return {
    allowed,
    trafficAccountLimit,
    tenantLimit
  };
}
```

**Behavior**: A request is allowed **only if both limits pass**

---

### Behavior When Limits Are Hit

#### What Happens

**When Rate Limit is Hit** (`apps/api/src/services/smsBulk.service.js`):

```javascript
const rateLimitCheck = await checkAllLimits(trafficAccountId, ownerId);
if (!rateLimitCheck.allowed) {
  logger.warn({
    ownerId,
    trafficAccountId,
    trafficAccountRemaining: rateLimitCheck.trafficAccountLimit.remaining,
    tenantRemaining: rateLimitCheck.tenantLimit.remaining
  }, 'Rate limit exceeded, throwing error for retry');
  
  // Phase 2.1: Throw error to trigger BullMQ retry
  const error = new Error('Rate limit exceeded. Please try again in a moment.');
  error.reason = 'rate_limit_exceeded';
  error.status = 429;
  throw error;
}
```

**Result**:
- Error is thrown (not returned)
- Worker's `isRetryable()` recognizes it as retryable
- BullMQ automatically retries with exponential backoff
- Messages remain in `queued` status (not marked as failed)

#### Retry Strategy (Phase 2.1)

**Retryable Errors**:

1. **Rate Limit Errors** (`rate_limit_exceeded`, 429):
   - ✅ **Retryable** (Phase 2.1 improvement)
   - Exponential backoff: 3s, 6s, 12s, 24s, 48s
   - Max attempts: 5
   - After max attempts: Mark as `failed` with `reason: 'rate_limit_exceeded'`

2. **Network Errors** (no status code):
   - ✅ Retryable
   - Same backoff strategy

3. **Server Errors** (5xx):
   - ✅ Retryable
   - Same backoff strategy

**Non-Retryable Errors**:

- Client errors (4xx, except 429)
- Invalid phone numbers
- Invalid message content
- **Behavior**: Mark as `failed` immediately

**Code** (`apps/worker/src/sms.worker.js`):

```javascript
function isRetryable(err) {
  // Phase 2.1: Rate limit errors are retryable
  if (err?.reason === 'rate_limit_exceeded' || 
      err?.message?.includes('rate limit exceeded')) {
    return true;
  }
  
  const status = err?.status;
  if (!status) return true;      // network/timeout
  if (status >= 500) return true; // provider/server error
  if (status === 429) return true; // rate limited
  return false;                    // 4xx hard fail
}
```

**Configuration**:

```bash
QUEUE_ATTEMPTS=5              # Max retries (default: 5)
QUEUE_BACKOFF_MS=3000        # Initial backoff delay (default: 3s)
```

**Backoff Delays**:
- Attempt 1: 3s
- Attempt 2: 6s
- Attempt 3: 12s
- Attempt 4: 24s
- Attempt 5: 48s
- After 5: Mark as `failed`

---

## 7. Campaign Metrics & Semantics (API + UI)

### Metrics Definition (Phase 2.2)

#### How We Compute Metrics

**Backend** (`apps/api/src/services/campaignAggregates.service.js`):

```javascript
// Count messages by status
const [total, success, failed] = await Promise.all([
  prisma.campaignMessage.count({
    where: { campaignId, ownerId }
  }),
  prisma.campaignMessage.count({
    where: {
      campaignId,
      ownerId,
      status: 'sent'  // Only actually sent messages
    }
  }),
  prisma.campaignMessage.count({
    where: {
      campaignId,
      ownerId,
      status: 'failed'
    }
  })
]);

// Calculate processed (sent + failed) - Phase 2.2
const processed = success + failed;
```

**Metrics**:

1. **`total`**: Total number of messages in campaign
   - Calculation: Count of all `CampaignMessage` records
   - Database: `Campaign.total`

2. **`success`** (or `sent`): Successfully sent messages
   - Calculation: Count of messages with `status='sent'`
   - Database: `Campaign.sent`
   - **Semantics**: Messages that were successfully sent (accepted by Mitto or Delivered via DLR)

3. **`failed`**: Failed messages
   - Calculation: Count of messages with `status='failed'`
   - Database: `Campaign.failed`
   - **Semantics**: Messages that failed permanently (API error, rate limit after max retries, invalid number, DLR "Failure")

4. **`processed`**: Processed messages (new in Phase 2.2)
   - Calculation: `success + failed`
   - Database: `Campaign.processed`
   - **Semantics**: Total messages that have been processed (either sent or failed)

5. **`queued`**: Queued messages
   - Calculation: Count of messages with `status='queued'`
   - **Semantics**: Messages waiting to be sent

---

### API Response Shape

**Endpoint**: `GET /api/campaigns/:id/status`

**Response** (`apps/api/src/routes/campaigns.js`):

```json
{
  "campaign": {
    "id": 123,
    "name": "Weekend Sale",
    "status": "sending",
    "total": 10000,
    "sent": 8500,
    "failed": 200,
    "processed": 8700,
    "createdAt": "2025-01-24T10:00:00Z",
    "updatedAt": "2025-01-24T10:05:00Z"
  },
  "metrics": {
    "queued": 1300,
    "success": 8500,
    "processed": 8700,
    "failed": 200
  }
}
```

**Field Mapping**:

- `campaign.sent` = `metrics.success` (successfully sent)
- `campaign.processed` = `metrics.processed` (sent + failed)
- `campaign.failed` = `metrics.failed` (failed)
- `metrics.queued` = messages with `status='queued'`

---

### UI Labels & Terminology

**Frontend** (`astronote-retail-frontend/src/pages/CampaignDetails.tsx`):

**Display**:

1. **Total Recipients**:
   - Label: "Total recipients" (EN) / "Σύνολο παραληπτών" (GR)
   - Value: `campaign.total`
   - Icon: Users icon

2. **Success**:
   - Label: "Success" (EN) / "Επιτυχής Αποστολή" (GR)
   - Value: `metrics.success`
   - Icon: Check circle icon
   - **Semantics**: Successfully sent messages

3. **Processed**:
   - Label: "Processed" (EN) / "Επεξεργασμένα" (GR)
   - Value: `metrics.processed`
   - Icon: Bar chart icon
   - **Semantics**: Total processed (success + failed)

4. **Failed**:
   - Label: "Failed" (EN) / "Απέτυχαν" (GR)
   - Value: `metrics.failed`
   - Icon: X circle icon
   - **Semantics**: Failed messages

**Translation Keys** (`src/i18n/locales/en.json`):

```json
{
  "campaign": {
    "details": {
      "totalRecipients": "Total recipients",
      "success": "Success",
      "processed": "Processed",
      "failed": "Failed"
    }
  }
}
```

---

### Avoiding Ambiguity

**Before Phase 2.2**:
- `sent` was ambiguous (could mean "processed" or "successfully sent")
- Users might see "Sent: 10,000" but internally it meant "processed"

**After Phase 2.2**:
- `success` (or `sent`) = **only successfully sent** messages
- `processed` = **sent + failed** (total processed)
- Clear distinction in API and UI

**Example**:
- Campaign with 10,000 messages
- 9,500 successfully sent
- 200 failed
- 300 still queued

**Metrics**:
- `total`: 10,000
- `success`: 9,500 (successfully sent)
- `failed`: 200
- `processed`: 9,700 (9,500 + 200)
- `queued`: 300

**UI Display**:
- "Total recipients: 10,000"
- "Success: 9,500"
- "Processed: 9,700"
- "Failed: 200"

---

## 8. Integration with astronote-retail-frontend

### Frontend Endpoints

#### Creating/Updating Campaigns

**Endpoint**: `POST /api/campaigns` (create) or `PUT /api/campaigns/:id` (update)

**Frontend Hook**: `useCreateCampaign()`, `useUpdateCampaign(id)`

**File**: `astronote-retail-frontend/src/hooks/api/useCampaigns.ts`

**Request**:
```typescript
{
  name: string;
  messageText?: string;
  templateId?: number;
  filterGender?: GenderFilter;
  filterAgeGroup?: AgeGroupFilter;
  scheduledDate?: string;  // "YYYY-MM-DD"
  scheduledTime?: string;  // "HH:mm"
}
```

**Response**:
```typescript
{
  id: number;
  name: string;
  status: CampaignStatus;
  // ... other fields
}
```

---

#### Enqueuing Campaigns

**Endpoint**: `POST /api/campaigns/:id/enqueue`

**Frontend Hook**: `useEnqueueCampaign(id)`

**Request**: No body (campaign ID in URL)

**Response**:
```json
{
  "ok": true,
  "created": 10000,
  "enqueuedJobs": 10000,
  "campaignId": 123
}
```

**Frontend Usage** (`src/pages/CreateCampaign.tsx`):

```typescript
const enqueueExisting = useEnqueueCampaign(form.id ?? 0);

// In sendNow():
await enqueueExisting.mutateAsync(); // No args (hook is id-bound)
```

---

#### Fetching Campaign Status & Metrics

**Endpoint**: `GET /api/campaigns/:id/status`

**Frontend Hook**: `useCampaignStatus(id)`

**Response**:
```typescript
{
  campaign: BackendCampaign;
  metrics: {
    queued: number;
    success: number;      // Successfully sent (Phase 2.2)
    processed: number;    // Processed (success + failed) (Phase 2.2)
    failed: number;       // Failed (Phase 2.2)
  };
}
```

**Frontend Usage** (`src/pages/CampaignDetails.tsx`):

```typescript
const { data: statusSummary } = useCampaignStatus(campaignId);

// Display metrics
<div>
  <span>Success: {statusSummary?.metrics.success ?? 0}</span>
  <span>Processed: {statusSummary?.metrics.processed ?? 0}</span>
  <span>Failed: {statusSummary?.metrics.failed ?? 0}</span>
</div>
```

**Polling**: Frontend polls this endpoint every few seconds to show real-time progress

---

#### Sending Automations/Test Messages

**Automations**:
- **Endpoint**: `POST /api/automations/:id/trigger` (internal, triggered by events)
- **Frontend**: No direct UI (automated)

**Test Messages**:
- **Endpoint**: `POST /api/campaigns/test` (if implemented)
- **Frontend**: Manual test send from UI

---

### Expected Response Shapes & Status Values

#### Campaign Status Enum

**Backend** (`prisma/schema.prisma`):
```prisma
enum CampaignStatus {
  draft
  scheduled
  sending
  paused
  completed
  failed
}
```

**Frontend** (`src/hooks/api/useCampaigns.ts`):
```typescript
export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "paused"
  | "completed"
  | "failed";
```

**Status Transitions**:
- `draft` → `scheduled` (when scheduled)
- `draft` → `sending` (when enqueued)
- `scheduled` → `sending` (when scheduler triggers)
- `sending` → `completed` (when all messages processed)
- `sending` → `failed` (if campaign fails)
- `sending` → `paused` (if paused)

---

#### Message Status Enum

**Backend**:
```prisma
enum MessageStatus {
  queued
  sent
  failed
}
```

**Frontend**: Same enum (aligned)

---

### Polling & Real-Time Updates

**Current Implementation**:

**Polling** (`src/hooks/api/useCampaigns.ts`):

```typescript
export function useCampaignStatus(campaignId: number) {
  return useQuery({
    queryKey: qk.campaignStatus(campaignId),
    queryFn: async () => {
      const res = await api.get<StatusSummary>(`/api/campaigns/${campaignId}/status`);
      return res.data;
    },
    enabled: !!campaignId,
    refetchInterval: (data) => {
      // Poll every 3 seconds if campaign is still sending
      if (data?.campaign.status === 'sending') {
        return 3000;
      }
      // Stop polling if completed or failed
      return false;
    }
  });
}
```

**Behavior**:
- Polls every 3 seconds while `status === 'sending'`
- Stops polling when `status === 'completed'` or `status === 'failed'`
- Updates UI automatically via React Query

**Future Enhancement**: WebSocket for real-time updates (not implemented yet)

---

### FE/BE Adjustments & Bug Fixes

#### Changes Made During Integration

1. **Phase 2.2 Metrics Update**:
   - **Frontend**: Updated `StatusSummary` type to include `success` and `processed`
   - **Frontend**: Updated `CampaignDetails.tsx` to display new metrics
   - **Backend**: Updated `/api/campaigns/:id/status` to return new metrics

2. **Merge Tags UI**:
   - **Frontend**: Added merge tags dropdown to `CreateCampaign.tsx`
   - **Frontend**: Added merge tags dropdown to `EditAutomationModal.tsx`
   - **Fix**: Resolved "Cannot access 'f' before initialization" error

3. **Type Alignment**:
   - **Frontend**: Ensured `CampaignStatus` enum matches backend
   - **Frontend**: Ensured `MessageStatus` enum matches backend
   - **Frontend**: Aligned request/response types

---

## 9. Migration Notes – From Old to New

### Removed/Deprecated Code

#### Old Campaign Send Logic

**Removed**: Single-message loop in campaign enqueue

**Before**:
```javascript
// Legacy (removed)
for (const contact of contacts) {
  await sendSingle({
    destination: contact.phone,
    text: messageText
  });
  // Update DB, debit credit
}
```

**After**: All campaigns use bulk endpoint via queue + worker

---

#### Legacy Bulk Functions

**Deprecated**: `sendBulkStatic()` in `mitto.service.js`

**Status**: Still exists for backward compatibility, but **not used for campaigns**

**Current Usage**: Only for legacy code paths (if any)

**Recommendation**: Can be removed in future cleanup

---

#### Feature Flags Removed

**Removed**: `USE_BULK_SMS` toggle for campaigns

**Before**:
```javascript
if (USE_BULK_SMS && toEnqueue.length > 0) {
  // Bulk logic
} else {
  // Individual send fallback
}
```

**After**:
```javascript
// Campaigns always use bulk
if (toEnqueue.length > 0) {
  // Always bulk logic
}
```

**Files Modified**:
- `apps/api/src/services/campaignEnqueue.service.js` - Removed toggle check
- `apps/worker/src/sms.worker.js` - Removed toggle check

---

### Database Migrations

#### New Fields Added

**Migration**: `20250124000000_add_bulk_id_to_campaign_message`

**Changes**:
```sql
ALTER TABLE "CampaignMessage" ADD COLUMN "bulkId" TEXT;
CREATE INDEX "CampaignMessage_bulkId_idx" ON "CampaignMessage"("bulkId");
```

**Purpose**: Track which batch a message belongs to

---

**Migration**: `20250124000001_add_retry_count_to_campaign_message`

**Changes**:
```sql
ALTER TABLE "CampaignMessage" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
```

**Purpose**: Track retry attempts for idempotency

---

**Migration**: `20250124000002_add_processed_to_campaign`

**Changes**:
```sql
ALTER TABLE "Campaign" ADD COLUMN "processed" INTEGER NOT NULL DEFAULT 0;
```

**Purpose**: Store processed count (sent + failed) for Phase 2.2 metrics

---

#### Index Changes

**New Indexes**:
- `CampaignMessage.bulkId` - For batch-level queries
- `CampaignMessage.retryCount` - For retry tracking (implicit via status)

**Existing Indexes** (maintained):
- `CampaignMessage.providerMessageId` - For DLR webhook lookups
- `CampaignMessage.status` - For status filtering
- `CampaignMessage.[ownerId, campaignId]` - For common queries

---

### Code Migration Path

#### For Developers

**If you see old code patterns**:

1. **Single-message loops in campaigns**: ❌ **Removed** - Use bulk endpoint
2. **`USE_BULK_SMS` checks**: ❌ **Removed** - Campaigns always bulk
3. **`sendBulkStatic()` calls**: ⚠️ **Deprecated** - Use `sendBulkMessages()`
4. **Dynamic batch sizing**: ❌ **Removed** - Use fixed `SMS_BATCH_SIZE`

**New patterns**:

1. **Campaigns**: Always use `enqueueCampaign()` → queue → worker → `sendBulkMessages()`
2. **Automations**: Use `sendSMSWithCredits()` → `sendSingle()`
3. **Batch size**: Use `SMS_BATCH_SIZE` environment variable (default: 5000)

---

## 10. Known Limitations & Future Improvements

### Known Limitations

#### 1. Rate Limit Handling

**Current**: Rate limit errors are retryable with exponential backoff

**Limitation**: After max attempts (5), entire batch is marked as failed

**Impact**: Temporary rate limit spikes can cause permanent failures if they persist

**Mitigation**: 
- Exponential backoff gives time for limits to reset
- Max attempts prevents infinite retries
- Can manually retry failed campaigns

**Future**: Consider adaptive rate limiting or longer backoff for rate limits

---

#### 2. Partial Failure Tracking

**Current**: Partial failures in bulk are tracked per message

**Limitation**: No automatic selective retry for failed messages within a batch

**Impact**: If 10 messages fail in a 5000-message batch, those 10 are marked as failed (no automatic retry)

**Mitigation**: 
- Failed messages are clearly identified
- Can manually retry failed messages
- DLR webhooks update statuses automatically

**Future**: Consider automatic retry queue for failed messages within successful batches

---

#### 3. Real-Time Updates

**Current**: Frontend polls `/api/campaigns/:id/status` every 3 seconds

**Limitation**: Not true real-time (3-second delay)

**Impact**: UI updates with slight delay

**Mitigation**: 3-second polling is acceptable for most use cases

**Future**: WebSocket or Server-Sent Events for real-time updates

---

#### 4. Automation Volume

**Current**: Automations use 1→1 sends (synchronous)

**Limitation**: If automation volume grows significantly, this could become a bottleneck

**Impact**: High-volume automations (e.g., batch birthday sends) would be slow

**Mitigation**: Current volume is low, 1→1 is appropriate

**Future**: Migrate automations to bulk endpoint if volume grows

---

#### 5. Status Refresh

**Current**: Periodic status refresh via `statusRefresh.worker.js`

**Limitation**: Relies on polling Mitto API (not just webhooks)

**Impact**: Some status updates may be delayed

**Mitigation**: 
- DLR webhooks provide real-time updates
- Status refresh is a backup mechanism

**Future**: Improve webhook reliability, reduce polling dependency

---

### Planned Improvements

#### 1. Rate Limit Retry Enhancements

**Proposal**: Adaptive rate limiting

- Detect rate limit patterns
- Automatically adjust batch size or concurrency
- Longer backoff specifically for rate limits

**Status**: Not scheduled

---

#### 2. Automation Bulk Migration

**Proposal**: Unify automations with bulk flow

- If automation volume grows, migrate to bulk endpoint
- Batch birthday sends (e.g., all birthdays on a given day)
- Use queue + worker for automations

**Status**: Not scheduled (current volume is acceptable)

---

#### 3. Monitoring & APM Enhancements

**Proposal**: Enhanced observability

- Detailed metrics dashboard
- Alerting for rate limits, failures
- Performance monitoring (batch processing times, queue depth)
- Cost tracking per campaign

**Status**: Not scheduled

---

#### 4. Selective Retry for Partial Failures

**Proposal**: Automatic retry for failed messages

- Queue failed messages from successful batches
- Automatic retry with backoff
- Configurable retry policy

**Status**: Not scheduled

---

#### 5. Real-Time Updates (WebSocket)

**Proposal**: WebSocket for campaign progress

- Real-time status updates
- No polling overhead
- Better user experience

**Status**: Not scheduled

---

## Appendix: Key Files Reference

### Backend Services

- `apps/api/src/services/campaignEnqueue.service.js` - Campaign enqueue logic
- `apps/api/src/services/smsBulk.service.js` - Bulk SMS with credits
- `apps/api/src/services/sms.service.js` - Single SMS with credits
- `apps/api/src/services/mitto.service.js` - Mitto API integration
- `apps/api/src/services/rateLimiter.service.js` - Rate limiting
- `apps/api/src/services/campaignAggregates.service.js` - Metrics calculation
- `apps/api/src/services/automation.service.js` - Automation triggers

### Workers

- `apps/worker/src/sms.worker.js` - Main SMS worker
- `apps/worker/src/scheduler.worker.js` - Scheduled campaigns
- `apps/worker/src/statusRefresh.worker.js` - Status updates

### Routes

- `apps/api/src/routes/campaigns.js` - Campaign endpoints
- `apps/api/src/routes/automations.js` - Automation endpoints
- `apps/api/src/routes/mitto.webhooks.js` - DLR webhooks

### Frontend

- `astronote-retail-frontend/src/pages/CreateCampaign.tsx` - Campaign creation
- `astronote-retail-frontend/src/pages/CampaignDetails.tsx` - Campaign details
- `astronote-retail-frontend/src/hooks/api/useCampaigns.ts` - Campaign API hooks

### Database

- `prisma/schema.prisma` - Database schema
- `prisma/migrations/` - Migration files

---

## Document History

- **2025-01-24**: Initial comprehensive documentation created
- **2025-01-24**: Phase 2 improvements documented (rate limit retry, metrics clarity)

---

**Last Updated**: 2025-01-24  
**Status**: Production-Ready  
**Version**: 1.0

