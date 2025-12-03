# Environment Variables for Render.com Deployment

This document lists all environment variables required for deploying the Astronote Retail Backend to Render.com.

## 🔴 Required Variables (Must Set)

### Database
- **`DATABASE_URL`** - PostgreSQL pooled connection string
  - Example: `postgresql://user:pass@host:5432/db?sslmode=require&pgbouncer=true`
  - Get from: Neon, Supabase, or Render PostgreSQL service

- **`DIRECT_DATABASE_URL`** - Direct PostgreSQL connection (for migrations)
  - Example: `postgresql://user:pass@host:5432/db?sslmode=require`
  - Same as DATABASE_URL but without pgbouncer

### Authentication
- **`JWT_SECRET`** - Secret key for JWT tokens (minimum 24 characters)
  - Example: `your-super-secret-key-min-24-characters-long`
  - Generate: Use a strong random string generator

- **`JWT_ACCESS_TTL`** - Access token time-to-live
  - Default: `15m`

- **`JWT_REFRESH_TTL`** - Refresh token time-to-live
  - Default: `30d`

### SMS Provider (Mitto)
- **`MITTO_API_KEY`** - Your Mitto API key
  - Get from: Mitto dashboard

- **`SMS_TRAFFIC_ACCOUNT_ID`** - Mitto traffic account ID
  - Get from: Mitto dashboard

- **`MITTO_SENDER`** - Default SMS sender number
  - Example: `+306984303406`
  - Format: E.164 format

- **`MITTO_API_BASE`** - Mitto API base URL
  - Default: `https://messaging.mittoapi.com`

### Payments (Stripe)
- **`STRIPE_SECRET_KEY`** - Stripe secret key
  - Production: `sk_live_...`
  - Testing: `sk_test_...`
  - Get from: Stripe Dashboard → Developers → API keys

- **`STRIPE_WEBHOOK_SECRET`** - Stripe webhook signing secret
  - Format: `whsec_...`
  - Get from: Stripe Dashboard → Developers → Webhooks → Your webhook → Signing secret

- **`STRIPE_PRICE_ID_SUB_STARTER_EUR`** - Starter plan price ID (EUR)
  - Format: `price_...`
  - Get from: Stripe Dashboard → Products → Your product → Pricing

- **`STRIPE_PRICE_ID_SUB_PRO_EUR`** - Pro plan price ID (EUR)
  - Format: `price_...`

- **`STRIPE_PRICE_ID_CREDIT_TOPUP_EUR`** - Credit top-up price ID (EUR)
  - Format: `price_...`

## 🟡 Recommended Variables

### Redis (Required for queues and caching)
**Option 1: Use REDIS_URL (Recommended)**
- **`REDIS_URL`** - Full Redis connection string
  - Format: `redis://username:password@host:port`
  - Get from: Redis Cloud, AWS ElastiCache, or Render Redis

**Option 2: Use individual variables**
- **`REDIS_HOST`** - Redis hostname
- **`REDIS_PORT`** - Redis port (default: 6379)
- **`REDIS_USERNAME`** - Redis username (if required)
- **`REDIS_PASSWORD`** - Redis password
- **`REDIS_DB`** - Redis database number (default: 0)
- **`REDIS_TLS`** - Enable TLS (true/false, default: false)

### CORS & Security
- **`CORS_ALLOWLIST`** - Allowed frontend origins (comma-separated)
  - Example: `https://astronote-retail-frontend.onrender.com,https://astronote-retail-frontend.onrender.com/retail`
  - Must include your frontend URL (not backend URL)
  - **Important:** This should be your frontend domain, not the backend domain

- **`FRONTEND_URL`** - Frontend application URL
  - Example: `https://astronote-retail-frontend.onrender.com`
  - Used for redirects after Stripe payments, billing flows, etc.
  - **Important:** This should be your frontend domain, not the backend domain

- **`WEBHOOK_SECRET`** - Secret for external webhooks
  - Generate: Use a strong random string

### Application URLs
- **`APP_PUBLIC_BASE_URL`** - Public base URL for generating links
  - Example: `https://astronote-retail-frontend.onrender.com`
  - Used for unsubscribe links, tracking links, offer links, etc.
  - **Important:** This should be your frontend domain, not the backend domain

### Core Configuration
- **`NODE_ENV`** - Environment mode
  - Production: `production`
  - Development: `development`

- **`PORT`** - Server port
  - Default: `3001`
  - Render will set this automatically, but you can override

## 🟢 Optional Variables (Have Defaults)

### Queue Configuration
- **`QUEUE_DISABLED`** - Disable queue processing (0 = enabled, 1 = disabled)
  - Default: `0`

- **`QUEUE_ATTEMPTS`** - Max retry attempts for failed jobs
  - Default: `5`

- **`QUEUE_BACKOFF_MS`** - Retry backoff delay in milliseconds
  - Default: `3000`

- **`QUEUE_RATE_MAX`** - Max jobs per rate limit window
  - Default: `20`

- **`QUEUE_RATE_DURATION_MS`** - Rate limit window in milliseconds
  - Default: `1000`

- **`WORKER_CONCURRENCY`** - Number of parallel worker jobs
  - Default: `5`

### System Configuration
- **`SYSTEM_USER_ID`** - System user ID (usually 1)
  - Default: `1`

## 📋 Quick Setup Checklist for Render

1. ✅ Set `DATABASE_URL` and `DIRECT_DATABASE_URL`
2. ✅ Set `JWT_SECRET` (min 24 chars)
3. ✅ Set `MITTO_API_KEY` and `SMS_TRAFFIC_ACCOUNT_ID`
4. ✅ Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
5. ✅ Set Stripe price IDs (`STRIPE_PRICE_ID_*`)
6. ✅ Set `REDIS_URL` (or individual Redis variables)
7. ✅ Set `CORS_ALLOWLIST` (your frontend URL)
8. ✅ Set `APP_PUBLIC_BASE_URL`
9. ✅ Set `NODE_ENV=production`

## 🔒 Security Notes

- **Never commit `.env` files to Git**
- **Use Render's environment variable settings** (not hardcoded values)
- **Rotate secrets regularly** (especially JWT_SECRET, API keys)
- **Use production Stripe keys** (`sk_live_...`) in production
- **Keep webhook secrets secure** and never expose them

## 📝 Example Render Environment Setup

```
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require&pgbouncer=true
DIRECT_DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
JWT_SECRET=your-super-secret-key-min-24-characters-long
MITTO_API_KEY=your_mitto_api_key
SMS_TRAFFIC_ACCOUNT_ID=your_account_id
STRIPE_SECRET_KEY=sk_live_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_PRICE_ID_SUB_STARTER_EUR=price_xxx
STRIPE_PRICE_ID_SUB_PRO_EUR=price_xxx
STRIPE_PRICE_ID_CREDIT_TOPUP_EUR=price_xxx
REDIS_URL=redis://user:pass@host:port
CORS_ALLOWLIST=https://astronote-retail-frontend.onrender.com,https://astronote-retail-frontend.onrender.com/retail
FRONTEND_URL=https://astronote-retail-frontend.onrender.com
APP_PUBLIC_BASE_URL=https://astronote-retail-frontend.onrender.com
NODE_ENV=production
```

