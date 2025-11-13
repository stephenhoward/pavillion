# Specification: Event Location Management QA Testing

## Goal

Execute comprehensive QA testing of Pavillion's event location management functionality using Playwright MCP to verify existing features, identify bugs, and document missing functionality. This testing spec focuses on location creation, reuse, persistence, and data integrity across the entire location lifecycle.

## User Stories

### Calendar Owner Testing Location Features

As a calendar owner/editor, I want to create events with location information, so that event attendees know where events take place.

**Workflow:**
1. Create events with complete location information (name, address, city, state, postal code, country)
2. Create additional events at the same location and have the system reuse existing location records
3. Edit event locations and observe how changes create new location records
4. Delete events and confirm that location data persists in the database
5. Verify that locations are scoped to calendars and not shared across calendars

**Problem Solved:** Ensures location data integrity, proper reuse of locations, and persistence across event lifecycle operations.

### QA Engineer Documenting Bugs and Gaps

As a QA engineer, I want to identify and document bugs and missing features in the location management system, so that development priorities can be established.

**Workflow:**
1. Test all location-related workflows systematically using Playwright MCP
2. Verify expected behavior against actual behavior in the UI
3. Investigate API responses and console errors when behavior is unexpected
4. Document bugs with reproduction steps and technical details
5. Categorize missing features by priority and impact

**Problem Solved:** Creates comprehensive documentation of location management system state, bugs, and enhancement opportunities.

## Core Requirements

### Location CRUD Operations Testing
- **Create locations** through event creation form with all field combinations
- **Reuse existing locations** when exact match exists (all fields identical)
- **Create new locations** when fields differ even slightly from existing
- **Edit locations** by creating events with modified location data
- **Verify persistence** of location records after event deletion

### Bug Identification and Documentation
- **Country field data loss** - Confirm EventLocation.toObject() strips country field
- **Missing hierarchy validation** - Verify no validation prevents address without city
- **Missing country UI field** - Confirm event editor has no country input
- **Document all issues** with reproduction steps and expected behavior

### Missing Features Documentation
- **Location browsing/autocomplete** - Document absence of location selection interface
- **Duplicate detection** - Confirm no warnings about similar locations
- **Location editor** - Document no standalone location management interface
- **Default country setting** - Note user-suggested enhancement not implemented
- **Location usage statistics** - Document no visibility into location reuse

### Playwright MCP Testing Strategy
- **Primary focus:** UI behavior verification (form interactions, visual feedback, submissions)
- **Secondary focus:** API responses and console errors when debugging issues
- **Document approach:** Record both user-visible symptoms and underlying technical causes
- **Test isolation:** Each automated test sets up independent data; manual testing can use one session

### Database Verification
- **Query location records** to verify creation, reuse, and persistence patterns
- **Check orphaned locations** (locations with no event references)
- **Verify cross-calendar isolation** (locations scoped to calendar_id)
- **Confirm exact match logic** (all fields must match for reuse)
- **Check data integrity** (country field loss, invalid hierarchies)

## Visual Design

No visual mockups provided. Testing will use existing event editor interface located at:
- **Component:** `src/client/components/logged_in/calendar/edit_event.vue`
- **Location fieldset:** Lines 312-358
- **Current fields:** Location Name, Address, City, State/Province, Postal Code
- **Missing field:** Country (bug to be verified)

## Reusable Components

### Existing Code to Leverage

**Backend Services:**
- `src/server/calendar/service/locations.ts` - LocationService with findLocation(), createLocation(), findOrCreateLocation()
- `src/server/calendar/entity/location.ts` - LocationEntity database model with toModel() and fromModel()
- `src/common/model/location.ts` - EventLocation shared model (contains toObject() bug)

**Frontend Components:**
- `src/client/components/logged_in/calendar/edit_event.vue` - Event editor with location fieldset (lines 312-358)

**Database Schema:**
- `location` table with calendar_id foreign key, URL-based ID format
- No cascade delete - locations persist after event deletion
- All fields are optional strings (name, address, city, state, postal_code, country)

**Test Patterns:**
- Existing Vitest test structure in `src/server/calendar/test/`
- Database verification queries from existing integration tests

### New Components Required

**Playwright MCP Test Scripts:**
- No existing Playwright tests for location management
- Need new test scripts for all 11 scenarios
- Manual testing workflow using Playwright MCP for in-browser verification

**Database Verification Queries:**
- New SQL queries to verify location persistence, reuse, and orphaned records
- Queries to check country field data loss
- Queries to find invalid location hierarchies

## Technical Approach

### Testing Tool: Playwright MCP

**Why Playwright MCP:**
- In-browser automated testing with real UI interaction
- Can verify visual feedback and form behavior
- Can inspect API responses and console errors when debugging
- Provides both user-perspective and technical-perspective insights

**Testing Approach:**
1. Start with UI-level observations (what user sees and experiences)
2. Verify form field behavior, submissions, success/error messages
3. Drill into API responses and console when behavior is unexpected
4. Document both symptoms (UI) and underlying causes (technical details)

### Test Execution Strategy

**Manual Testing with Playwright MCP:**
- Execute all 11 scenarios in a single session (acceptable for manual testing)
- Document UI observations at each step
- Query database at checkpoints to verify backend state
- Investigate API/console when behavior doesn't match expectations

**Test Data Independence:**
- For automated tests (future): Each test sets up and cleans up its own data
- For manual testing: Single session is acceptable, document database state

**Database Verification Points:**
- After location creation: Verify location record exists with correct calendar_id
- After location reuse: Verify no new location created, same ID referenced
- After event deletion: Verify location persists, no cascade delete
- After cross-calendar test: Verify separate location records per calendar
- After country field test: Verify country data loss on UI edit

### Known Bugs to Verify

**Bug 1: Country Field Data Loss (CRITICAL)**
- **Component:** `src/common/model/location.ts` line 53-62
- **Issue:** toObject() excludes country field from serialization
- **Impact:** Country data saved via API is lost when editing events through UI
- **Test:** Scenario 9 - Create via API with country, edit in UI, verify data loss

**Bug 2: Missing Country Input Field**
- **Component:** `src/client/components/logged_in/calendar/edit_event.vue` lines 312-358
- **Issue:** Location fieldset has no country input field
- **Impact:** Users cannot enter country information through UI
- **Test:** Verify field does not exist in location fieldset

**Bug 3: Missing Hierarchy Validation**
- **Component:** `src/server/calendar/service/locations.ts`
- **Issue:** No validation enforces field hierarchy (address requires city, etc.)
- **Impact:** Invalid location data can be saved (address without city)
- **Test:** Scenario 7 - Create location with address but no city, verify no error

### Database Queries for Verification

Essential queries documented in requirements.md lines 710-737:
- Count locations for calendar
- Find orphaned locations (no event references)
- Check location reuse (multiple events sharing location)
- Verify exact match logic (all fields must match)
- Check country field data loss
- Find invalid hierarchies (address without city)

## Out of Scope

### Not Tested in This Spec
- **Location validation** - Field format validation (addresses, postal codes) deferred
- **Location editing interface** - Standalone location management deferred to future
- **Location autocomplete** - Browsing/selection of existing locations deferred
- **Duplicate detection** - Warnings about similar locations not implemented by design
- **Default country setting** - Calendar-level country configuration deferred

### Future Enhancements Identified
- Default country setting per calendar (user suggestion)
- Location autocomplete/browsing for better UX
- Dedicated location editor interface
- Location usage statistics
- Optional duplicate detection warnings
- Location cleanup mechanism for orphaned records

## Test Scenarios

### Scenario 1: Create Event with New Location

**Objective:** Verify location creation when creating an event

**Test Steps:**
1. Log in as calendar owner/editor
2. Navigate to event creation form
3. Fill in event details (name, description, schedule)
4. Enter location information:
   - Name: "Community Center"
   - Address: "123 Main St"
   - City: "Springfield"
   - State: "IL"
   - Postal Code: "62701"
5. Save event

**Expected UI Behavior:**
- Event saves successfully with confirmation message
- Event detail view displays location information

**Database Verification:**
```sql
-- Verify location created
SELECT * FROM location WHERE calendar_id = ? AND name = 'Community Center';

-- Verify URL-based ID format
SELECT id FROM location WHERE name = 'Community Center';
-- Should match: https://{domain}/places/{uuid}
```

**Success Criteria:**
- Location record created with unique URL ID
- Location.calendar_id matches calendar
- Event.location_id references new location
- UI displays complete location information

---

### Scenario 2: Reuse Existing Location (Exact Match)

**Objective:** Verify location reuse when all fields match exactly

**Setup:**
1. Create Event A with location "Community Center, 123 Main St, Springfield, IL 62701"
2. Note the location_id from database

**Test Steps:**
1. Create Event B with identical location information
2. Save event

**Expected UI Behavior:**
- Event B saves successfully
- Both events display identical location information

**Database Verification:**
```sql
-- Count locations (should be 1)
SELECT COUNT(*) FROM location WHERE calendar_id = ?;

-- Verify both events reference same location
SELECT location_id FROM event WHERE id IN (?, ?);
-- Should return same location_id twice
```

**Success Criteria:**
- No new location record created
- Event B.location_id equals Event A.location_id
- Only one location record exists

---

### Scenario 3: Similar But Not Exact Location Creates New Record

**Objective:** Verify new location created when fields differ slightly

**Setup:**
1. Create Event A with location "Community Center, 123 Main St, Springfield, IL 62701"

**Test Steps:**
1. Create Event B with slightly different location:
   - Name: "Community Center"
   - Address: "123 Main Street" (Street vs St)
   - City: "Springfield"
   - State: "IL"
   - Postal Code: "62701"
2. Save event

**Expected UI Behavior:**
- Event B saves successfully
- No warning about similar location
- Both events display their respective location text

**Database Verification:**
```sql
-- Count locations (should be 2)
SELECT COUNT(*) FROM location WHERE calendar_id = ?;

-- Verify different location_ids
SELECT location_id FROM event WHERE id IN (?, ?);
-- Should return two different location_ids
```

**Success Criteria:**
- New location record created (exact match failed)
- Two separate location records exist
- No duplicate warning shown to user

---

### Scenario 4: Edit Event Location

**Objective:** Verify location changes create new location records

**Setup:**
1. Create event with location "Community Center, 123 Main St, Springfield, IL"
2. Note original location_id

**Test Steps:**
1. Open event for editing
2. Change location name to "Downtown Community Center"
3. Save event

**Expected UI Behavior:**
- Event updates successfully
- Event detail shows new location name

**Database Verification:**
```sql
-- Count locations (should be 2)
SELECT COUNT(*) FROM location WHERE calendar_id = ?;

-- Verify original location unchanged
SELECT name FROM location WHERE id = ?;
-- Should still be "Community Center"

-- Verify new location created
SELECT name FROM location WHERE id = (SELECT location_id FROM event WHERE id = ?);
-- Should be "Downtown Community Center"
```

**Success Criteria:**
- Original location record unchanged
- New location record created with updated name
- Event.location_id changed to new location
- Original location persists in database

**Alternative Test - Remove Location:**
1. Clear all location fields
2. Save event

**Expected:**
- Event.location_id cleared (empty string)
- Original location persists in database

---

### Scenario 5: Delete Event - Location Persists

**Objective:** Verify locations are not deleted when events are deleted

**Setup:**
1. Create Event A with location "Community Center, 123 Main St, Springfield, IL"
2. Note the location_id

**Test Steps:**
1. Delete Event A
2. Query database for location

**Expected UI Behavior:**
- Event deletion confirmation
- Event no longer appears in calendar

**Database Verification:**
```sql
-- Verify location still exists
SELECT * FROM location WHERE id = ?;

-- Verify no events reference location
SELECT COUNT(*) FROM event WHERE location_id = ?;
-- Should return 0
```

**Success Criteria:**
- Event deleted successfully
- Location record persists in database
- Location now orphaned (no event references)

---

### Scenario 6: Partial Location Data - Valid Hierarchy

**Objective:** Verify partial locations can be created

**Test Steps (Valid Case 1):**
1. Create event with only location name: "Virtual Event"
2. Save event

**Expected UI Behavior:**
- Event saves without error
- Location displays only name

**Test Steps (Valid Case 2):**
1. Create event with city and state: "Springfield, IL"
2. Save event

**Expected UI Behavior:**
- Event saves without error
- Location displays city and state only

**Database Verification:**
```sql
-- Verify partial location data
SELECT name, address, city, state FROM location WHERE id = ?;
```

**Success Criteria:**
- Events save successfully with partial data
- Empty fields stored as empty strings
- No validation errors

---

### Scenario 7: Partial Location Data - Invalid Hierarchy (BUG)

**Objective:** Verify missing hierarchy validation (document as bug)

**Test Steps:**
1. Create event with address but no city:
   - Address: "123 Main St"
   - City: "" (empty)
2. Attempt to save event

**Current Behavior (Expected Bug):**
- Event saves successfully without error
- No validation message shown

**Expected Correct Behavior:**
- Validation error: "Address requires City to be filled"
- Event save prevented
- User notified of invalid hierarchy

**Database Verification:**
```sql
-- Find invalid hierarchies
SELECT * FROM location WHERE address != '' AND city = '';
```

**Bug Documentation:**
- **Issue:** No validation enforces location field hierarchy
- **Impact:** Invalid location data can be saved
- **Priority:** Medium - data quality issue

---

### Scenario 8: Multiple Events Same Location

**Objective:** Verify location reuse across multiple events

**Setup:**
1. Create Event A with location
2. Create Event B with same location (exact match)
3. Create Event C with same location (exact match)

**Test Steps:**
1. Verify all events created successfully
2. Delete Event A
3. Verify Events B and C still work

**Expected UI Behavior:**
- All three events display location correctly
- After deleting Event A, Events B and C still show location

**Database Verification:**
```sql
-- Verify location reuse
SELECT location_id, COUNT(*) as event_count
FROM event
WHERE location_id != ''
GROUP BY location_id
HAVING event_count > 1;

-- After deleting Event A
SELECT COUNT(*) FROM event WHERE location_id = ?;
-- Should return 2
```

**Success Criteria:**
- All events reference same location_id
- Deleting one event doesn't affect location
- Other events continue to reference location correctly

---

### Scenario 9: Country Field Bug Testing (CRITICAL)

**Objective:** Confirm country field data loss bug

**Test Steps:**
1. Create event via API with complete location including country:
   ```json
   {
     "name": "Test Venue",
     "address": "123 Main St",
     "city": "Springfield",
     "state": "IL",
     "postalCode": "62701",
     "country": "United States"
   }
   ```
2. Verify country saved to database
3. Edit event in UI (change event title only)
4. Save event
5. Check database for country field

**Expected Bug Confirmation:**
- Country initially saved via API
- After UI edit, country field is lost
- toObject() method strips country during serialization

**Database Verification:**
```sql
-- Before UI edit
SELECT id, name, country FROM location WHERE id = ?;
-- country should be "United States"

-- After UI edit
SELECT id, name, country FROM location WHERE id = ?;
-- country will be empty (bug confirmed)
```

**UI Verification:**
- No country input field in location fieldset (lines 312-358 of edit_event.vue)

**Bug Documentation:**
- **Issue 1:** EventLocation.toObject() excludes country field (line 53-62)
- **Issue 2:** Event editor has no country input field
- **Impact:** Critical - data loss on every UI edit
- **Priority:** HIGH - Fix immediately

---

### Scenario 10: Cross-Calendar Location Isolation

**Objective:** Verify locations are scoped to calendars

**Setup:**
1. Create Calendar A with Event 1 (location: "Community Center, 123 Main St")
2. Create Calendar B with Event 2 (identical location data)

**Test Steps:**
1. Create both events
2. Verify both save successfully

**Expected UI Behavior:**
- Both events create successfully
- Both events display location information

**Database Verification:**
```sql
-- Count locations (should be 2)
SELECT COUNT(*) FROM location WHERE name = 'Community Center';

-- Verify different calendar_ids
SELECT id, calendar_id FROM location WHERE name = 'Community Center';
-- Should show two records with different calendar_ids

-- Verify different location IDs
SELECT location_id FROM event WHERE id IN (?, ?);
-- Should return two different location_ids
```

**Success Criteria:**
- Two separate location records created
- Each location has correct calendar_id
- Locations not shared across calendars

---

### Scenario 11: Default Country Setting (FUTURE ENHANCEMENT)

**Objective:** Document user-suggested feature for future implementation

**User Suggestion:** "It would be handy for calendar owners to have a default country setting"

**Expected Future Behavior:**
1. Calendar owner sets default country in calendar settings
2. Country field auto-populated when creating new events
3. User can override default for specific events
4. Default stored at calendar level

**Current State:**
- Not implemented
- No calendar-level configuration for default country
- Every event requires manual country entry (when field exists)

**Document as:** Future enhancement - Priority 2 (user-requested feature)

## Success Criteria

### All 11 Test Scenarios Executed
- All scenarios completed with UI observations documented
- Database verification queries executed at each checkpoint
- API responses and console errors checked when debugging issues
- Both user-visible behavior and technical causes documented

### Critical Bugs Confirmed
- **Country field data loss** verified through Scenario 9
- **Missing country UI field** verified in event editor
- **Missing hierarchy validation** verified through Scenario 7
- All bugs documented with reproduction steps and technical details

### Location Lifecycle Verified
- Location creation working correctly (Scenario 1)
- Location reuse on exact match working (Scenario 2)
- New locations created when fields differ (Scenario 3)
- Location editing creates new records (Scenario 4)
- Location persistence after event deletion confirmed (Scenario 5)
- Multiple events can share same location (Scenario 8)
- Cross-calendar isolation working (Scenario 10)

### Missing Features Documented
- All 7 missing features from requirements documented
- Impact assessment completed for each missing feature
- Priority recommendations provided
- Future implementation guidance specified

### Test Results Deliverables
1. **Test Execution Report** - Outcomes for all 11 scenarios with screenshots/observations
2. **Bug Reports** - Critical bugs with reproduction steps and technical analysis
3. **Database State Documentation** - Query results at verification checkpoints
4. **Missing Features List** - Comprehensive documentation with priorities
5. **Recommendations Document** - Prioritized improvements for future work

## Implementation Recommendations

### Priority 1: Critical Bugs (Immediate)

**Fix Country Field Serialization**
- Update EventLocation.toObject() to include country field (line 53-62)
- Add country input field to event editor location fieldset (after line 357)
- Add tests for country field persistence
- **Impact:** Prevents ongoing data loss

**Implement Hierarchy Validation**
- Add client-side validation for field dependencies
- Add server-side validation in LocationService
- Clear error messages: "Address requires City to be filled"
- **Impact:** Prevents invalid location data

### Priority 2: Data Quality (Short-term)

**Location Autocomplete/Browse**
- Reduce duplicate locations from typos
- Improve user experience with existing location data
- Leverage location reuse more effectively

**Default Country Setting**
- Add calendar-level configuration
- Auto-populate country field
- Allow per-event override

### Priority 3: Management Features (Medium-term)

**Location Editor Interface**
- Manage locations independently of events
- Fix typos affecting multiple events
- Merge duplicate locations

**Location Usage Statistics**
- Show which events use each location
- Identify orphaned locations
- Support cleanup decisions

### Priority 4: Optional Enhancements (Long-term)

**Duplicate Detection Warnings**
- Optional feature per calendar
- Suggest existing locations during entry
- Configurable similarity threshold
