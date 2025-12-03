# Mitto SMS Integration - Implementation Summary

## Overview

The Mitto SMS API integration has been standardized and finalized with complete functionality for sending messages, retrieving status, and updating internal records.

## Implementation Complete ✅

### 1. Send SMS via Mitto ✅

**Service**: `apps/api/src/services/mitto.service.js`

**Function**: `sendSingle({ userId, destination, text, sender?, trafficAccountId? })`

**Features**:
- ✅ Uses `X-Mitto-API-Key` header from `MITTO_API_KEY` environment variable
- ✅ Uses `trafficAccountId` from `SMS_TRAFFIC_ACCOUNT_ID` or `MITTO_TRAFFIC_ACCOUNT_ID`
- ✅ Proper request payload format matching Mitto API
- ✅ Correct response parsing: `{ messages: [{ messageId, trafficAccountId }] }`
- ✅ Stores `messageId` in database via worker
- ✅ Comprehensive error handling and logging
- ✅ Sender resolution (override → user → env fallback)

**Response Format**:
```javascript
{
  messageId: "01KAY04MQR6AEV0PNJYGZW8JEW",
  trafficAccountId: "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
  rawResponse: { ... }
}
```

### 2. Get Message Status by ID ✅

**Service**: `apps/api/src/services/mitto.service.js`

**Function**: `getMessageStatus(messageId)`

**Features**:
- ✅ Uses `GET /api/v1.1/Messages/{messageId}` endpoint
- ✅ Uses `X-Mitto-API-Key` header from environment
- ✅ Retrieves full message details:
  - `messageId`, `text`, `sender`, `conversation`
  - `createdAt`, `updatedAt`, `trafficAccountId`
  - `deliveryStatus`, `messageParts`, `requestInfo`
- ✅ Comprehensive error handling (404, network errors)
- ✅ Clear logging for troubleshooting

**Response Format**:
```javascript
{
  messageId: "01K8RBH8A6J1410YE2M9G780PK",
  text: "Hi, test msg.",
  sender: { id: "...", name: "...", messagingAppIdentifier: "..." },
  conversation: { id: "...", participants: [...] },
  createdAt: "2025-10-29T16:06:37.6842145Z",
  updatedAt: "2025-10-29T16:08:17.7854674Z",
  trafficAccountId: "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
  deliveryStatus: "Delivered", // or "Failure", "Pending"
  messageParts: 1,
  requestInfo: { sms: { sender: "...", text: "..." } },
  rawResponse: { ... }
}
```

### 3. Refresh Message Status ✅

**Service**: `apps/api/src/services/mitto.service.js`

**Function**: `refreshMessageStatus(providerMessageId, ownerId?)`

**Features**:
- ✅ Calls `getMessageStatus` to fetch latest status
- ✅ Maps Mitto `deliveryStatus` to internal status:
  - `Delivered`/`delivered` → `delivered`
  - `Failure`/`Failed`/`failed` → `failed`
  - Others → `sent`
- ✅ Updates internal `CampaignMessage` records:
  - Sets `status` field
  - Sets `deliveredAt` or `failedAt` timestamps
  - Sets `error` field for failures
- ✅ Scoped by `ownerId` for security
- ✅ Invalidates campaign stats cache
- ✅ Handles multiple messages with same `providerMessageId`

### 4. API Endpoints ✅

**Route**: `apps/api/src/routes/mitto.js`

**Endpoints**:
1. **GET /api/mitto/message/:messageId** - Get message status from Mitto
2. **POST /api/mitto/refresh-status** - Refresh single message status
3. **POST /api/mitto/refresh-status-bulk** - Refresh multiple messages

**Features**:
- ✅ All endpoints require authentication
- ✅ Proper input validation
- ✅ Error handling with appropriate HTTP status codes
- ✅ Bulk refresh supports:
  - By `campaignId` (all messages in campaign)
  - By `providerMessageIds` array (specific messages)
  - Limited to 100 messages per request

### 5. Worker Integration ✅

**File**: `apps/worker/src/sms.worker.js`

**Updates**:
- ✅ Updated to use new `sendSingle` response format
- ✅ Correctly extracts `messageId` from response
- ✅ Stores `messageId` in `providerMessageId` field

## Files Modified

1. **`apps/api/src/services/mitto.service.js`** - Complete rewrite with:
   - Standardized `sendSingle` function
   - New `getMessageStatus` function
   - New `refreshMessageStatus` function
   - Improved error handling and logging
   - Support for GET requests

2. **`apps/api/src/routes/mitto.js`** - New route file with:
   - GET message status endpoint
   - POST refresh status endpoint
   - POST bulk refresh endpoint

3. **`apps/api/src/server.js`** - Added route mounting:
   - `app.use('/api', require('./routes/mitto'))`

4. **`apps/worker/src/sms.worker.js`** - Updated response parsing:
   - Changed from `resp?.messageId || resp?.messages?.[0]?.messageId`
   - To: `resp?.messageId` (correct format)

5. **`SMS_Marketing_API.postman_collection.json`** - Added Mitto endpoints:
   - Get Message Status
   - Refresh Message Status
   - Refresh Status Bulk (Campaign)
   - Refresh Status Bulk (Message IDs)

## Environment Variables

### Required
```bash
MITTO_API_KEY=your_api_key_here
SMS_TRAFFIC_ACCOUNT_ID=your_traffic_account_id
# OR
MITTO_TRAFFIC_ACCOUNT_ID=your_traffic_account_id
```

### Optional
```bash
MITTO_API_BASE=https://messaging.mittoapi.com  # Default value
MITTO_SENDER=YourCompanyName                    # Fallback sender
```

## API Usage Examples

### Send SMS
```javascript
const { sendSingle } = require('./services/mitto.service');

const result = await sendSingle({
  userId: 1,
  destination: '+306984303406',
  text: 'Hello from SMS Marketing!',
  sender: 'MyCompany'
});

// Store messageId in database
await prisma.campaignMessage.update({
  where: { id: messageId },
  data: { providerMessageId: result.messageId }
});
```

### Get Message Status
```javascript
const { getMessageStatus } = require('./services/mitto.service');

const status = await getMessageStatus('01K8RBH8A6J1410YE2M9G780PK');
console.log('Status:', status.deliveryStatus); // "Delivered", "Failure", etc.
```

### Refresh Status
```javascript
const { refreshMessageStatus } = require('./services/mitto.service');

const result = await refreshMessageStatus('01K8RBH8A6J1410YE2M9G780PK', 1);
console.log('Updated records:', result.updated);
console.log('Internal status:', result.internalStatus);
```

## Testing

### Using Postman

1. **Get Message Status**:
   - `GET /api/mitto/message/01K8RBH8A6J1410YE2M9G780PK`
   - Requires authentication

2. **Refresh Single Message**:
   - `POST /api/mitto/refresh-status`
   - Body: `{ "providerMessageId": "01K8RBH8A6J1410YE2M9G780PK" }`

3. **Refresh Campaign**:
   - `POST /api/mitto/refresh-status-bulk`
   - Body: `{ "campaignId": 1 }`

## Error Handling

### Common Errors

1. **Missing Configuration**:
   - `MITTO_API_KEY environment variable is required`
   - `SMS_TRAFFIC_ACCOUNT_ID or MITTO_TRAFFIC_ACCOUNT_ID environment variable is required`

2. **Invalid Sender**:
   - `No valid sender configured (user or env)`

3. **Message Not Found**:
   - `Message not found: {messageId}` (404)

4. **Network Errors**:
   - Logged with full context
   - Retryable errors (5xx, network) vs non-retryable (4xx)

## Logging

All Mitto API calls are logged with:
- Request details (URL, method, parameters)
- Response status and data
- Error details (if any)
- Message IDs and delivery statuses

Uses Pino logger with structured logging for easy debugging.

## Status Mapping

| Mitto Status | Internal Status | Database Fields Updated |
|-------------|----------------|------------------------|
| `Delivered`, `delivered` | `delivered` | `status`, `deliveredAt` |
| `Failure`, `Failed`, `failed` | `failed` | `status`, `failedAt`, `error` |
| Others | `sent` | `status` |

## Best Practices

1. ✅ **Store messageId**: Always store `messageId` from `sendSingle` response
2. ✅ **Refresh periodically**: Use bulk refresh for campaigns
3. ✅ **Handle errors**: Network errors are retryable; 4xx are not
4. ✅ **Log everything**: All API calls logged for debugging
5. ✅ **Rate limiting**: Be aware of Mitto API rate limits
6. ✅ **Bulk operations**: Limit to 100 messages per bulk request

## Integration Points

1. **SMS Worker**: Uses `sendSingle` to send messages
2. **Webhooks**: Receives DLR from Mitto (existing)
3. **API Endpoints**: Manual status refresh and lookup
4. **Campaign Stats**: Status updates invalidate cache

## Future Enhancements

1. **Scheduled Status Refresh**: Add cron job to refresh pending messages
2. **Retry Logic**: Automatic retry for failed status fetches
3. **Webhook Verification**: Verify webhook signatures from Mitto
4. **Status Webhooks**: Handle status updates via webhooks (if available)

## Conclusion

The Mitto SMS API integration is **complete and production-ready** with:
- ✅ Standardized sending via `sendSingle`
- ✅ Message status retrieval via `getMessageStatus`
- ✅ Status refresh and database update via `refreshMessageStatus`
- ✅ API endpoints for manual operations
- ✅ Comprehensive error handling and logging
- ✅ Postman collection updated

**Status: READY FOR PRODUCTION USE**

