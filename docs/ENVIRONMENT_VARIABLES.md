# Environment Variables - Complete Reference

**Last Updated**: 2025-01-24  
**Application**: astronote-retail-backend

This document provides a comprehensive list of all environment variables required and optional for deploying the Retail backend application.

---

## Table of Contents

1. [Required Variables](#required-variables)
2. [Database Configuration](#database-configuration)
3. [Redis Configuration](#redis-configuration)
4. [Authentication & Security](#authentication--security)
5. [Mitto SMS API](#mitto-sms-api)
6. [Stripe Payment Integration](#stripe-payment-integration)
7. [Frontend URLs](#frontend-urls)
8. [Queue & Worker Configuration](#queue--worker-configuration)
9. [Rate Limiting](#rate-limiting)
10. [Status Refresh](#status-refresh)
11. [Server Configuration](#server-configuration)
12. [System Configuration](#system-configuration)
13. [Development & Testing](#development--testing)

---

## Required Variables

These variables **must** be set for the application to function correctly in production.

### Database

```bash
# PostgreSQL Database Connection (Pooled - for runtime queries)
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# PostgreSQL Database Connection (Direct - for migrations)
DIRECT_DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
```

**Description**:
- `DATABASE_URL`: Used by Prisma Client for runtime database queries (pooled connection)
- `DIRECT_DATABASE_URL`: Used by Prisma Migrate for running migrations (direct connection, no pooling)

**Note**: Both URLs typically point to the same database, but `DIRECT_DATABASE_URL` bypasses connection pooling for migrations.

---

### Redis

```bash
# Redis Connection URL (preferred method)
REDIS_URL=redis://username:password@host:port/db

# OR use individual Redis connection parameters (alternative)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=          # Optional
REDIS_PASSWORD=          # Optional
REDIS_DB=0               # Optional, default: 0
REDIS_TLS=false          # Optional, default: false (set to 'true' or '1' for TLS)
```

**Description**:
- `REDIS_URL`: Complete Redis connection string (preferred for cloud providers)
- Individual parameters: Alternative method if `REDIS_URL` is not provided
- Used for: BullMQ queues, rate limiting, distributed caching

**Note**: If `REDIS_URL` is set to `'disabled'`, Redis features are disabled (not recommended for production).

---

### Authentication & Security

```bash
# JWT Secret Key (REQUIRED)
JWT_SECRET=your-secret-key-change-in-production

# Unsubscribe Token Secret (REQUIRED)
UNSUBSCRIBE_TOKEN_SECRET=your-unsubscribe-secret-change-in-production
```

**Description**:
- `JWT_SECRET`: Secret key for signing and verifying JWT access tokens
- `UNSUBSCRIBE_TOKEN_SECRET`: Secret key for generating and verifying unsubscribe tokens

**Security**: **CRITICAL** - Use strong, random secrets in production. Never commit these to version control.

---

### Mitto SMS API

```bash
# Mitto API Key (REQUIRED)
MITTO_API_KEY=your-mitto-api-key

# Traffic Account ID (REQUIRED)
SMS_TRAFFIC_ACCOUNT_ID=your-traffic-account-id
# OR
MITTO_TRAFFIC_ACCOUNT_ID=your-traffic-account-id  # Alternative name
```

**Description**:
- `MITTO_API_KEY`: API key for authenticating with Mitto SMS API
- `SMS_TRAFFIC_ACCOUNT_ID` or `MITTO_TRAFFIC_ACCOUNT_ID`: Traffic account ID for bulk SMS sending

**Note**: Both `SMS_TRAFFIC_ACCOUNT_ID` and `MITTO_TRAFFIC_ACCOUNT_ID` are supported (whichever is set will be used).

---

### Stripe Payment Integration

```bash
# Stripe Secret Key (REQUIRED for billing features)
STRIPE_SECRET_KEY=sk_live_...  # or sk_test_... for testing

# Stripe Webhook Secret (REQUIRED for webhook verification)
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Description**:
- `STRIPE_SECRET_KEY`: Stripe API secret key (use `sk_live_...` for production, `sk_test_...` for testing)
- `STRIPE_WEBHOOK_SECRET`: Secret for verifying Stripe webhook signatures

**Note**: If `STRIPE_SECRET_KEY` is not set, Stripe features are disabled (billing will not work).

---

### Frontend URLs

```bash
# Base Frontend URL (REQUIRED)
FRONTEND_URL=https://astronote-retail-frontend.onrender.com

# Alternative names (fallback if FRONTEND_URL not set)
APP_URL=https://astronote-retail-frontend.onrender.com
WEB_APP_URL=https://astronote-retail-frontend.onrender.com
```

**Description**:
- `FRONTEND_URL`: Base URL of the Retail frontend application
- Used for: Payment redirects, unsubscribe links, offer links
- `APP_URL` and `WEB_APP_URL`: Alternative names (used as fallback if `FRONTEND_URL` is not set)

---

## Optional Variables

These variables have sensible defaults but can be customized for your environment.

### Database Configuration

No additional optional variables for database (all required variables are listed above).

---

### Redis Configuration

```bash
# Redis Connection (see Required Variables section)
# Additional optional parameters:
REDIS_TLS=true           # Enable TLS (default: false)
REDIS_DB=0               # Database number (default: 0)
```

---

### Authentication & Security

```bash
# JWT Access Token TTL (Time To Live)
JWT_ACCESS_TTL=15m       # Default: '15m' (15 minutes)

# JWT Refresh Token TTL
JWT_REFRESH_TTL=30d      # Default: '30d' (30 days)
```

**Description**:
- `JWT_ACCESS_TTL`: Expiration time for access tokens (format: `15m`, `1h`, `1d`, etc.)
- `JWT_REFRESH_TTL`: Expiration time for refresh tokens (format: `30d`, `90d`, etc.)

---

### Mitto SMS API

```bash
# Mitto API Base URL
MITTO_API_BASE=https://messaging.mittoapi.com  # Default

# Fallback Sender Name
MITTO_SENDER=YourSenderName  # Optional, used if user has no sender configured
```

**Description**:
- `MITTO_API_BASE`: Base URL for Mitto API (usually no need to change)
- `MITTO_SENDER`: Fallback sender name if user has no sender configured in their profile

---

### Stripe Payment Integration

```bash
# Stripe Price IDs (Optional - can be configured in database or via env vars)
# Format: STRIPE_PRICE_ID_{PACKAGE_NAME}_{CURRENCY}
STRIPE_PRICE_ID_BASIC_EUR=price_xxx
STRIPE_PRICE_ID_BASIC_USD=price_xxx
STRIPE_PRICE_ID_STANDARD_EUR=price_xxx
STRIPE_PRICE_ID_STANDARD_USD=price_xxx
# ... etc for each package and currency

# Subscription Price IDs
STRIPE_PRICE_ID_SUB_STARTER_EUR=price_xxx
STRIPE_PRICE_ID_SUB_STARTER_USD=price_xxx
STRIPE_PRICE_ID_SUB_PRO_EUR=price_xxx
STRIPE_PRICE_ID_SUB_PRO_USD=price_xxx

# Credit Top-up Price ID
STRIPE_PRICE_ID_CREDIT_TOPUP_EUR=price_xxx
STRIPE_PRICE_ID_CREDIT_TOPUP_USD=price_xxx

# Generic Price IDs (fallback)
STRIPE_PRICE_ID_EUR=price_xxx
STRIPE_PRICE_ID_USD=price_xxx
```

**Description**:
- Price IDs can be configured in the database (`Package.stripePriceIdEur`, `Package.stripePriceIdUsd`) or via environment variables
- Priority: Database fields → Environment variable → null
- Format: `STRIPE_PRICE_ID_{PACKAGE_NAME}_{CURRENCY}` (package name is uppercased and special characters replaced with `_`)

---

### Frontend URLs

```bash
# Unsubscribe Base URL (optional, falls back to FRONTEND_URL)
UNSUBSCRIBE_BASE_URL=https://astronote-retail-frontend.onrender.com

# Offer Base URL (optional, falls back to FRONTEND_URL)
OFFER_BASE_URL=https://astronote-retail-frontend.onrender.com
```

**Description**:
- `UNSUBSCRIBE_BASE_URL`: Base URL for unsubscribe links (defaults to `FRONTEND_URL`)
- `OFFER_BASE_URL`: Base URL for offer/tracking links (defaults to `FRONTEND_URL`)

---

### Queue & Worker Configuration

```bash
# Enable/Disable Workers
START_WORKER=1            # Default: 1 (enabled), set to 0 to disable
QUEUE_DISABLED=0         # Default: 0 (enabled), set to 1 to disable

# SMS Worker Concurrency
WORKER_CONCURRENCY=5     # Default: 5 (number of batches processed simultaneously)

# Queue Retry Configuration
QUEUE_ATTEMPTS=5         # Default: 5 (max retry attempts)
QUEUE_BACKOFF_MS=3000    # Default: 3000 (exponential backoff delay in ms)

# Queue Rate Limiter (Global)
QUEUE_RATE_MAX=20        # Default: 20 (max jobs per duration)
QUEUE_RATE_DURATION_MS=1000  # Default: 1000 (duration window in ms)

# Bulk SMS Batch Size
SMS_BATCH_SIZE=5000      # Default: 5000 (fixed batch size for campaigns)

# Scheduler Worker Concurrency
SCHEDULER_CONCURRENCY=2  # Default: 2

# Status Refresh Worker Concurrency
STATUS_REFRESH_CONCURRENCY=1  # Default: 1

# Contact Import Worker Concurrency
CONTACT_IMPORT_CONCURRENCY=1  # Default: 1
```

**Description**:
- `START_WORKER`: Enable/disable worker processes (set to `0` to disable, `1` to enable)
- `QUEUE_DISABLED`: Disable all queue functionality (set to `1` to disable, `0` to enable)
- `WORKER_CONCURRENCY`: Number of SMS batches processed simultaneously by the worker
- `QUEUE_ATTEMPTS`: Maximum number of retry attempts for failed jobs
- `QUEUE_BACKOFF_MS`: Initial delay for exponential backoff retries (in milliseconds)
- `QUEUE_RATE_MAX`: Maximum number of jobs processed per `QUEUE_RATE_DURATION_MS`
- `QUEUE_RATE_DURATION_MS`: Time window for queue rate limiting (in milliseconds)
- `SMS_BATCH_SIZE`: Fixed batch size for campaign message batching (default: 5000)
- `SCHEDULER_CONCURRENCY`: Number of scheduled jobs processed simultaneously
- `STATUS_REFRESH_CONCURRENCY`: Number of status refresh jobs processed simultaneously
- `CONTACT_IMPORT_CONCURRENCY`: Number of contact import jobs processed simultaneously

---

### Rate Limiting

```bash
# Per-Traffic-Account Rate Limiting
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100        # Default: 100 (requests per window)
RATE_LIMIT_TRAFFIC_ACCOUNT_WINDOW_MS=1000 # Default: 1000 (1 second window)

# Per-Tenant Rate Limiting
RATE_LIMIT_TENANT_MAX=50                  # Default: 50 (requests per window)
RATE_LIMIT_TENANT_WINDOW_MS=1000          # Default: 1000 (1 second window)

# Global Rate Limiting (fallback)
RATE_LIMIT_GLOBAL_MAX=200                 # Default: 200 (requests per window)
RATE_LIMIT_GLOBAL_WINDOW_MS=1000          # Default: 1000 (1 second window)
```

**Description**:
- **Per-Traffic-Account**: Limits requests per Mitto traffic account (shared across all tenants using the same account)
- **Per-Tenant**: Limits requests per tenant/owner (prevents one tenant from consuming all capacity)
- **Global**: Fallback global limit (currently not actively used, but configured)

**Note**: Both traffic account and tenant limits are checked in parallel; a request is allowed only if it passes both.

---

### Status Refresh

```bash
# Enable/Disable Status Refresh
STATUS_REFRESH_ENABLED=1        # Default: 1 (enabled), set to 0 to disable

# Status Refresh Interval
STATUS_REFRESH_INTERVAL=600000  # Default: 600000 (10 minutes in milliseconds)
```

**Description**:
- `STATUS_REFRESH_ENABLED`: Enable/disable periodic status refresh for pending messages
- `STATUS_REFRESH_INTERVAL`: Interval between status refresh runs (in milliseconds)

**Note**: Status refresh periodically checks pending message statuses from Mitto API to update delivery statuses.

---

### Server Configuration

```bash
# Server Port
PORT=3001                # Default: 3001

# Node Environment
NODE_ENV=production      # Options: 'production', 'development', 'test'

# CORS Allowlist
CORS_ALLOWLIST=https://astronote-retail-frontend.onrender.com,https://astronote-shopify-frontend.onrender.com
```

**Description**:
- `PORT`: Port number for the API server (default: 3001)
- `NODE_ENV`: Environment mode (affects error handling, logging, etc.)
- `CORS_ALLOWLIST`: Comma-separated list of allowed origins for CORS (if not set, CORS allows all origins)

---

### System Configuration

```bash
# System User ID
SYSTEM_USER_ID=1         # Default: 1 (used for system operations, templates, etc.)
```

**Description**:
- `SYSTEM_USER_ID`: User ID used for system operations (e.g., seeding templates, system-generated content)

---

### Development & Testing

```bash
# Allow Billing Seed (Development Only)
ALLOW_BILLING_SEED=0     # Default: 0 (disabled), set to 1 to enable billing seed endpoint

# Run Birthday Worker on Start (Development/Testing)
RUN_BIRTHDAY_ON_START=0  # Default: 0 (disabled), set to 1 to run birthday worker immediately on start

# Node Path (for module resolution)
NODE_PATH=./node_modules # Optional, used for worker module resolution
```

**Description**:
- `ALLOW_BILLING_SEED`: Enable billing seed endpoint (development/testing only, **disable in production**)
- `RUN_BIRTHDAY_ON_START`: Run birthday worker immediately on startup (testing only)
- `NODE_PATH`: Node.js module path (usually set automatically, but can be overridden)

---

## Environment Variable Summary

### Required for Production

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL pooled connection | `postgresql://user:pass@host:5432/db` |
| `DIRECT_DATABASE_URL` | PostgreSQL direct connection (migrations) | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://user:pass@host:6379/0` |
| `JWT_SECRET` | JWT signing secret | `your-secret-key` |
| `UNSUBSCRIBE_TOKEN_SECRET` | Unsubscribe token secret | `your-unsubscribe-secret` |
| `MITTO_API_KEY` | Mitto API key | `your-mitto-api-key` |
| `SMS_TRAFFIC_ACCOUNT_ID` | Mitto traffic account ID | `your-traffic-account-id` |
| `STRIPE_SECRET_KEY` | Stripe API secret key | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | `whsec_...` |
| `FRONTEND_URL` | Frontend base URL | `https://astronote-retail-frontend.onrender.com` |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `production` | Environment mode |
| `JWT_ACCESS_TTL` | `15m` | Access token TTL |
| `JWT_REFRESH_TTL` | `30d` | Refresh token TTL |
| `MITTO_API_BASE` | `https://messaging.mittoapi.com` | Mitto API base URL |
| `WORKER_CONCURRENCY` | `5` | SMS worker concurrency |
| `QUEUE_ATTEMPTS` | `5` | Max retry attempts |
| `QUEUE_BACKOFF_MS` | `3000` | Retry backoff delay (ms) |
| `SMS_BATCH_SIZE` | `5000` | Campaign batch size |
| `RATE_LIMIT_TRAFFIC_ACCOUNT_MAX` | `100` | Traffic account rate limit |
| `RATE_LIMIT_TENANT_MAX` | `50` | Tenant rate limit |
| `STATUS_REFRESH_ENABLED` | `1` | Enable status refresh |
| `STATUS_REFRESH_INTERVAL` | `600000` | Status refresh interval (ms) |
| `START_WORKER` | `1` | Enable workers |
| `QUEUE_DISABLED` | `0` | Disable queues |

---

## Environment-Specific Recommendations

### Production

```bash
# Required
DATABASE_URL=postgresql://...
DIRECT_DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=<strong-random-secret>
UNSUBSCRIBE_TOKEN_SECRET=<strong-random-secret>
MITTO_API_KEY=<your-api-key>
SMS_TRAFFIC_ACCOUNT_ID=<your-traffic-account-id>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=https://astronote-retail-frontend.onrender.com

# Recommended Production Settings
NODE_ENV=production
PORT=3001
WORKER_CONCURRENCY=5
SMS_BATCH_SIZE=5000
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100
RATE_LIMIT_TENANT_MAX=50
STATUS_REFRESH_ENABLED=1
START_WORKER=1
QUEUE_DISABLED=0

# Security
ALLOW_BILLING_SEED=0  # MUST be disabled in production
```

### Staging

```bash
# Same as production, but with test keys
STRIPE_SECRET_KEY=sk_test_...
MITTO_API_KEY=<test-api-key>

# Lower limits for testing
SMS_BATCH_SIZE=1000
WORKER_CONCURRENCY=2
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=50
RATE_LIMIT_TENANT_MAX=25
```

### Development

```bash
# Local database and Redis
DATABASE_URL=postgresql://localhost:5432/astronote_dev
DIRECT_DATABASE_URL=postgresql://localhost:5432/astronote_dev
REDIS_URL=redis://localhost:6379/0

# Development secrets (change in production)
JWT_SECRET=dev_secret
UNSUBSCRIBE_TOKEN_SECRET=dev-secret

# Lower limits for local testing
SMS_BATCH_SIZE=100
WORKER_CONCURRENCY=1
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=10
RATE_LIMIT_TENANT_MAX=5

# Optional: Enable development features
ALLOW_BILLING_SEED=1  # Only for development
NODE_ENV=development
```

---

## Validation Checklist

Before deploying to production, ensure:

- [ ] All **Required** variables are set
- [ ] `JWT_SECRET` and `UNSUBSCRIBE_TOKEN_SECRET` are strong, random secrets
- [ ] `DATABASE_URL` and `DIRECT_DATABASE_URL` point to the correct database
- [ ] `REDIS_URL` is configured and accessible
- [ ] `MITTO_API_KEY` and `SMS_TRAFFIC_ACCOUNT_ID` are valid
- [ ] `STRIPE_SECRET_KEY` is set (use `sk_live_...` for production)
- [ ] `FRONTEND_URL` matches your frontend deployment URL
- [ ] `ALLOW_BILLING_SEED=0` (disabled in production)
- [ ] `NODE_ENV=production` for production deployments
- [ ] All optional variables are set to desired values (or defaults are acceptable)

---

## Notes

1. **Security**: Never commit secrets to version control. Use environment variables or secret management services.

2. **Database URLs**: `DATABASE_URL` uses connection pooling, while `DIRECT_DATABASE_URL` is for migrations. Both typically point to the same database.

3. **Redis**: If `REDIS_URL` is set to `'disabled'`, queue functionality is disabled (not recommended for production).

4. **Workers**: Set `START_WORKER=0` to disable workers (useful for API-only deployments). Set `QUEUE_DISABLED=1` to disable all queue functionality.

5. **Rate Limiting**: Both traffic account and tenant limits are checked in parallel. A request is allowed only if it passes both.

6. **Stripe Price IDs**: Can be configured in the database (`Package` table) or via environment variables. Database takes priority.

7. **Frontend URLs**: `UNSUBSCRIBE_BASE_URL` and `OFFER_BASE_URL` fall back to `FRONTEND_URL` if not set.

---

## Support

For questions or issues related to environment variables, please refer to:
- `README.md` - General setup instructions
- `docs/MESSAGE_SENDING_GUIDE.md` - Message sending configuration
- `docs/TECHNICAL.md` - Technical documentation

---

**Last Updated**: 2025-01-24

