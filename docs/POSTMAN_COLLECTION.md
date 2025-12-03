# Postman Collection Documentation

## Overview

A comprehensive Postman collection has been created for the SMS Marketing API, covering all endpoints with example payloads and organized by functional groups.

## Files

1. **`SMS_Marketing_API.postman_collection.json`** - Complete API collection
2. **`SMS_Marketing_API.postman_environment.json`** - Environment variables template

## Import Instructions

### Import Collection
1. Open Postman
2. Click **Import** button
3. Select `SMS_Marketing_API.postman_collection.json`
4. Collection will be imported with all endpoints organized

### Import Environment
1. In Postman, click **Environments** (left sidebar)
2. Click **Import**
3. Select `SMS_Marketing_API.postman_environment.json`
4. Set the environment as active
5. Update `base_url` if your API runs on a different port/host

## Collection Structure

### 1. Authentication
- **Register** - Create new user account
- **Login** - Login and get access token (auto-saves token)
- **Refresh Token** - Refresh access token using cookie
- **Logout** - Logout and revoke refresh token
- **Get Current User** - Get authenticated user info

### 2. Contacts
- **Create Contact** - Create new contact
- **List Contacts** - List with pagination and search
- **Get Contact** - Get single contact
- **Update Contact** - Update contact information
- **Delete Contact** - Delete contact
- **Unsubscribe (Public)** - Public unsubscribe endpoint

### 3. Lists
- **Create List** - Create new contact list
- **List Lists** - List all lists with pagination
- **Get List** - Get single list
- **Add Contact to List** - Add contact to list
- **List Contacts in List** - Get contacts in a list
- **Remove Contact from List** - Remove contact from list

### 4. Templates
- **List Templates** - List all templates
- **Get Template** - Get single template

### 5. Campaigns
- **Create Campaign** - Create new campaign
- **List Campaigns** - List all campaigns
- **Get Campaign** - Get single campaign
- **Campaign Preview** - Preview campaign messages
- **Enqueue Campaign** - Manually enqueue campaign
- **Schedule Campaign** - Schedule campaign for future
- **Unschedule Campaign** - Unschedule campaign
- **Get Campaign Status** - Get campaign metrics
- **Fake Send (Dev)** - Dev endpoint for testing

### 6. Campaign Stats
- **Get Campaign Stats** - Get detailed statistics
- **Get Multiple Campaign Stats** - Bulk stats endpoint
- **List Campaigns with Stats** - List with aggregated stats

### 7. Billing
- **Get Balance** - Get wallet balance
- **Get Transactions** - Get transaction history
- **Get Packages** - List available packages
- **Create Checkout Session** - Create Stripe checkout
- **Get Purchases** - Get purchase history
- **Get Purchase Status** - Get purchase status

### 8. NFC
- **Get NFC Config (Public)** - Get NFC tag configuration
- **Submit NFC Form (Public)** - Submit NFC form

### 9. Tracking
- **Redeem Tracking Link (Public)** - Redeem campaign link

### 10. System
- **Health Check** - Basic health endpoint
- **Readiness Check** - Readiness with DB check
- **Jobs Health** - Queue health status
- **API Docs** - Swagger UI
- **OpenAPI Spec** - OpenAPI JSON

## Environment Variables

### Default Variables
- `base_url` - API base URL (default: `http://localhost:3001`)
- `access_token` - JWT access token (auto-set on login)
- `user_id` - Current user ID (auto-set on login)
- `refresh_token` - Refresh token (stored in cookie)

### Usage
All requests use `{{base_url}}` for the API URL. The `access_token` is automatically included in Authorization headers for protected endpoints.

## Example Workflow

### 1. Authentication Flow
1. **Register** - Create a new account
2. **Login** - Login (token auto-saved)
3. **Get Current User** - Verify authentication

### 2. Contact Management Flow
1. **Create Contact** - Add a contact
2. **List Contacts** - View all contacts
3. **Create List** - Create a contact list
4. **Add Contact to List** - Add contact to list

### 3. Campaign Flow
1. **List Templates** - Get available templates
2. **Create Campaign** - Create a campaign
3. **Campaign Preview** - Preview messages
4. **Enqueue Campaign** - Start sending
5. **Get Campaign Status** - Monitor progress
6. **Get Campaign Stats** - View statistics

### 4. Billing Flow
1. **Get Balance** - Check wallet balance
2. **Get Packages** - View available packages
3. **Create Checkout Session** - Start purchase
4. **Get Purchase Status** - Check payment status
5. **Get Transactions** - View transaction history

## Request Body Examples

All POST/PUT requests include example payloads in the request body. You can modify these directly in Postman.

### Common Patterns

#### Contact Creation
```json
{
  "phone": "+1234567890",
  "email": "contact@example.com",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Campaign Creation
```json
{
  "name": "Summer Sale Campaign",
  "templateId": 1,
  "listId": 1,
  "scheduledAt": null
}
```

#### Campaign Scheduling
```json
{
  "scheduledAt": "2024-12-25T10:00:00Z"
}
```

#### NFC Form Submission
```json
{
  "phone": "+1234567890",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "consent": true
}
```

## Testing Tips

1. **Auto Token Management**: Login request automatically saves the access token to environment
2. **Variable Substitution**: Use `{{variable_name}}` in URLs and headers
3. **Query Parameters**: Many endpoints have query parameters - enable/disable as needed
4. **Error Handling**: Check response status codes and error messages
5. **Rate Limiting**: Be aware of rate limits on auth endpoints

## Notes

- All protected endpoints require `Authorization: Bearer {{access_token}}` header
- Refresh token is stored as HTTP-only cookie (handled automatically by Postman)
- Public endpoints (NFC, Tracking, Health) don't require authentication
- Some endpoints have rate limiting - check response headers for limits

