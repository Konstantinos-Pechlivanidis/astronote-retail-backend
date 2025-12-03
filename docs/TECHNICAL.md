# Backend Technical Documentation

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Main Modules and Responsibilities](#main-modules-and-responsibilities)
3. [Endpoints and Request/Response Patterns](#endpoints-and-requestresponse-patterns)
4. [Data Flows and Key Entities](#data-flows-and-key-entities)
5. [External Dependencies and Integrations](#external-dependencies-and-integrations)
6. [Redis Configuration](#redis-configuration)
7. [Security and Best Practices](#security-and-best-practices)

---

## Architecture Overview

The backend is a **Node.js/Express.js REST API** with the following core technologies:

- **Runtime**: Node.js
- **Framework**: Express.js 5.x
- **ORM**: Prisma (PostgreSQL)
- **Cache/Queue**: Redis (via ioredis)
- **Job Queue**: BullMQ
- **Logging**: Pino
- **Authentication**: JWT (access + refresh tokens)

### High-Level Architecture

```
┌─────────────┐
│   Client    │
│  (Frontend) │
└──────┬──────┘
       │ HTTP/REST
       ▼
┌─────────────────────────────────────┐
│         Express API Server           │
│  ┌───────────────────────────────┐  │
│  │   Routes (Auth, Contacts,     │  │
│  │    Campaigns, NFC, etc.)     │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │   Services (Business Logic)   │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │   Middleware (Auth, Rate      │  │
│  │    Limiting, Logging)         │  │
│  └───────────────────────────────┘  │
└──────┬──────────────────────────┬───┘
       │                          │
       ▼                          ▼
┌─────────────┐          ┌─────────────┐
│ PostgreSQL  │          │    Redis     │
│  (Prisma)   │          │ (Cache/Queue)│
└─────────────┘          └──────┬───────┘
                                │
                                ▼
                         ┌─────────────┐
                         │   BullMQ    │
                         │   Workers   │
                         └─────────────┘
```

---

## Main Modules and Responsibilities

### 1. Server Entry Point (`apps/api/src/server.js`)

**Responsibilities:**
- Express app initialization
- Middleware setup (CORS, Helmet, body parsing, logging)
- Route mounting
- Error handling
- Graceful shutdown

**Key Features:**
- Trust proxy configuration for reverse proxies
- Pino HTTP logging middleware
- CORS allowlist from environment variables
- Centralized error handler

### 2. Routes (`apps/api/src/routes/`)

Route handlers organized by domain:

#### Authentication (`auth.js`)
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login (returns access + refresh tokens)
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout (revoke refresh token)
- Rate limiting: Login (20/min IP, 8/min email), Register (5/min IP, 2/min email)

#### Contacts (`contacts.js`)
- `POST /api/contacts` - Create contact (protected)
- `GET /api/contacts` - List contacts with pagination/search (protected)
- `GET /api/contacts/:id` - Get contact by ID (protected)
- `PUT /api/contacts/:id` - Update contact (protected)
- `DELETE /api/contacts/:id` - Delete contact (protected)
- `POST /api/contacts/unsubscribe` - Public unsubscribe endpoint
- Rate limiting: Write ops (60/min IP), Unsubscribe (20/min IP, 5/24h per token)

#### Lists (`lists.js`)
- CRUD operations for contact lists
- List membership management

#### Templates (`templates.js`)
- CRUD operations for message templates
- Template variables: `{{firstName}}`, `{{lastName}}`, `{{email}}`

#### Campaigns (`campaigns.js`)
- `POST /api/campaigns` - Create campaign (draft or scheduled)
- `GET /api/campaigns` - List campaigns (paginated)
- `GET /api/campaigns/:id` - Get campaign details
- `GET /api/campaigns/:id/preview` - Preview rendered messages
- `POST /api/campaigns/:id/enqueue` - Enqueue campaign for sending
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign

#### Campaign Stats (`campaigns.stats.js`)
- `GET /api/v1/campaigns/:id/stats` - Campaign statistics (cached)

#### Campaign List (`campaigns.list.js`)
- `GET /api/v1/campaigns` - Optimized campaign listing (cached)

#### Billing (`billing.js`)
- Wallet balance operations
- Package management
- Purchase history

#### Tracking (`tracking.js`)
- `GET /tracking/redeem/:trackingId` - Public: Check redemption status
- `POST /tracking/redeem` - Protected: Redeem QR code/link

#### NFC (`nfc.js`) - **NEW**
- `GET /nfc/:publicId/config` - Public: Get NFC tag configuration
- `POST /nfc/:publicId/submit` - Public: Submit NFC form (create/update contact)
- Rate limiting: Config (60/min IP), Submit (30/min IP, 5/hour per phone)

#### Webhooks (`mitto.webhooks.js`)
- `POST /webhooks/mitto` - Receive SMS delivery status webhooks from Mitto

#### Health (`health.js`)
- `GET /health` - Health check endpoint

#### Documentation (`docs.js`)
- `GET /docs` - Swagger UI
- `GET /openapi.json` - OpenAPI specification

### 3. Services (`apps/api/src/services/`)

Business logic layer:

#### `campaignEnqueue.service.js`
- Enqueue campaign for sending
- Create campaign messages
- Debit wallet credits
- Enqueue SMS jobs to BullMQ

#### `wallet.service.js`
- Credit/debit operations
- Transaction logging
- Balance management

#### `mitto.service.js`
- SMS sending via Mitto API
- Message formatting

#### `nfc.service.js` - **NEW**
- `resolveNfcTag(publicId)` - Resolve NFC tag by public identifier
- `getNfcConfig(publicId)` - Get configuration for frontend
- `createOrUpdateContactFromNfc(...)` - Contact merge logic
- `recordNfcScan(...)` - Analytics tracking

#### `campaignStats.service.js`
- Calculate campaign statistics (sent, delivered, failed, redemptions)

#### `campaignsList.service.js`
- Optimized campaign listing with caching

### 4. Libraries (`apps/api/src/lib/`)

Shared utilities:

#### `prisma.js`
- Prisma client singleton (prevents multiple instances in dev)

#### `jwt.js`
- JWT token generation and verification
- Access token (short-lived)
- Refresh token (long-lived)

#### `passwords.js`
- Password hashing (bcrypt)
- Password validation

#### `cache.js`
- Redis cache wrapper (safe no-ops if Redis disabled)
- `cacheGet(key)`, `cacheSet(key, value, ttl)`, `cacheDel(key)`, `cacheDelPrefix(prefix)`

#### `ratelimit.js`
- Rate limiting using `rate-limiter-flexible`
- Redis-backed (falls back to in-memory)
- `createLimiter(options)`, `rateLimitByIp(limiter)`, `rateLimitByKey(limiter, keyFn)`

#### `redis.js` - **NEW**
- Centralized Redis client factory
- Environment variable configuration
- Connection pooling and error handling
- Graceful shutdown support

#### `policies.js`
- Authorization helpers
- `scoped(ownerId)` - Generate Prisma where clause for tenant isolation

### 5. Middleware (`apps/api/src/middleware/`)

#### `requireAuth.js`
- JWT authentication middleware
- Extracts user from access token
- Sets `req.user = { id, email }`

### 6. Queues (`apps/api/src/queues/`)

BullMQ queue definitions:

#### `sms.queue.js`
- SMS sending queue
- Retry logic (exponential backoff)
- Rate limiting (20 jobs/second)

#### `scheduler.queue.js`
- Campaign scheduling queue
- Delayed job execution

### 7. Workers (`apps/worker/src/`)

Background job processors:

#### `sms.worker.js`
- Process SMS sending jobs
- Update message status
- Handle failures and refunds

#### `scheduler.worker.js`
- Process scheduled campaign jobs
- Trigger campaign enqueue

---

## Endpoints and Request/Response Patterns

### Authentication

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}

Response: 201 Created
{
  "user": { "id": 1, "email": "user@example.com" },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}

Response: 200 OK
{
  "user": { "id": 1, "email": "user@example.com" },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..." // Also set as HTTP-only cookie
}
```

#### Refresh Token
```http
POST /api/auth/refresh
Cookie: rt=refresh_token_here

Response: 200 OK
{
  "accessToken": "eyJ..."
}
```

### Contacts

#### Create Contact
```http
POST /api/contacts
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "phone": "+1234567890",
  "email": "contact@example.com",
  "firstName": "John",
  "lastName": "Doe"
}

Response: 201 Created
{
  "id": 1,
  "ownerId": 1,
  "phone": "+1234567890",
  "email": "contact@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "isSubscribed": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

#### List Contacts
```http
GET /api/contacts?page=1&pageSize=20&q=john&isSubscribed=true
Authorization: Bearer {accessToken}

Response: 200 OK
{
  "items": [...],
  "total": 100,
  "page": 1,
  "pageSize": 20
}
```

### Campaigns

#### Create Campaign
```http
POST /api/campaigns
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "name": "Summer Sale",
  "templateId": 1,
  "listId": 1,
  "scheduledAt": "2024-06-01T10:00:00Z" // Optional
}

Response: 201 Created
{
  "id": 1,
  "name": "Summer Sale",
  "status": "draft", // or "scheduled"
  "total": 0,
  "sent": 0,
  "failed": 0,
  ...
}
```

#### Enqueue Campaign
```http
POST /api/campaigns/1/enqueue
Authorization: Bearer {accessToken}

Response: 200 OK
{
  "ok": true,
  "created": 150,
  "enqueuedJobs": 150,
  "campaignId": 1
}
```

### NFC Endpoints - **NEW**

#### Get NFC Configuration
```http
GET /nfc/{publicId}/config

Response: 200 OK
{
  "tag": {
    "id": 1,
    "publicId": "abc123xyz",
    "label": "Checkout Desk 1",
    "status": "active"
  },
  "store": {
    "id": 1,
    "name": "My Store",
    "email": "store@example.com"
  },
  "campaign": {
    "id": 1,
    "name": "Welcome Campaign",
    "status": "draft"
  },
  "formConfig": {
    "fields": {
      "phone": { "required": true, "type": "tel" },
      "email": { "required": false, "type": "email" },
      "firstName": { "required": false, "type": "text" },
      "lastName": { "required": false, "type": "text" }
    },
    "consentText": "I consent to receive marketing communications.",
    "language": "en"
  }
}
```

#### Submit NFC Form
```http
POST /nfc/{publicId}/submit
Content-Type: application/json

{
  "phone": "+1234567890",
  "email": "customer@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "consent": true
}

Response: 201 Created (or 200 OK if updated)
{
  "success": true,
  "contact": {
    "id": 1,
    "phone": "+1234567890",
    "email": "customer@example.com",
    "firstName": "Jane",
    "lastName": "Smith"
  },
  "action": "created", // or "updated"
  "discountCode": null // Future feature
}
```

---

## Data Flows and Key Entities

### Core Data Flow: Campaign → Messages → SMS

```
1. User creates Campaign
   └─> Campaign (status: draft)

2. User enqueues Campaign
   └─> Campaign (status: sending)
   └─> Debit Wallet (credits = contact count)
   └─> Create CampaignMessage records (status: queued)
   └─> Enqueue BullMQ jobs

3. Worker processes SMS job
   └─> Call Mitto API
   └─> Update CampaignMessage (status: sent, providerMessageId)
   └─> Update Campaign (sent count)

4. Mitto webhook received
   └─> Update CampaignMessage (status: delivered/failed)
   └─> Update Campaign (delivered/failed count)
```

### NFC Opt-in Flow - **NEW**

```
1. Customer taps NFC tag
   └─> Opens frontend URL: /nfc/{publicId}

2. Frontend calls GET /nfc/{publicId}/config
   └─> Backend resolves tag → store → campaign
   └─> Record NfcScan (status: opened)
   └─> Return configuration

3. Customer fills form and submits
   └─> Frontend calls POST /nfc/{publicId}/submit

4. Backend processes submission
   └─> Validate inputs
   └─> Check for existing contact (by phone in store)
   └─> Create or update contact
   └─> Add NFC metadata to contact
   └─> Record NfcScan (status: submitted)
   └─> Return success

5. Contact is now available for campaigns
   └─> Can be added to lists
   └─> Can receive campaign messages
```

### Key Entities

#### User (Store/Tenant)
- Represents a store/tenant in the system
- Multi-tenant isolation via `ownerId` on all resources
- Fields: `id`, `email`, `passwordHash`, `senderName`, `company`

#### Contact
- Customer contact information
- Scoped to User (`ownerId`)
- Unique per store by phone: `[ownerId, phone]`
- Fields: `phone`, `email`, `firstName`, `lastName`, `isSubscribed`, `metadata` (JSON)
- **Metadata** can store NFC-related data: `{ nfc: { source: 'nfc', tagId, campaignId, ... } }`

#### List
- Collection of contacts
- Used for campaign targeting
- Scoped to User

#### Campaign
- SMS campaign definition
- Links: Template + List
- Status: `draft`, `scheduled`, `sending`, `paused`, `completed`, `failed`
- Tracks: `total`, `sent`, `failed`

#### CampaignMessage
- Individual SMS message in a campaign
- Links: Campaign + Contact
- Has unique `trackingId` for QR/link redemption
- Status: `queued`, `sent`, `delivered`, `failed`

#### NfcTag - **NEW**
- NFC tag definition
- Has unique `publicId` (URL-safe identifier)
- Links to Store (User) and optional Campaign
- Status: `active`, `inactive`, `test`
- Optional FormConfig for custom form fields

#### NfcScan - **NEW**
- Analytics record for NFC interactions
- Tracks: tag, store, contact (if submitted), status, IP, user agent
- Status: `opened`, `submitted`, `error`

#### FormConfig - **NEW**
- Form configuration for NFC tags
- Stores: fields (JSON), consent text, language
- Can be shared across multiple NFC tags

#### Wallet
- Credit balance per User
- Tracks transactions (CreditTransaction)

---

## External Dependencies and Integrations

### PostgreSQL
- **Purpose**: Primary database
- **ORM**: Prisma
- **Connection**: `DATABASE_URL` (pooled), `DIRECT_DATABASE_URL` (migrations)
- **Migrations**: Prisma Migrate

### Redis
- **Purpose**: Caching, rate limiting, job queues
- **Client**: ioredis
- **Configuration**: See [Redis Configuration](#redis-configuration)
- **Usage**:
  - Cache: Campaign stats, campaign lists
  - Rate limiting: All public/protected endpoints
  - Queues: BullMQ connection

### BullMQ
- **Purpose**: Background job processing
- **Queues**: SMS sending, campaign scheduling
- **Workers**: Separate worker processes (`apps/worker/`)

### Mitto SMS API
- **Purpose**: SMS delivery provider
- **Integration**: `apps/api/src/services/mitto.service.js`
- **Webhooks**: `apps/api/src/routes/mitto.webhooks.js`
- **Events**: Delivery status updates

---

## Redis Configuration

### Environment Variables

The Redis client is configured via environment variables with fallback support:

**Individual Variables:**
- `REDIS_HOST` (default: `localhost`)
- `REDIS_PORT` (default: `6379`)
- `REDIS_USERNAME` (optional)
- `REDIS_PASSWORD` (optional)
- `REDIS_DB` (default: `0`)
- `REDIS_TLS` (`true`/`false`, default: `false`)

**Fallback:**
- `REDIS_URL` - Full connection string: `redis://[username]:[password]@host:port[/db]`

**Disable Redis:**
- Set `REDIS_URL=disabled` to disable Redis (falls back to in-memory rate limiting)

### Key Naming Conventions

- **Cache**: `cache:{resource}:{id}` or `cache:{resource}:v{version}:{ownerId}:{id}`
  - Example: `cache:stats:campaign:v1:1:5`
- **Rate Limiting**: `rl:{scope}:{key}`
  - Example: `rl:nfc:submit:ip:192.168.1.1`
- **Queues**: Managed by BullMQ (automatic)

### Connection Management

- **Singleton Pattern**: Single Redis client instance shared across modules
- **Lazy Connection**: Connects on first use
- **Error Handling**: Graceful fallback if Redis unavailable
- **Reconnection**: Automatic retry with exponential backoff
- **Graceful Shutdown**: Closes connection on app termination

### Usage Examples

```javascript
// Cache
const { cacheGet, cacheSet } = require('./lib/cache');
await cacheSet('cache:user:1', JSON.stringify(user), 300); // 5min TTL
const cached = await cacheGet('cache:user:1');

// Rate Limiting
const { createLimiter, rateLimitByIp } = require('./lib/ratelimit');
const limiter = createLimiter({ keyPrefix: 'rl:api', points: 100, duration: 60 });
router.use(rateLimitByIp(limiter));
```

---

## Security and Best Practices

### Authentication
- JWT access tokens (short-lived)
- Refresh tokens (long-lived, HTTP-only cookies)
- Token rotation on refresh

### Authorization
- Multi-tenant isolation via `ownerId` scoping
- All queries filtered by `ownerId`
- No cross-tenant data access

### Rate Limiting
- IP-based rate limiting on all endpoints
- Additional per-email/per-phone limits on sensitive endpoints
- Redis-backed (shared across instances)

### Input Validation
- Phone number validation (basic format check)
- Email validation
- Required field checks
- SQL injection prevention (Prisma parameterized queries)

### Error Handling
- Centralized error handler
- No sensitive data in error messages
- Proper HTTP status codes
- Logging of errors (Pino)

### Security Headers
- Helmet.js for security headers
- CORS allowlist configuration
- Trust proxy for reverse proxies

### Data Privacy
- Unsubscribe tokens (hashed in database)
- Consent tracking (NFC forms)
- GDPR considerations (consent text, timestamps)

### Best Practices
- Environment variables for all configuration
- No hardcoded secrets
- Graceful shutdown
- Connection pooling
- Transaction safety (Prisma transactions)
- Idempotent operations where possible

---

## Development

### Running the API
```bash
cd apps/api
npm run dev  # Development with watch mode
npm start    # Production
```

### Running Workers
```bash
cd apps/worker
node src/sms.worker.js
node src/scheduler.worker.js
```

### Database Migrations
```bash
npm run prisma:migrate    # Create and apply migration
npm run prisma:generate   # Generate Prisma client
npm run prisma:studio     # Open Prisma Studio
```

### Environment Variables
See `.env.example` for required variables (create if needed).

---

## Future Enhancements

- Discount code generation for NFC opt-ins
- Welcome automation triggers
- Advanced phone number validation (libphonenumber-js)
- Enhanced analytics dashboard
- Multi-language form support
- A/B testing for NFC forms

