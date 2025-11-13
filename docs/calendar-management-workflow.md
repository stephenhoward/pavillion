# Calendar Management Workflow

> Testing Date: 2025-10-02
> Status: ⚠️ Partially Functional (Categories broken)

## Creating a Calendar

### First Calendar Experience

**URL:** `/calendar` (post-login redirect)

**Interface:**
- Prominent section: "Create your first calendar"
- Form labeled "New Calendar Form"
- Calendar Name input field
  - Placeholder: `your-calendar-name`
  - Suffix displayed: `@pavillion.dev`
- Validation text: "Calendar names must be 3-24 characters long, start with a letter or number, and can only contain letters, numbers, and underscores"
- "Create Your Calendar" button

### Test Case 1: Invalid Name (Hyphens)

**Test:** `test-calendar`

**Result:** ❌ **FAILED**

**Error Message:**
```
Invalid calendar name format
```

**Console Errors:**
```
Failed to load resource: the server responded with a status of 400 (Bad Request)
Error creating calendar: AxiosError
Error creating calendar: InvalidUrlNameError: Invalid Calendar URL name format
```

**Analysis:**
- Form placeholder shows `your-calendar-name` (with hyphens), misleading users
- Backend rejects hyphens despite common URL convention
- Error message is generic and doesn't explain the specific issue
- User must trial-and-error to discover underscores work

**UX Issue:**
The placeholder example uses the exact format that is rejected by validation, creating a confusing user experience.

### Test Case 2: Valid Name (Underscores)

**Test:** `test_calendar`

**Result:** ✅ **SUCCESS**

**Outcome:**
- Calendar created successfully
- Assigned ID: `efca7f7a-739f-4641-8f0b-5e993a8703bd` (UUID format)
- Redirected to: `/calendar/test_calendar`
- Calendar name displayed as: `test_calendar@pavillion.dev`
- "Manage Calendar" link appears

**Post-Creation State:**
- Calendar appears in system
- URL slug uses the calendar name: `/calendar/test_calendar`
- Full identifier: `test_calendar@pavillion.dev` (ActivityPub compatible)
- "Manage Calendar" link points to: `/calendar/{uuid}/manage`

## Calendar View Page

**URL Structure:**
- Friendly URL: `/calendar/test_calendar`
- Management URL: `/calendar/efca7f7a-739f-4641-8f0b-5e993a8703bd/manage`

**Interface Elements:**
- Page title: `test_calendar@pavillion.dev`
- "Manage Calendar" button
- Search Events field with placeholder: "Search by event name or description..."
- "Filter by Categories" section (displays categories if they exist)
- Events list or "No events" empty state
- "Create an Event" button (in empty state)
- "Select All" checkbox for bulk operations
- Event selection checkboxes
- Duplicate event button (📄 icon) per event

**Search and Filter Interface:**
✅ Search field present
✅ Category filter interface present (shows existing category "Community Events")
⚠️ Category checkbox available but functionality depends on broken API

**Console Warning:**
```
[Vue warn]: injection "currentLanguage" not found at <SearchFilter>
```

**Bulk Operations:**
- Individual event selection checkboxes
- "Select All" functionality
- Selected events can be deleted (based on UI)
- Event duplication appears per-event (not bulk)

## Calendar Management Interface

**URL:** `/calendar/{uuid}/manage`

**Tabs:**
1. Categories (selected by default)
2. Editors

### Categories Tab

**Status:** 🔴 **BROKEN**

**Interface:**
- Error message: "Failed to load categories"
- Empty state: "No categories"
- Description: "You haven't created any event categories yet."
- "Add Category" button

**Attempting to Create Category:**

**Steps:**
1. Click "Add Category"
2. Dialog opens: "Add a Category"
3. Enter category name in "English:" field: `Community Events`
4. "Create Category" button becomes enabled
5. Click "Create Category"
6. Dialog closes
7. Categories list still shows "Failed to load categories"

**Console Errors:**
```
Failed to load resource: the server responded with a status of 404 (Not Found)
Error loading calendar categories: AxiosError
Error loading categories: AxiosError
```

**JavaScript Error:**
```
TypeError: categoryNameInput.value.focus is not a function
```

**Impact:**
- Categories cannot be created (API endpoint missing)
- Categories cannot be assigned to events
- Category filtering is non-functional
- Event organization severely limited

**Dialog Interface:**
- Title: "Add a Category"
- Subtitle: "Enter a descriptive name for this category"
- Language selector: "English:" (currently shown)
- Text input for category name
- "Add Language" button (for multilingual category names)
- "Create Category" button
- "Cancel" button
- Close button (×)

**Multilingual Support:**
The interface supports adding category names in multiple languages, consistent with the i18n architecture.

### Editors Tab

**Status:** ✅ **UI Functional** (Backend not fully tested)

**Interface:**
- Empty state: "No editors have been granted access to this calendar."
- Description: "Add editors to allow others to manage this calendar with you."
- "Add Editor" button

**Add Editor Dialog:**

**Interface:**
- Title: "Add Editor"
- "Account ID" input field
  - Placeholder: "user@domain.com or username"
  - Help text: "Enter the account ID or email address of the person you want to grant edit access to."
- "Add Editor" button (disabled until input provided)
- "Cancel" button
- Close button (×)

**Behavior:**
- Dialog opens successfully
- Form validation appears to work (button disabled when empty)
- Did not test actual editor invitation (no second user account available)

**Expected Workflow:**
1. Enter email or username of user to invite
2. System sends invitation
3. Target user receives notification
4. User accepts invitation
5. User appears in editors list
6. User gains edit access to calendar

**Implementation Notes:**
Based on CLAUDE.md, the system supports "Multi-Editor Calendars" and "Editor Invitations" as completed features in Phase 0.

## Navigation Breadcrumb

**Management Page Navigation:**
- Link: "📅 test_calendar /"
  - Target: `/calendar/test_calendar`
  - Returns to calendar view
- Text: "calendar settings" (non-clickable label)

**Purpose:** Allows quick navigation back to calendar view from management interface

## Event List Display

**When Events Exist:**
- List view with event cards
- Each event shows:
  - Event title (h3)
  - Event description (paragraph)
  - Selection checkbox
  - Duplicate button (📄)
- Events are clickable (opens edit dialog)

**Empty State:**
- Heading: "No events"
- Message: "You don't have any events in this calendar yet."
- "Create an Event" button (prominent CTA)

## Calendar Deletion

**Status:** 🟡 **NOT VISIBLE** in tested interface

**Observation:**
No obvious "Delete Calendar" option found in the management interface. This may be:
- Hidden in a menu not explored
- Restricted to prevent accidental deletion
- Not yet implemented
- Available only through admin interface

## Public Calendar Access

**Status:** 🔴 **BROKEN**

**Tested URLs:**
- `/test_calendar` → 404 "No match found"
- `/site/test_calendar` → 404 "No match found"

**Console Errors:**
```
[Vue Router warn]: No match found for location with path "/test_calendar"
[Vue Router warn]: No match found for location with path "/site/test_calendar"
```

**Impact:**
- Anonymous users cannot view public calendars
- Core mission of "anonymous public access" is not functional
- Calendar federation may be broken (external instances need public access)
- Public calendar embedding would not work

**Expected Behavior:**
Based on mission.md:
- "Anonymous Public Access: Event attendees can browse and discover events without creating accounts"
- "Public Calendar Views: Anonymous access to calendar content via site app"

The site app (`src/site/`) exists in the codebase but routes are not properly configured.

## API Integration

**Working Endpoints:**
- `POST /api/v1/calendars` - Create calendar
- `GET /api/v1/calendars` - List user's calendars
- `GET /api/v1/calendars/{id}` - Get calendar details

**Broken Endpoints:**
- `GET /api/v1/calendars/{id}/categories` → 404
- `POST /api/v1/calendars/{id}/categories` → 404 (inferred)
- `GET /api/v1/calendars/{id}/editors` - Not tested but UI loads

## Data Model

**Calendar Properties (observed):**
- `id`: UUID (e.g., `efca7f7a-739f-4641-8f0b-5e993a8703bd`)
- `urlName`: String (e.g., `test_calendar`)
- `displayName`: Formatted as `{urlName}@{domain}` (e.g., `test_calendar@pavillion.dev`)
- Associated events (collection)
- Associated categories (intended, but not functional)
- Associated editors (intended)
- Owner account (implicit)

**Validation Rules:**
- Length: 3-24 characters
- Must start with: letter or number
- Allowed characters: letters, numbers, underscores
- Not allowed: hyphens, spaces, special characters

## Recommendations

### Critical Fixes

1. **Fix category API endpoints**
   - Implement missing routes
   - Ensure proper authentication/authorization
   - Fix JavaScript focus() error in dialog

2. **Configure public calendar routes**
   - Enable anonymous access via `/site/{urlName}` or `/{urlName}`
   - Implement public calendar viewing
   - Essential for core mission

3. **Fix calendar name validation UX**
   - Change placeholder from `your-calendar-name` to `your_calendar_name`
   - Improve error message: "Calendar names cannot contain hyphens. Use underscores instead."
   - Or allow hyphens in URL names

### Enhancements

4. **Add calendar deletion functionality**
   - Provide clear path to delete calendar
   - Implement confirmation dialog
   - Handle associated events (cascade delete or prevent deletion)

5. **Improve empty states**
   - Add example/demo calendar option
   - Provide quick start guide
   - Link to documentation

6. **Test editor invitations thoroughly**
   - Create second test user
   - Complete invitation workflow
   - Verify permission inheritance

7. **Fix SearchFilter language injection warning**
   - Resolve missing "currentLanguage" injection
   - Ensure multilingual search works correctly

## User Scenarios

### Successful Scenario: Event Organizer

✅ Organization creates account
✅ Logs in successfully
✅ Creates calendar with valid name (using underscores)
✅ Views empty calendar
✅ Creates first event (without categories)
✅ Views event in calendar list
✅ Edits event details
⚠️ Cannot organize events with categories (broken)
❌ Cannot share calendar publicly (no public routes)

### Blocked Scenario: Community Curator

✅ Creates calendar for community events
❌ Cannot create event categories to organize by type
❌ Cannot assign categories to events
❌ Public cannot view calendar (no public access)
❌ Cannot effectively curate content without categories

## Related Workflows

- [Event Management](./event-management-workflow.md)
- [Authentication](./authentication-workflow.md)
- [Admin Interface](./admin-workflow.md)
