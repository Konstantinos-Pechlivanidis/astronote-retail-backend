# Automations Implementation

## Overview

The automations system provides two predefined, system-level automations that store owners can enable/disable and customize:

1. **Welcome Message Automation** - Sends a welcome SMS to new opted-in contacts
2. **Birthday Message Automation** - Sends a birthday SMS to contacts on their birthday

## Features

- **System-defined**: Users cannot create or delete automations, only enable/disable and edit messages
- **Per-store configuration**: Each store has its own automation settings
- **Placeholder support**: Supports `{{first_name}}` and `{{last_name}}` placeholders
- **Opt-in enforcement**: Only sends to subscribed contacts
- **Non-blocking**: Welcome automation runs asynchronously and doesn't block contact creation

## Database Schema

### Automation Model

```prisma
enum AutomationType {
  welcome_message
  birthday_message
}

model Automation {
  id Int @id @default(autoincrement())
  ownerId Int
  owner   User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  type AutomationType
  isActive Boolean @default(false)
  messageBody String @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([ownerId, type])
  @@index([ownerId])
  @@index([ownerId, isActive])
  @@index([type])
}
```

## API Endpoints

### GET /api/automations
Get all automations for the authenticated store (returns both welcome and birthday).

**Response:**
```json
{
  "welcome": {
    "id": 1,
    "type": "welcome_message",
    "isActive": true,
    "messageBody": "Hi {{first_name}}, welcome to our community! 🎉",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  },
  "birthday": {
    "id": 2,
    "type": "birthday_message",
    "isActive": false,
    "messageBody": "Happy Birthday {{first_name}}! 🎂",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

### GET /api/automations/:type
Get a specific automation by type (`welcome_message` or `birthday_message`).

### PUT /api/automations/:type
Update automation settings.

**Request Body:**
```json
{
  "isActive": true,
  "messageBody": "Hi {{first_name}}, welcome to our community! 🎉"
}
```

**Note:** Both `isActive` and `messageBody` are optional. You can update just one or both.

## Service Layer

### automation.service.js

#### `getAutomations(ownerId)`
Returns both welcome and birthday automations for a store. Creates them if they don't exist (with default inactive state).

#### `updateAutomation(ownerId, type, updates)`
Updates an automation's `isActive` flag and/or `messageBody`. Validates that the automation exists.

#### `triggerWelcomeAutomation(ownerId, contact)`
Triggers the welcome automation for a new contact. Called automatically when:
- A new contact is created via `POST /api/contacts`
- A new contact opts in via NFC flow

**Returns:**
```javascript
{
  sent: true,
  messageId: "...",
  providerMessageId: "..."
}
// or
{
  sent: false,
  reason: "automation_inactive" | "contact_not_subscribed" | "no_sender_configured" | "send_failed",
  error: "..."
}
```

#### `processBirthdayAutomations()`
Processes all active birthday automations for all stores. Should be called daily (via cron or scheduled task).

**Returns:**
```javascript
{
  processed: 10,      // Total contacts processed
  sent: 8,            // Successfully sent
  failed: 2,          // Failed to send
  storesProcessed: 3  // Number of stores with active birthday automations
}
```

## Integration Points

### Welcome Automation Trigger

The welcome automation is triggered automatically in:

1. **Contact Creation API** (`apps/api/src/routes/contacts.js`):
   ```javascript
   const contact = await prisma.contact.create({ ... });
   
   // Trigger welcome automation (non-blocking)
   triggerWelcomeAutomation(req.user.id, contact).catch(err => {
     console.error('[Contact] Welcome automation failed:', err.message);
   });
   ```

2. **NFC Service** (`apps/api/src/services/nfc.service.js`):
   ```javascript
   if (isNew) {
     // Trigger welcome automation for new opted-in contacts
     triggerWelcomeAutomation(storeId, contact).catch(err => {
       console.error('[NFC] Welcome automation failed:', err.message);
     });
   }
   ```

### Birthday Automation Worker

The birthday automation runs via a dedicated worker (`apps/worker/src/birthday.worker.js`).

**Manual Run:**
```bash
RUN_BIRTHDAY_ON_START=1 node apps/worker/src/birthday.worker.js
```

**Production Setup:**
Schedule via cron (e.g., daily at 9 AM):
```bash
0 9 * * * cd /path/to/app && node apps/worker/src/birthday.worker.js
```

Or use a cloud scheduler (AWS EventBridge, Google Cloud Scheduler, etc.).

## Placeholder Rendering

Both automations support the same placeholder rendering as campaigns:

- `{{first_name}}` - Replaced with contact's first name
- `{{last_name}}` - Replaced with contact's last name

Missing fields are handled gracefully (replaced with empty string).

**Example:**
- Template: `"Hi {{first_name}}, welcome to our community! 🎉"`
- Contact: `{ firstName: "Niko", lastName: "Papadopoulos" }`
- Result: `"Hi Niko, welcome to our community! 🎉"`

## Default Messages

When automations are first created (automatically), they use these default messages:

- **Welcome**: `"Hi {{first_name}}, welcome to our community! 🎉"`
- **Birthday**: `"Happy Birthday {{first_name}}! 🎂 We hope you have a wonderful day!"`

Both default to `isActive: false` (inactive).

## Security & Validation

- All endpoints require authentication (`requireAuth` middleware)
- Users can only access/modify automations for their own store (`ownerId` scoping)
- `POST` and `DELETE` endpoints are blocked (403 Forbidden)
- Message body validation: must be a non-empty string
- `isActive` validation: must be a boolean

## Error Handling

- Welcome automation failures are logged but don't block contact creation
- Birthday automation failures are logged per contact but don't stop processing other contacts
- Missing sender configuration returns a clear error message
- Invalid automation types return 400 Bad Request

## Testing

Use the Postman collection (`SMS_Marketing_API.postman_collection.json`) to test:

1. **Get All Automations**: `GET /api/automations`
2. **Update Welcome**: `PUT /api/automations/welcome_message` with `{ "isActive": true, "messageBody": "..." }`
3. **Update Birthday**: `PUT /api/automations/birthday_message` with `{ "isActive": true, "messageBody": "..." }`
4. **Test Welcome**: Create a new contact via `POST /api/contacts` or NFC flow
5. **Test Birthday**: Run `RUN_BIRTHDAY_ON_START=1 node apps/worker/src/birthday.worker.js` (ensure contacts have valid birthdays)

## Future Enhancements

Potential improvements:
- Timezone-aware birthday processing
- Birthday automation scheduling per store timezone
- Automation analytics (sent/failed counts)
- Additional automation types (anniversary, re-engagement, etc.)
- A/B testing for automation messages

