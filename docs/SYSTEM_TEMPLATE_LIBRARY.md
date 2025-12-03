# System Template Library

## Overview

The system template library provides merchants with a set of 25 high-converting SMS templates they can use as inspiration and quick starting points for their campaigns. Templates are global (shared across all stores) and managed by the system user.

## Template Structure

Each template includes:

- **Name / Title**: Short, meaningful name (e.g., "Happy Hour Promo", "Win-back Inactive Members")
- **Category**: Business type (`cafe`, `restaurant`, `gym`, `sports_club`, `generic`)
- **Goal / Use case**: Short description of what the template is for
- **Message body**: Ready-to-use SMS text with placeholders
- **Suggested metrics**: KPIs most relevant for measuring success

## Placeholders

Templates support only two placeholders:

- `{{first_name}}` - Contact's first name
- `{{last_name}}` - Contact's last name

**Placeholder Behavior**:
- If a contact is missing a field (e.g., no last name), the system handles it gracefully
- Missing placeholders are replaced with empty strings
- Double spaces are cleaned up automatically
- The message is still sent even if some placeholders are missing

**Backward Compatibility**:
- The render function also supports `{{firstName}}` and `{{lastName}}` (camelCase) for backward compatibility
- Legacy templates using camelCase will continue to work

## Template Categories

### Café / Coffee Shop (5 templates)
- Welcome New Customer
- Happy Hour Promotion
- Loyalty Reward Reminder
- New Menu Item Launch
- Win-back Inactive Customers

### Restaurant / Bar (5 templates)
- Weekend Special Offer
- Birthday Special
- Lunch Deal Promotion
- Event Announcement
- Loyalty Program Update

### Gym / Fitness Studio (5 templates)
- New Member Welcome
- Class Reminder
- Win-back Inactive Members
- New Class Launch
- Achievement Celebration

### Sports Club / Team (5 templates)
- Match Reminder
- Training Session Update
- Team Event Announcement
- New Member Welcome
- Achievement Recognition

### Generic / Any Business (5 templates)
- Flash Sale Alert
- Seasonal Promotion
- Customer Feedback Request
- Referral Program
- Thank You Message

## User Permissions

**Users CANNOT**:
- Create new templates
- Edit existing templates
- Delete templates

**Users CAN**:
- View the list of templates (with filters by category)
- Search templates by name
- View template details (name, category, goal, message body, suggested metrics)
- Copy template text into the Create Campaign form

## API Endpoints

### List Templates
```
GET /api/templates?page=1&pageSize=50&category=cafe&q=promo
```

**Query Parameters**:
- `page` (default: 1) - Page number
- `pageSize` (default: 50, max: 100) - Items per page
- `category` (optional) - Filter by category: `cafe`, `restaurant`, `gym`, `sports_club`, `generic`
- `q` (optional) - Search by name

**Response**:
```json
{
  "items": [
    {
      "id": 1,
      "name": "Happy Hour Promotion",
      "text": "Hey {{first_name}}! Happy Hour is on! 2-for-1 on all drinks from 2-4 PM today. See you soon!",
      "category": "cafe",
      "goal": "Drive foot traffic during off-peak hours",
      "suggestedMetrics": "Visit frequency, redemption rate, off-peak traffic",
      "createdAt": "2024-12-31T00:00:00.000Z",
      "updatedAt": "2024-12-31T00:00:00.000Z"
    }
  ],
  "total": 25,
  "page": 1,
  "pageSize": 50
}
```

### Get Template
```
GET /api/templates/:id
```

**Response**:
```json
{
  "id": 1,
  "name": "Happy Hour Promotion",
  "text": "Hey {{first_name}}! Happy Hour is on! 2-for-1 on all drinks from 2-4 PM today. See you soon!",
  "category": "cafe",
  "goal": "Drive foot traffic during off-peak hours",
  "suggestedMetrics": "Visit frequency, redemption rate, off-peak traffic",
  "createdAt": "2024-12-31T00:00:00.000Z",
  "updatedAt": "2024-12-31T00:00:00.000Z"
}
```

## Integration with Create Campaign

1. **Template Selection**: Users can browse and filter templates by category
2. **Template Preview**: Users can view template details (name, goal, message body, suggested metrics)
3. **Copy Template**: Users click "Use template" to copy the SMS text into the campaign content field
4. **Personalization**: When the campaign is sent, `{{first_name}}` and `{{last_name}}` are replaced with each contact's values
5. **Campaign Creation**: Users continue with the normal Create Campaign flow (audience selection, scheduling, etc.)

## Database Schema

```prisma
enum TemplateCategory {
  cafe
  restaurant
  gym
  sports_club
  generic
}

model MessageTemplate {
  id Int @id @default(autoincrement())
  ownerId Int  // System user ID for global templates
  name String
  text String  // SMS content with {{first_name}} and {{last_name}} placeholders
  category TemplateCategory
  goal String? @db.VarChar(200)
  suggestedMetrics String? @db.VarChar(500)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  campaigns Campaign[]
  
  @@unique([ownerId, name])
  @@index([ownerId])
  @@index([category])
}
```

## Seeding Templates

To seed the 25 predefined templates:

```bash
cd apps/api
node scripts/seed-templates.js
```

**Prerequisites**:
- System user must exist (ID from `SYSTEM_USER_ID` env var, default: 1)
- Database migration must be applied
- Prisma client must be generated

## Rendering Logic

The template rendering function (`render`) in `campaignEnqueue.service.js` and `campaigns.js`:

1. Supports both `{{first_name}}` and `{{firstName}}` formats
2. Replaces missing fields with empty strings
3. Cleans up double spaces
4. Trims the final message

**Example**:
```javascript
const template = "Hi {{first_name}} {{last_name}}, welcome!";
const contact = { firstName: "John", lastName: null };
// Result: "Hi John , welcome!" -> cleaned to "Hi John, welcome!"
```

## Future Enhancements

- Template usage analytics (which templates are most used)
- Template performance metrics (conversion rates by template)
- Template A/B testing
- Custom template creation (if needed in future)

