# Environment Variables - Quick Reference

**Quick checklist for deployment**

---

## ✅ Required Variables (Must Set)

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
DIRECT_DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Redis
REDIS_URL=redis://username:password@host:port/db

# Authentication
JWT_SECRET=your-secret-key-change-in-production
UNSUBSCRIBE_TOKEN_SECRET=your-unsubscribe-secret-change-in-production

# Mitto SMS
MITTO_API_KEY=your-mitto-api-key
SMS_TRAFFIC_ACCOUNT_ID=your-traffic-account-id

# Stripe
STRIPE_SECRET_KEY=sk_live_...  # or sk_test_... for testing
STRIPE_WEBHOOK_SECRET=whsec_...

# Frontend
FRONTEND_URL=https://astronote-retail-frontend.onrender.com
```

---

## ⚙️ Optional Variables (Defaults Shown)

```bash
# Server
PORT=3001
NODE_ENV=production

# Workers
START_WORKER=1
QUEUE_DISABLED=0
WORKER_CONCURRENCY=5

# Bulk SMS
SMS_BATCH_SIZE=5000

# Rate Limiting
RATE_LIMIT_TRAFFIC_ACCOUNT_MAX=100
RATE_LIMIT_TENANT_MAX=50

# Queue Retry
QUEUE_ATTEMPTS=5
QUEUE_BACKOFF_MS=3000

# Status Refresh
STATUS_REFRESH_ENABLED=1
STATUS_REFRESH_INTERVAL=600000

# JWT
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# Mitto
MITTO_API_BASE=https://messaging.mittoapi.com
MITTO_SENDER=YourSenderName

# Frontend URLs (fallback to FRONTEND_URL)
UNSUBSCRIBE_BASE_URL=https://astronote-retail-frontend.onrender.com
OFFER_BASE_URL=https://astronote-retail-frontend.onrender.com

# URL Shortening Configuration
URL_SHORTENER_TYPE=custom  # 'custom' (default), 'bitly', 'tinyurl', or 'none'
URL_SHORTENER_BASE_URL=https://astronote-retail-frontend.onrender.com
# BITLY_API_TOKEN=your_bitly_api_token  # Optional - for Bitly shortener
# TINYURL_API_KEY=your_tinyurl_api_key  # Optional - for TinyURL shortener
```

---

## 🔒 Security Checklist

- [ ] `JWT_SECRET` is strong and random
- [ ] `UNSUBSCRIBE_TOKEN_SECRET` is strong and random
- [ ] `ALLOW_BILLING_SEED=0` (disabled in production)
- [ ] Secrets are not committed to version control
- [ ] `STRIPE_SECRET_KEY` uses `sk_live_...` for production

---

## 📋 Full Documentation

See `ENVIRONMENT_VARIABLES.md` for complete documentation with descriptions, examples, and environment-specific recommendations.

---

**Last Updated**: 2025-01-24

