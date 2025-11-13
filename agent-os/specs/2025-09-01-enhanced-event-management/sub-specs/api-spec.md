# API Specification

This is the API specification for the spec detailed in @.agent-os/specs/2025-09-01-enhanced-event-management/spec.md

> Created: 2025-09-01
> Version: 1.0.0

## Overview

The Enhanced Event Management feature requires several API endpoints to support bulk operations, event duplication, and enhanced event listing capabilities. This specification documents the required endpoints, their parameters, responses, and error handling patterns.

The API follows the existing domain-driven architecture patterns established in the calendar service, maintaining consistency with current authentication, permission checking, and error handling approaches.

## Endpoints

### POST /api/v1/events/bulk-assign-categories

**Purpose:** Assign categories to multiple events in a single operation  
**Authentication:** Required (logged-in users only)  
**Authorization:** User must have edit permissions on all events' calendars

**Request Body:**
```json
{
  "eventIds": ["uuid1", "uuid2", "uuid3"],
  "categoryIds": ["category-uuid1", "category-uuid2"]
}
```

**Parameters:**
- `eventIds` (array[string], required): Array of event UUIDs to assign categories to
- `categoryIds` (array[string], required): Array of category UUIDs to assign to the events

**Validation Rules:**
- Both arrays must be non-empty
- All IDs must be valid event and category identifiers
- All events must belong to calendars the user can edit
- All events must belong to the same calendar
- All categories must belong to the same calendar as the events

**Response (200 OK):**
```json
[
  {
    "id": "event-uuid1",
    "calendarId": "calendar-uuid",
    "title": "Event Title",
    "categories": [
      {
        "id": "category-uuid1",
        "calendarId": "calendar-uuid",
        "content": {
          "en": {
            "language": "en",
            "name": "Meeting"
          },
          "fr": {
            "language": "fr", 
            "name": "Réunion"
          }
        }
      }
    ]
    // ... other event properties
  }
]
```

**Error Responses:**
- `400 Bad Request`: Invalid request body format or validation errors
- `403 Forbidden`: User lacks edit permissions (`InsufficientCalendarPermissionsError`)
- `404 Not Found`: Events not found (`BulkEventsNotFoundError`) or categories not found (`CategoriesNotFoundError`)
- `422 Unprocessable Entity`: Events from different calendars (`MixedCalendarEventsError`)
- `500 Internal Server Error`: Unexpected server error

### Event Duplication (Client-Side Implementation)

**Implementation Note:** Event duplication will be handled entirely client-side without requiring a new API endpoint. The process works as follows:

1. **Load Existing Event:** Use existing `GET /api/v1/events/:id` endpoint to retrieve event data (through client/service/models.ts )
2. **Strip Event ID:** Remove the `id` field and any other auto-generated fields from the event data
3. **Open Event Editor:** Present the existing `event_editor` Vue component in a modal with pre-populated data
4. **Save as New Event:** When user saves, use existing `POST /api/v1/calendars/:calendar/events` (via client/service/models.ts) endpoint to create new event

**Advantages of Client-Side Approach:**
- No new API endpoints required
- Leverages existing event creation workflow that users are familiar with
- Allows full editing of duplicated event before saving
- Maintains consistency with existing event creation patterns
- Reduces server-side complexity

### GET /api/v1/calendars/:calendar/events (Enhanced)

**Purpose:** List events for a calendar with optional filtering and sorting  
**Authentication:** Required (logged-in users only)  
**Authorization:** User must have view permissions on the calendar

**URL Parameters:**
- `calendar` (string, required): Calendar URL name

**Query Parameters:**
- `search` (string, optional): Text search in event titles and descriptions
- `categories` (string, optional): Comma-separated list of category IDs to filter by
- `sortBy` (string, optional): Field to sort by (`date`, `title`, `category`). Default: `date`
- `sortOrder` (string, optional): Sort direction (`asc`, `desc`). Default: `asc`
- `limit` (number, optional): Maximum number of events to return. Default: 100
- `offset` (number, optional): Number of events to skip for pagination. Default: 0

**Example Request:**
```
GET /api/v1/calendars/community-events/events?search=concert&categories=uuid1,uuid2&sortBy=date&sortOrder=desc&limit=50&offset=0
```

**Response (200 OK):**
```json
{
  "events": [
    {
      "id": "event-uuid",
      "calendarId": "calendar-uuid",
      "title": "Event Title",
      "description": "Event description",
      "startDate": "2025-09-15T10:00:00.000Z",
      "categories": [
        {
          "id": "category-uuid1",
          "calendarId": "calendar-uuid",
          "content": {
            "en": {
              "language": "en",
              "name": "Music"
            },
            "fr": {
              "language": "fr",
              "name": "Musique"
            }
          }
        }
      ],
      // ... other event properties
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

**Error Responses:**
- `400 Bad Request`: Invalid query parameters or calendar name
- `404 Not Found`: Calendar not found
- `500 Internal Server Error`: Unexpected server error

### Single Event Category Management

**Implementation Note:** Individual event category assignment and removal is handled through the existing event editor interface and does not require new API endpoints.

**Category Retrieval:** Event categories are included in responses from existing endpoints:
- `GET /api/v1/events/:id` - Single event with categories
- `GET /api/v1/calendars/:calendar/events` - Event listings with categories

**Category Assignment:** Single event category changes use existing event update workflow:
- Event editor interface manages category assignments
- Uses existing `PUT /api/v1/events/:id` endpoint (via client models service) for updates
- Maintains consistency with current event editing experience

## Controllers and Business Logic

### EventRoutes Controller

**Location:** `src/server/calendar/api/v1/events.ts`

**New/Enhanced Methods:**

#### bulkAssignCategories(req, res)
- Validates request body contains valid arrays of event and category UUIDs
- Delegates to `CalendarService.bulkAssignCategories(account, eventIds, categoryIds)`
- Handles domain-specific exceptions and maps to appropriate HTTP status codes
- Returns updated events with their assigned categories

#### Event Duplication (Client-Side Only)
- No server-side controller method needed
- Uses existing event retrieval and creation endpoints
- Event duplication logic handled entirely in the frontend Vue components

#### listEvents(req, res) - Enhanced
- Maintains existing functionality for calendar-based event listing
- Adds support for query parameters: search, categories, sortBy, sortOrder
- Implements server-side filtering and sorting when parameters provided
- Returns paginated results with metadata for client-side pagination controls

### Service Layer Integration

**Location:** `src/server/calendar/service/calendar.ts`

**Expected Service Methods:**

#### bulkAssignCategories(account: Account, eventIds: string[], categoryIds: string[]): Promise<Event[]>
- Validates user permissions for all events
- Ensures all events belong to same calendar
- Verifies all categories exist and belong to same calendar as events
- Creates category assignments in batch operation
- Returns updated events with assigned categories

#### Event Duplication (Client-Side Implementation)
- No new service method required
- Frontend components handle event data retrieval, ID stripping, and creation
- Uses existing `getEvent()` and `createEvent()` service methods

#### Enhanced Event Listing
- Extends existing `listEvents` method with filtering capabilities
- Implements text search across event titles and descriptions
- Applies category filtering using existing category assignment relationships
- Supports sorting by multiple fields with proper collation

## Error Handling Patterns

### Domain Exception Mapping

The API follows established patterns for mapping domain exceptions to HTTP status codes:

- **BulkEventsNotFoundError** → 404 Not Found
- **MixedCalendarEventsError** → 422 Unprocessable Entity
- **CategoriesNotFoundError** → 404 Not Found
- **InsufficientCalendarPermissionsError** → 403 Forbidden

### Error Response Format

All error responses follow the established format:

```json
{
  "error": "Human-readable error message",
  "errorName": "DomainExceptionClassName"
}
```

### Validation Error Examples

**Invalid Request Body:**
```json
{
  "error": "eventIds must be a non-empty array"
}
```

**Permission Denied:**
```json
{
  "error": "Insufficient permissions to edit calendar events",
  "errorName": "InsufficientCalendarPermissionsError"
}
```

**Resource Not Found:**
```json
{
  "error": "One or more events were not found",
  "errorName": "BulkEventsNotFoundError"
}
```

## Integration Notes

### Existing API Consistency

The enhanced endpoints maintain consistency with existing API patterns:

- Authentication using `ExpressHelper.loggedInOnly` middleware
- Account extraction from `req.user` for authenticated endpoints
- Domain service delegation for all business logic
- Consistent error handling and status code mapping
- Standard JSON response formats

### Database Transaction Support

Bulk operations should be implemented with proper transaction support to ensure data consistency:

- All category assignments in a bulk operation succeed or fail together
- Event duplication includes all related data (media, categories) atomically
- Proper rollback handling for failed operations

### Performance Considerations

- Bulk operations should use efficient database queries (batch inserts/updates)
- Event listing with filtering should use appropriate database indexes
- Large result sets should implement proper pagination
- Search functionality should consider full-text search capabilities if available

This API specification provides the foundation for implementing enhanced event management capabilities while maintaining consistency with existing system architecture and patterns.