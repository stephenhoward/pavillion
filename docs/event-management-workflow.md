# Event Management Workflow

> Testing Date: 2025-10-02
> Status: ⚠️ Partially Functional (Works without categories)

## Creating an Event

### Entry Points

**Three ways to create events:**
1. Click "New Event" button in main navigation (always visible)
2. Click "Create an Event" button from empty calendar state
3. Click "Create an Event" from calendar view (when events exist)

### Event Creation Dialog

**Title:** "Create Event"

**Interface Layout:**
- Banner with title and close button (×)
- Main scrollable form area
- Action buttons at bottom

**Form Sections:**
1. Event Description
2. Location
3. Image
4. Event Categories
5. Dates

## Event Description Section

**Status:** ✅ **Functional**

**Fields:**

### Language Selector
- Dropdown: Currently shows "English"
- "Add a Language" button (➕) for multilingual content
- Per-language content blocks

**Current Language Fields:**
- **Event Name** (required)
  - Text input
  - Placeholder: "event name"
  - Successfully tested with: "Community Meetup"

- **Event Description** (required)
  - Text area
  - Placeholder: "event description"
  - Successfully tested with: "A monthly community gathering for local residents"

- **Remove Language Button**
  - "Remove This Language" button
  - Allows removing language variant
  - Cannot remove if only one language remains (assumed)

### Multilingual Support

**Capabilities:**
- Add multiple language variants for same event
- Each language has separate name and description
- Language selector shows available languages
- Switch between languages to edit content
- Consistent with i18next 25.0+ architecture

**Not Tested:**
- Adding second language
- Switching between languages
- Displaying events in non-English locales

## Location Section

**Status:** ✅ **Functional**

**Fields:**

1. **Location Name**
   - Text input
   - Placeholder: "name"
   - Tested with: "Community Center"
   - Creates reusable venue data

2. **Address**
   - Text input
   - Placeholder: "event address"
   - Not tested (left empty)

3. **City**
   - Text input
   - Placeholder: "city"
   - Tested with: "Portland"

4. **State/Province**
   - Text input
   - Placeholder: "state"
   - Not tested (left empty)

5. **Postal Code**
   - Text input
   - Placeholder: "zip code"
   - Not tested (left empty)

**Data Model:**
According to tech stack documentation, location management includes:
- Reusable venue data
- Structured location information
- Appears to be stored separately (can be reused across events)

**Observations:**
- All location fields optional (event created successfully without complete address)
- City and location name were sufficient
- No geocoding or map integration visible
- No location autocomplete from previously used venues (mentioned as Phase 1 feature)

## Image Section

**Status:** 🟡 **Not Tested**

**Interface:**
- Drag-and-drop zone
- Upload icon image
- Text: "Drag and drop an image here"
- Text: "or click to select a file"
- "Browse Files" button (appears on hover/interaction)

**Supported Formats:**
- .jpg
- .jpeg
- .png
- .heic

**File Size Limit:**
- Maximum: 10 MB

**Help Text:**
- "Drag a single file or click to browse"

**Implementation Notes:**
- Based on tech stack: Multer 2.0+ for uploads
- Flydrive 1.2+ storage abstraction
- S3-compatible storage support
- Single media attachment per event (as documented)

**Why Not Tested:**
- Image upload would require file system interaction
- Focused on core workflow testing
- File upload visible and appears functional

## Event Categories Section

**Status:** 🔴 **BROKEN**

**Interface:**
- Section labeled "Event Categories"
- Subsection: "Select Event Categories"
- Label: "Categories"
- Error message: "Error loading categories"

**Console Errors:**
```
Failed to load resource: the server responded with a status of 404 (Not Found)
Error loading calendar categories: AxiosError
Error loading categories: AxiosError
```

**Impact:**
- Cannot assign categories to events during creation
- Events created without category associations
- Organization and filtering severely limited

**Expected Behavior:**
Should display list of calendar's categories with checkboxes to select multiple categories for the event.

## Dates Section

**Status:** ✅ **Functional**

**Interface:**
- "Event Schedules" group
- Multiple schedules supported ("Add another date" button)
- Each schedule includes:
  - Date/time picker (datetime-local input)
  - "repeats:" dropdown selector

**Recurrence Options:**
- Never (one-time event)
- Daily
- Weekly
- Monthly
- Yearly

**Test Case:**

**Input:** `2025-10-15T18:00`

**Result:** ✅ **Accepted**

**Format:** ISO datetime-local format (YYYY-MM-DDThh:mm)

**Recurrence Library:**
- RRule 2.8+ for recurring event patterns
- Luxon 3.5+ for date/time handling
- Full timezone support

**Multiple Schedules:**
- "Add new schedule" button present
- Allows events to occur on multiple dates
- Each schedule can have different recurrence pattern
- Useful for events with irregular schedules

**Not Tested:**
- Creating recurring event
- Adding multiple schedules
- Timezone handling (assumed local timezone)
- All-day events (if supported)

## Form Actions

**Buttons:**
1. **"Create Event"** (primary action)
   - Creates event and closes dialog
   - Successfully creates event despite category API failure
   - Returns to calendar view with new event visible

2. **"Close"** (secondary action)
   - Cancels event creation
   - Discards entered data (no save draft)
   - Returns to previous view

**No visible "Save Draft" functionality**

## Event Creation Success

**Result of Test:**
- Event "Community Meetup" created successfully
- Appeared in calendar list immediately
- No page reload required (Vue.js reactive updates)
- Event card displays:
  - Title: "Community Meetup"
  - Description: "A monthly community gathering for local residents"
  - Selection checkbox
  - Duplicate button (📄)

**Event ID:**
Events presumably assigned UUID like calendars (not visible in UI)

## Editing an Event

### Opening Edit Dialog

**Methods:**
1. Click event card in calendar list
2. Event details expand or dialog opens

**Test Case:**
Clicked "Community Meetup" event card

**Result:** ✅ **Edit dialog opened**

### Edit Event Dialog

**Title:** "Edit Event"

**Interface:**
- Identical layout to Create Event dialog
- All fields prepopulated with existing data
- Same sections: Description, Location, Image, Categories, Dates

**Prepopulated Data:**
✅ Event Name: "Community Meetup"
✅ Event Description: "A monthly community gathering for local residents"
✅ Location Name: "Community Center"
✅ City: "Portland"
✅ Date/time: Shown in picker (exact value not captured)

**Categories Section:**
🔴 Still shows "Error loading categories"

**Form Actions:**
1. **"Update Event"** (primary action)
   - Saves changes
   - Closes dialog
   - Updates event in calendar list

2. **"Close"** (secondary action)
   - Cancels editing
   - Discards unsaved changes
   - Returns to calendar view

**Changes Tested:**
- Closed dialog without making changes
- Event remained unchanged (correct behavior)

## Event Display in Calendar

**List View:**
- Events shown as cards/articles
- Clickable to edit
- Checkbox for selection (bulk operations)
- Duplicate button per event

**Card Contents:**
- Event title (h3 heading)
- Event description (paragraph)
- No date display on card (interesting omission)
- No category badges (feature broken)
- No location display on card
- No thumbnail image

**Search Interface:**
- Search field: "Search by event name or description..."
- Real-time filtering (assumed, not tested)

**Filter Interface:**
- "Filter by Categories" section
- Shows available categories (when API works)
- Category: "Community Events" (from failed creation attempt still cached?)
- Checkbox per category

## Event Duplication

**Interface:** 📄 Duplicate button visible per event

**Status:** 🟡 **Not Tested**

**Expected Behavior:**
- Click duplicate button
- Create copy of event with same details
- Possibly open in edit dialog to modify
- Useful for template-based event creation
- Mentioned in roadmap Phase 1

**Use Case:**
Event organizer wants to create similar events (e.g., monthly meetups) without re-entering all details.

## Bulk Operations

**Selection:**
- Individual checkboxes per event
- "Select All" checkbox (selects all visible events)

**Available Actions:**
Based on UI, likely bulk delete (not tested)

**Not Visible:**
- Bulk category assignment
- Bulk export
- Bulk date modification

## Event Deletion

**Individual Deletion:**
Not obviously visible in tested interface. Possible locations:
- Inside edit dialog (not found)
- Right-click context menu
- Bulk selection → delete

**Bulk Deletion:**
Visible selection mechanism suggests bulk delete is available

**Status:** 🟡 **Not Fully Explored**

## Event Validation

**Required Fields:**
Based on successful creation with minimal data:
- Event name (required)
- Event description (required)
- At least one date/time (required)

**Optional Fields:**
- All location details (event created without full address)
- Image
- Categories (broken, but optional when working)
- Additional schedules

**No visible client-side validation errors**
- Form appears to validate on submission
- Server returns errors (seen with calendar name validation)

## Performance

**Observations:**
✅ Dialog opens instantly
✅ Form fields responsive
✅ Event creation quick (under 1 second)
✅ Event appears in list immediately (reactive update)
✅ Edit dialog prepopulates quickly

**No lag or loading spinners observed during testing**

## Data Persistence

**After event creation:**
- Event persisted to database (Sequelize ORM)
- Event reappeared after navigation away and back
- Edit dialog shows correct saved data

**Event Instances:**
According to tech stack documentation:
- Complex recurring events using RRule
- Event instances managed separately
- Timezone handling via Luxon

## API Integration

**Inferred Working Endpoints:**
- `POST /api/v1/calendars/{id}/events` - Create event
- `GET /api/v1/calendars/{id}/events` - List events
- `GET /api/v1/events/{id}` - Get event details
- `PUT/PATCH /api/v1/events/{id}` - Update event

**Broken Endpoints:**
- `GET /api/v1/calendars/{id}/categories` - For category selection

## Multilingual Event Content

**Capabilities (based on interface):**
- Create event name/description in multiple languages
- Switch language in edit mode
- Display events in user's preferred language
- Essential for diverse communities

**i18n Implementation:**
- i18next 25.0+ with Vue integration
- Browser language detection
- Translation files in `src/*/locales/`

**Not Tested:**
- Creating event in multiple languages
- Viewing event in different language
- Language fallback behavior

## Media Attachments

**Current Implementation:**
- Single image per event
- Drag-and-drop upload interface
- File size and format restrictions clearly stated
- Image presumably displayed:
  - In event list (thumbnail)
  - In event detail view
  - In public calendar view

**Future Enhancement (Phase 2):**
According to roadmap:
- Event image galleries
- Enhanced media display
- Location maps integration

## Issues and Recommendations

### Critical Issues

1. **Category API completely broken**
   - Events cannot be organized
   - Filtering non-functional
   - Major feature gap

2. **Event date not displayed in list view**
   - Users cannot see when events occur without clicking
   - Poor usability for calendar overview

### Usability Issues

3. **No visible delete option**
   - Users may struggle to remove events
   - Should be in edit dialog or context menu

4. **No "Save Draft" functionality**
   - Users lose work if they close dialog accidentally
   - Complex events require multiple sessions

5. **Location fields could benefit from:**
   - Autocomplete from previous venues
   - Google Maps integration
   - Geocoding validation

### Enhancement Opportunities

6. **Event card could show:**
   - Date/time (critical omission)
   - Location name
   - Category badges
   - Event image thumbnail
   - Quick actions (edit, duplicate, delete)

7. **Add all-day event option**
   - Not clear if datetime-local supports this
   - Common use case for many events

8. **Event preview/detail view**
   - Before committing to edit mode
   - Show all event details formatted

9. **Confirmation dialogs**
   - When closing with unsaved changes
   - When deleting events

10. **Field validation feedback**
    - Real-time validation as user types
    - Clear error messages for invalid input

## User Scenarios

### Successful Scenario: Community Organizer

✅ Clicks "New Event"
✅ Enters event name and description
✅ Adds location information (partial)
✅ Selects date and time
✅ Saves event successfully
✅ Event appears in calendar
✅ Can edit event later
⚠️ Cannot assign categories (API broken)
⚠️ Doesn't see date in calendar list (UX issue)

### Blocked Scenario: Event Series Creator

✅ Creates first event successfully
❌ Cannot assign category to organize series
🟡 Could use recurring events (not tested)
🟡 Could duplicate events (not tested)
⚠️ Would need to manually create each if duplication doesn't work

## Related Workflows

- [Calendar Management](./calendar-management-workflow.md)
- [Category Management](./category-workflow.md) (broken)
- [Public Event Viewing](./public-calendar-workflow.md) (broken)
