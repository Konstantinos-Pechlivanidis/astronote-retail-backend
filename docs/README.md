# Retail Backend Documentation

## Overview

This directory contains comprehensive documentation for the Retail backend application, covering all aspects of the SMS messaging system, integrations, and architecture.

## Main Documentation

### Message Sending

- **[MESSAGE_SENDING_GUIDE.md](./MESSAGE_SENDING_GUIDE.md)** - **COMPREHENSIVE GUIDE** - Complete documentation of all message sending functionalities:
  - Campaign Messages (Bulk) - Queue-based bulk sending
  - Automation Messages (Individual) - Welcome and birthday messages
  - Single Test Messages - Testing and one-off sends
  - Mitto API Integration
  - Rate Limiting
  - Credit Management
  - Status Tracking
  - Error Handling
  - Configuration

### Bulk SMS Implementation

- **[BULK_SMS_TECHNICAL_DESIGN.md](./BULK_SMS_TECHNICAL_DESIGN.md)** - Technical design document for bulk SMS implementation
- **[BULK_SMS_IMPLEMENTATION_SUMMARY.md](./BULK_SMS_IMPLEMENTATION_SUMMARY.md)** - Quick reference summary
- **[BULK_SMS_CODE_VALIDATION.md](./BULK_SMS_CODE_VALIDATION.md)** - Code validation report
- **[BULK_SMS_FINAL_VALIDATION.md](./BULK_SMS_FINAL_VALIDATION.md)** - Final validation summary
- **[BULK_SMS_READY_FOR_STAGING.md](./BULK_SMS_READY_FOR_STAGING.md)** - Staging readiness guide
- **[BULK_SMS_TESTING.md](./BULK_SMS_TESTING.md)** - Testing scenarios
- **[BULK_SMS_MIGRATION_PLAN.md](./BULK_SMS_MIGRATION_PLAN.md)** - Migration and rollback plan
- **[BULK_SMS_VALIDATION_AND_SUMMARY.md](./BULK_SMS_VALIDATION_AND_SUMMARY.md)** - Validation and summary

### Other Documentation

- **[AUTOMATIONS_IMPLEMENTATION.md](./AUTOMATIONS_IMPLEMENTATION.md)** - Automation messages implementation
- **[MITTO_CAMPAIGN_REPORTING.md](./MITTO_CAMPAIGN_REPORTING.md)** - Campaign reporting with Mitto
- **[CREDIT_ENFORCEMENT.md](./CREDIT_ENFORCEMENT.md)** - Credit management system
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment guide
- **[TECHNICAL.md](./TECHNICAL.md)** - Technical architecture overview

## Quick Start

**For developers new to the codebase:**
1. Start with [MESSAGE_SENDING_GUIDE.md](./MESSAGE_SENDING_GUIDE.md) for understanding all message sending methods
2. Read [BULK_SMS_TECHNICAL_DESIGN.md](./BULK_SMS_TECHNICAL_DESIGN.md) for bulk SMS architecture
3. Review [AUTOMATIONS_IMPLEMENTATION.md](./AUTOMATIONS_IMPLEMENTATION.md) for automation messages

**For deployment:**
1. See [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment instructions
2. Review [BULK_SMS_MIGRATION_PLAN.md](./BULK_SMS_MIGRATION_PLAN.md) for migration steps

**For testing:**
1. See [BULK_SMS_TESTING.md](./BULK_SMS_TESTING.md) for test scenarios
2. Review [BULK_SMS_READY_FOR_STAGING.md](./BULK_SMS_READY_FOR_STAGING.md) for staging checklist

## Documentation Status

### ✅ Current & Up-to-Date

- `MESSAGE_SENDING_GUIDE.md` - **NEW** - Comprehensive guide (2025-01-24)
- `BULK_SMS_*` - All bulk SMS documentation (2025-01-24)
- `AUTOMATIONS_IMPLEMENTATION.md` - Automation messages
- `CREDIT_ENFORCEMENT.md` - Credit management

### ⚠️ Legacy/Historical

The following documentation files are kept for historical reference but may contain outdated information:

- Various review and cleanup documents (FINAL_*, HOLISTIC_*, PRISMA_REVIEW_*, etc.)
- These are kept for reference but should not be used as primary documentation

## Key Concepts

### Message Sending Methods

1. **Campaign Messages (Bulk)**
   - Uses Mitto bulk endpoint (`/api/v1.1/Messages/sendmessagesbulk`)
   - Queue-based asynchronous processing
   - Scalable to hundreds of thousands of messages
   - Rate limited and idempotent

2. **Automation Messages (Individual)**
   - Welcome messages (on contact creation)
   - Birthday messages (daily batch)
   - Uses Mitto single endpoint
   - Direct synchronous sending

3. **Single Test Messages**
   - For testing and one-off sends
   - Uses Mitto single endpoint
   - Direct synchronous sending

### Architecture

- **Queue-Based**: Campaign messages use Redis/BullMQ for async processing
- **Direct Sending**: Automations and test messages send directly
- **Credit Safety**: Credits only debited after successful send
- **Rate Limiting**: Per-traffic-account and per-tenant limits
- **Idempotency**: Multiple layers prevent duplicate sends

## Contributing

When updating documentation:

1. **Update MESSAGE_SENDING_GUIDE.md** for any changes to message sending
2. **Update relevant BULK_SMS_* docs** for bulk SMS changes
3. **Keep README.md updated** with new documentation
4. **Remove outdated docs** or mark them as legacy

## Last Updated

2025-01-24 - Created comprehensive MESSAGE_SENDING_GUIDE.md and cleaned up outdated Mitto integration docs

