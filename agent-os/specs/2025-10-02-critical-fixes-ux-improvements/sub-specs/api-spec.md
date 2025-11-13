# API Specification

This is the API specification for the spec detailed in @.agent-os/specs/2025-10-02-critical-fixes-ux-improvements/spec.md

> Created: 2025-10-02
> Version: 1.0.0

## Category Management Endpoints

### GET /api/v1/calendars/:calendarId/categories

**Purpose:** List all categories for a calendar
**Authentication:** Required (JWT)
**Authorization:** User must have view access to calendar

**Parameters:**
- `calendarId` (path) - UUID of calendar

**Response:** 200 OK
```json
{
  "categories": [
    {
      "id": "uuid",
      "calendarId": "uuid",
      "content": {
        "en": { "name": "Community Events" },
        "es": { "name": "Eventos Comunitarios" }
      },
      "createdAt": "2025-10-02T12:00:00Z",
      "updatedAt": "2025-10-02T12:00:00Z"
    }
  ]
}
```

**Errors:**
- 401 Unauthorized - Not authenticated
- 403 Forbidden - No access to calendar
- 404 Not Found - Calendar doesn't exist

### POST /api/v1/calendars/:calendarId/categories

**Purpose:** Create new category for calendar
**Authentication:** Required (JWT)
**Authorization:** User must be calendar owner or editor

**Parameters:**
- `calendarId` (path) - UUID of calendar

**Request Body:**
```json
{
  "content": {
    "en": { "name": "Workshops" },
    "es": { "name": "Talleres" }
  }
}
```

**Response:** 201 Created
```json
{
  "category": {
    "id": "new-uuid",
    "calendarId": "uuid",
    "content": {
      "en": { "name": "Workshops" },
      "es": { "name": "Talleres" }
    },
    "createdAt": "2025-10-02T12:00:00Z",
    "updatedAt": "2025-10-02T12:00:00Z"
  }
}
```

**Errors:**
- 400 Bad Request - Invalid content format
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Not calendar owner/editor
- 404 Not Found - Calendar doesn't exist

### PUT /api/v1/calendars/:calendarId/categories/:categoryId

**Purpose:** Update category content
**Authentication:** Required (JWT)
**Authorization:** User must be calendar owner or editor

**Parameters:**
- `calendarId` (path) - UUID of calendar
- `categoryId` (path) - UUID of category

**Request Body:**
```json
{
  "content": {
    "en": { "name": "Community Workshops" },
    "es": { "name": "Talleres Comunitarios" }
  }
}
```

**Response:** 200 OK
```json
{
  "category": {
    "id": "uuid",
    "calendarId": "uuid",
    "content": {
      "en": { "name": "Community Workshops" },
      "es": { "name": "Talleres Comunitarios" }
    },
    "createdAt": "2025-10-02T12:00:00Z",
    "updatedAt": "2025-10-02T14:30:00Z"
  }
}
```

**Errors:**
- 400 Bad Request - Invalid content format
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Not calendar owner/editor
- 404 Not Found - Category or calendar doesn't exist

### DELETE /api/v1/calendars/:calendarId/categories/:categoryId

**Purpose:** Delete category
**Authentication:** Required (JWT)
**Authorization:** User must be calendar owner or editor

**Parameters:**
- `calendarId` (path) - UUID of calendar
- `categoryId` (path) - UUID of category

**Response:** 204 No Content

**Errors:**
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Not calendar owner/editor
- 404 Not Found - Category or calendar doesn't exist
- 409 Conflict - Category assigned to events (prevent deletion)

## Event Category Assignment Endpoints

**Note:** Event categories are loaded as part of the event data structure when fetching events. The event object includes a `categories` array containing the assigned EventCategory objects.

### POST /api/v1/events/:eventId/categories

**Purpose:** Assign categories to event (replaces existing assignments)
**Authentication:** Required (JWT)
**Authorization:** User must be calendar owner or editor

**Parameters:**
- `eventId` (path) - UUID of event

**Request Body:**
```json
{
  "categoryIds": ["uuid1", "uuid2", "uuid3"]
}
```

**Response:** 200 OK
```json
{
  "event": {
    "id": "uuid",
    "categoryIds": ["uuid1", "uuid2", "uuid3"]
  }
}
```

**Errors:**
- 400 Bad Request - Invalid category IDs
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Not calendar owner/editor
- 404 Not Found - Event or category doesn't exist

### DELETE /api/v1/events/:eventId/categories/:categoryId

**Purpose:** Remove single category from event
**Authentication:** Required (JWT)
**Authorization:** User must be calendar owner or editor

**Parameters:**
- `eventId` (path) - UUID of event
- `categoryId` (path) - UUID of category

**Response:** 204 No Content

**Errors:**
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Not calendar owner/editor
- 404 Not Found - Event or category doesn't exist

## Admin Account Management Endpoints

### GET /api/v1/admin/accounts

**Purpose:** List all user accounts with filtering and pagination
**Authentication:** Required (JWT)
**Authorization:** User must have admin role

**Query Parameters:**
- `status` (optional) - Filter by status: active, suspended, pending
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Results per page (default: 50, max: 100)
- `search` (optional) - Search by email or name

**Response:** 200 OK
```json
{
  "accounts": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "User Name",
      "status": "active",
      "role": "user",
      "createdAt": "2025-09-15T10:00:00Z",
      "lastLoginAt": "2025-10-01T14:30:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalCount": 237,
    "limit": 50
  }
}
```

**Errors:**
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Not admin user

### GET /api/v1/admin/applications

**Purpose:** List pending account applications
**Authentication:** Required (JWT)
**Authorization:** Admin only

**Query Parameters:**
- `page` (optional) - Page number
- `limit` (optional) - Results per page

**Response:** 200 OK
```json
{
  "applications": [
    {
      "id": "uuid",
      "email": "applicant@example.com",
      "name": "Applicant Name",
      "message": "I would like to join...",
      "submittedAt": "2025-10-01T09:00:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 2,
    "totalCount": 15,
    "limit": 10
  }
}
```

**Errors:**
- 401 Unauthorized
- 403 Forbidden - Not admin

### POST /api/v1/admin/applications/:id/approve

**Purpose:** Approve account application and create user
**Authentication:** Required (JWT)
**Authorization:** Admin only

**Parameters:**
- `id` (path) - UUID of application

**Request Body:**
```json
{
  "sendWelcomeEmail": true
}
```

**Response:** 200 OK
```json
{
  "account": {
    "id": "new-uuid",
    "email": "applicant@example.com",
    "status": "active",
    "createdAt": "2025-10-02T15:00:00Z"
  }
}
```

**Errors:**
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found - Application doesn't exist
- 409 Conflict - Email already exists

### POST /api/v1/admin/applications/:id/deny

**Purpose:** Deny account application
**Authentication:** Required (JWT)
**Authorization:** Admin only

**Parameters:**
- `id` (path) - UUID of application

**Request Body:**
```json
{
  "reason": "Spam application",
  "sendEmail": false
}
```

**Response:** 200 OK
```json
{
  "success": true
}
```

**Errors:**
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found

### POST /api/v1/admin/invitations

**Purpose:** Send invitation to new user
**Authentication:** Required (JWT)
**Authorization:** Admin only

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "message": "Welcome to our community calendar!"
}
```

**Response:** 201 Created
```json
{
  "invitation": {
    "id": "uuid",
    "email": "newuser@example.com",
    "token": "secure-token",
    "expiresAt": "2025-10-09T15:00:00Z",
    "sentAt": "2025-10-02T15:00:00Z"
  }
}
```

**Errors:**
- 400 Bad Request - Invalid email
- 401 Unauthorized
- 403 Forbidden
- 409 Conflict - Email already registered or invited

## Note on Public Calendar Endpoints

Public calendar routes and APIs are handled by a separate site app infrastructure and are **out of scope** for this specification. The QA report noted 404 errors when testing public calendar access, but these routes are managed independently from the authenticated client API endpoints addressed in this spec.
