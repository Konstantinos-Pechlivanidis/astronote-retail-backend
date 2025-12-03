# Mitto SMS API Integration

## Overview

This document describes the standardized Mitto SMS API integration, including sending messages, retrieving message status, and updating internal records.

## Configuration

### Environment Variables

Required:
- `MITTO_API_KEY` - Mitto API key for authentication
- `SMS_TRAFFIC_ACCOUNT_ID` or `MITTO_TRAFFIC_ACCOUNT_ID` - Traffic account ID

Optional:
- `MITTO_API_BASE` - API base URL (default: `https://messaging.mittoapi.com`)
- `MITTO_SENDER` - Fallback sender name/number

## Service Functions

### `sendSingle({ userId, destination, text, sender?, trafficAccountId? })`

Send a single SMS message via Mitto.

**Parameters**:
- `userId` (number, required) - User ID for sender resolution
- `destination` (string, required) - Recipient phone number (international format, e.g., `+306984303406`)
- `text` (string, required) - Message body
- `sender` (string, optional) - Sender override
- `trafficAccountId` (string, optional) - Traffic account ID override

**Returns**:
```javascript
{
  messageId: "01KAY04MQR6AEV0PNJYGZW8JEW",
  trafficAccountId: "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
  rawResponse: { ... }
}
```

**Example**:
```javascript
const { sendSingle } = require('./services/mitto.service');

const result = await sendSingle({
  userId: 1,
  destination: '+306984303406',
  text: 'Hello, this is a test message!',
  sender: 'MyCompany'
});

console.log('Message ID:', result.messageId);
```

### `sendBulkStatic({ userId, destinations, text, sender?, trafficAccountId? })`

Send bulk SMS messages via Mitto.

**Parameters**:
- `userId` (number, required) - User ID for sender resolution
- `destinations` (string[], required) - Array of recipient phone numbers
- `text` (string, required) - Message body
- `sender` (string, optional) - Sender override
- `trafficAccountId` (string, optional) - Traffic account ID override

**Returns**: Mitto API response with messages array

### `getMessageStatus(messageId)`

Get message status and details from Mitto API.

**Parameters**:
- `messageId` (string, required) - Mitto message ID

**Returns**:
```javascript
{
  messageId: "01K8RBH8A6J1410YE2M9G780PK",
  text: "Hi, test msg.",
  sender: { id: "...", name: "...", messagingAppIdentifier: "..." },
  conversation: { id: "...", participants: [...] },
  createdAt: "2025-10-29T16:06:37.6842145Z",
  updatedAt: "2025-10-29T16:08:17.7854674Z",
  trafficAccountId: "e8a5e53f-51ce-4cc8-9f3c-43fb1d24daf7",
  deliveryStatus: "Delivered", // or "Failure", "Pending", etc.
  messageParts: 1,
  requestInfo: { sms: { sender: "...", text: "..." } },
  rawResponse: { ... }
}
```

**Example**:
```javascript
const { getMessageStatus } = require('./services/mitto.service');

const status = await getMessageStatus('01K8RBH8A6J1410YE2M9G780PK');
console.log('Delivery Status:', status.deliveryStatus);
```

### `refreshMessageStatus(providerMessageId, ownerId?)`

Refresh message status from Mitto and update internal database records.

**Parameters**:
- `providerMessageId` (string, required) - Mitto message ID
- `ownerId` (number, optional) - Owner ID for scoping

**Returns**:
```javascript
{
  updated: 1, // Number of records updated
  status: { ... }, // Full status from Mitto
  internalStatus: "delivered" // Mapped internal status
}
```

**Example**:
```javascript
const { refreshMessageStatus } = require('./services/mitto.service');

const result = await refreshMessageStatus('01K8RBH8A6J1410YE2M9G780PK', 1);
console.log('Updated records:', result.updated);
```

## API Endpoints

### GET /api/mitto/message/:messageId

Get message status from Mitto API.

**Authentication**: Required

**Parameters**:
- `messageId` (path) - Mitto message ID

**Response**: Message status object (see `getMessageStatus` return value)

### POST /api/mitto/refresh-status

Refresh message status from Mitto and update internal records.

**Authentication**: Required

**Request Body**:
```json
{
  "providerMessageId": "01K8RBH8A6J1410YE2M9G780PK"
}
```

**Response**:
```json
{
  "updated": 1,
  "status": { ... },
  "internalStatus": "delivered"
}
```

### POST /api/mitto/refresh-status-bulk

Refresh status for multiple messages.

**Authentication**: Required

**Request Body** (option 1 - by campaign):
```json
{
  "campaignId": 1
}
```

**Request Body** (option 2 - by message IDs):
```json
{
  "providerMessageIds": [
    "01K8RBH8A6J1410YE2M9G780PK",
    "01KAY04MQR6AEV0PNJYGZW8JEW"
  ]
}
```

**Response**:
```json
{
  "total": 2,
  "updated": 2,
  "failed": 0,
  "results": [
    { "providerMessageId": "...", "success": true, ... },
    { "providerMessageId": "...", "success": false, "error": "..." }
  ]
}
```

**Note**: Limited to 100 messages per request

## Delivery Status Mapping

Mitto delivery statuses are mapped to internal statuses:

| Mitto Status | Internal Status |
|-------------|----------------|
| `Delivered`, `delivered` | `delivered` |
| `Failure`, `Failed`, `failed` | `failed` |
| Others | `sent` |

## Sender Resolution

The service resolves sender names in the following order:
1. Override sender (if provided)
2. User's `senderName` from database
3. `MITTO_SENDER` environment variable
4. Error if none found

## Error Handling

### Common Errors

- **Missing API Key**: `MITTO_API_KEY environment variable is required`
- **Missing Traffic Account**: `SMS_TRAFFIC_ACCOUNT_ID or MITTO_TRAFFIC_ACCOUNT_ID environment variable is required`
- **Invalid Sender**: `No valid sender configured (user or env)`
- **Message Not Found**: `Message not found: {messageId}`
- **Network Errors**: Logged with full context

### Error Response Format

```javascript
{
  status: 400, // HTTP status code
  message: "Error message",
  payload: { ... } // Additional error details from Mitto
}
```

## Logging

All Mitto API calls are logged with:
- Request details (URL, method)
- Response status
- Error details (if any)
- Message IDs and delivery statuses

Logs use Pino logger with context for easy debugging.

## Usage in Worker

The SMS worker automatically uses `sendSingle` and stores the `messageId` in the database:

```javascript
const resp = await sendSingle({
  userId: msg.campaign.createdById,
  destination: msg.to,
  text: msg.text
});

// Response format: { messageId, trafficAccountId, rawResponse }
const providerId = resp?.messageId || null;
```

## Background Status Refresh

### Manual Refresh

Use the API endpoints to manually refresh statuses:
- Single message: `POST /api/mitto/refresh-status`
- Bulk by campaign: `POST /api/mitto/refresh-status-bulk` with `campaignId`
- Bulk by IDs: `POST /api/mitto/refresh-status-bulk` with `providerMessageIds`

### Scheduled Refresh (Future)

A scheduled job can be added to periodically refresh statuses for pending messages:

```javascript
// Example: Refresh statuses for messages sent in last 24 hours
const messages = await prisma.campaignMessage.findMany({
  where: {
    status: 'sent',
    sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    providerMessageId: { not: null }
  },
  select: { providerMessageId: true, ownerId: true }
});

for (const msg of messages) {
  await refreshMessageStatus(msg.providerMessageId, msg.ownerId);
}
```

## Testing

### Test Sending

```bash
# Using Postman collection
POST /api/mitto/message/:messageId
# Use a real Mitto messageId from a sent message
```

### Test Status Refresh

```bash
# Refresh single message
POST /api/mitto/refresh-status
Body: { "providerMessageId": "01K8RBH8A6J1410YE2M9G780PK" }

# Refresh campaign
POST /api/mitto/refresh-status-bulk
Body: { "campaignId": 1 }
```

## Best Practices

1. **Store messageId**: Always store `messageId` from `sendSingle` response in `providerMessageId` field
2. **Refresh periodically**: Refresh statuses for sent messages periodically (e.g., every hour)
3. **Handle errors gracefully**: Network errors are retryable; 4xx errors are not
4. **Log everything**: All API calls are logged for debugging
5. **Rate limiting**: Be aware of Mitto API rate limits
6. **Bulk operations**: Use bulk refresh for campaigns, but limit to 100 messages per request

## Environment Setup

```bash
# Required
MITTO_API_KEY=your_api_key_here
SMS_TRAFFIC_ACCOUNT_ID=your_traffic_account_id

# Optional
MITTO_API_BASE=https://messaging.mittoapi.com
MITTO_SENDER=YourCompanyName
```

## Integration Points

1. **SMS Worker** (`apps/worker/src/sms.worker.js`):
   - Uses `sendSingle` to send messages
   - Stores `messageId` in database

2. **Webhooks** (`apps/api/src/routes/mitto.webhooks.js`):
   - Receives DLR (delivery reports) from Mitto
   - Updates message status automatically

3. **API Endpoints** (`apps/api/src/routes/mitto.js`):
   - Manual status refresh
   - Message status lookup

