# Specification: Location Management Fixes

## Goal

Fix three critical bugs in the event location management system that cause data loss (country field), allow invalid data entry (missing hierarchy validation), and block user workflows (404 errors on event updates).

## User Stories

### Story 1: Preserve Country Data
As an event organizer, I want location country information to be preserved when I edit events, so that I don't lose important location data and have to re-enter it every time I make changes.

**Current Problem:** When editing an event, the country field is lost because `EventLocation.fromObject()` doesn't include the country parameter in its deserialization logic (line 45 of `src/common/model/location.ts`). This causes data loss on every edit operation.

### Story 2: Prevent Invalid Location Data
As an event organizer, I want to be prevented from entering invalid location combinations (like specifying a postal code without an address), so that location data remains consistent and useful for event attendees.

**Current Problem:** The system allows any combination of location fields to be entered, including logically invalid combinations like "postal code without address" or "state without city". This creates poor data quality and confusing location information.

### Story 3: Successfully Edit Events
As an event organizer, I want to successfully save my event edits without encountering errors, so that I can keep my event information up-to-date.

**Current Problem:** Event updates return 404 errors under certain conditions, blocking users from editing their events. The root cause is unknown and needs to be investigated.

## Core Requirements

- **LOC-001: Fix Country Field Data Loss**
  - Add `country` parameter to `EventLocation.fromObject()` method (line 45 in `src/common/model/location.ts`)
  - Ensure country field is included in model serialization/deserialization
  - Verify country data persists through edit operations
  - Country field remains optional (no UI changes in this spec)

- **LOC-002: Implement Location Hierarchy Validation**
  - Validate location field hierarchy on both client and server
  - Enforce bottom-up validation rules:
    - Name only: Valid (no other fields required)
    - City requires Address
    - State requires City AND Address
    - Postal Code requires State AND City AND Address
  - Display all validation errors at once when user attempts to save (not on blur)
  - Highlight invalid fields in standard warning color
  - Show clear, brief error messages (format: "City requires Address to be filled in")

- **LOC-003: Fix Event Update 404 Error**
  - Use Playwright MCP to reproduce the 404 error
  - Investigate both frontend (edit_event.vue) and backend (events API) code paths
  - Check both new location creation and existing location editing scenarios
  - Identify and fix root cause of 404 responses
  - Ensure event updates succeed in all valid scenarios

## Visual Design

No visual mockups provided. Use existing UI patterns:
- Invalid fields should be highlighted with standard warning color (same as other form validation)
- Error messages should appear above the form or in a dedicated error section
- Follow existing form validation display patterns used elsewhere in the application

## Reusable Components

### Existing Code to Leverage

**Models:**
- `EventLocation` class in `src/common/model/location.ts` (lines 7-63)
- Constructor already supports all fields including country (line 27)
- `toObject()` method correctly serializes country field (line 53-61)

**Entities:**
- `LocationEntity` in `src/server/calendar/entity/location.ts`
- Already has country field in database schema (line 32-33)
- `toModel()` and `fromModel()` correctly handle country field (lines 38-52)

**Services:**
- `LocationService` in `src/server/calendar/service/locations.ts`
- Uses `EventLocation.fromObject()` in `findOrCreateLocation()` (lines 50, 52)

**API Endpoints:**
- Event update endpoint in `src/server/calendar/api/v1/events.ts` (lines 104-152)
- Handles `EventNotFoundError`, `CalendarNotFoundError`, and `InsufficientCalendarPermissionsError`

**Frontend Components:**
- `edit_event.vue` in `src/client/components/logged_in/calendar/` (lines 311-358)
- Location form fields already present (name, address, city, state, postalCode)
- Existing error display pattern (lines 244-249)
- Existing form validation styling (lines 92-94)

### New Components Required

**Validation Logic:**
- Location hierarchy validator (new utility function)
- Will be used by both client-side (Vue component) and server-side (API/service)
- Cannot reuse existing validation patterns as this is domain-specific logic

**Error Display:**
- Location-specific error messages
- Will follow existing error display pattern but needs location-specific validation rules

## Technical Approach

### LOC-001: Country Field Fix
- Simple parameter addition to `EventLocation.fromObject()` method
- One-line fix: add `obj.country` as 7th parameter to constructor call
- Verify with unit test that country field round-trips through serialization

### LOC-002: Validation Implementation
- Create shared validation function that enforces hierarchy rules
- Implement validation in two places:
  1. **Client-side**: In `edit_event.vue` saveModel() method before API call
  2. **Server-side**: In EventService or LocationService before database operations
- Validation should return array of error messages for invalid fields
- Client displays errors above form and highlights invalid fields
- Server returns 400 Bad Request with validation errors

### LOC-003: 404 Error Investigation
- Use Playwright MCP to reproduce the issue:
  1. Create event with location
  2. Edit event and modify location
  3. Observe if 404 error occurs
- Check potential causes:
  - Location ID mismatch or invalid URL
  - Missing location record in database
  - Permission check failing incorrectly
  - Calendar lookup failing in update path
- Fix will depend on root cause identified during investigation

### Implementation Order
1. Fix LOC-001 (country field) - cleanest, standalone fix
2. Fix LOC-003 (404 error) - unblock editing workflow
3. Implement LOC-002 (validation) - prevents future invalid data

### Separate Commits
Each bug fix should be in its own commit:
- Commit 1: "fix: add country parameter to EventLocation.fromObject() [LOC-001]"
- Commit 2: "fix: resolve event update 404 error [LOC-003]"
- Commit 3: "feat: add location hierarchy validation [LOC-002]"

## Out of Scope

- Country field UI display (decision deferred to future work)
- Location autocomplete from previously used venues (roadmap Phase 1 feature)
- Location validation and standardization (roadmap Phase 1 feature)
- Bulk location updates across events (roadmap Phase 1 feature)
- End-to-end Playwright tests (deferred per requirements)
- Database migration for existing invalid data (all current data is test data)
- Adding country field to the event editing UI form

## Success Criteria

### LOC-001 Success Criteria
- Country field data persists through event edit operations
- Unit test verifies `EventLocation.fromObject()` includes country parameter
- No data loss when editing events with country information

### LOC-002 Success Criteria
- Invalid location combinations are rejected by both client and server
- Clear error messages guide users to correct invalid entries
- All validation errors display simultaneously on save attempt
- Invalid fields are visibly highlighted with warning color
- Valid location combinations (including name-only) are accepted

### LOC-003 Success Criteria
- Event updates complete successfully without 404 errors
- Both new and existing location scenarios work correctly
- Root cause identified and documented in commit message
- Integration tests verify fix prevents regression

### Testing Coverage
- Unit tests for location hierarchy validation logic
- Integration tests for API validation endpoints
- Unit tests for EventLocation model serialization
- No e2e Playwright tests required in this spec
