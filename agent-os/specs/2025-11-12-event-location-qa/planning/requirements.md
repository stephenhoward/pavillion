# Location Management QA Requirements

> Created: 2025-11-12
> Status: Requirements Finalized

## Context

This QA spec covers testing of the event location management functionality in Pavillion. The system allows users to create events with location information, reuse existing locations, and manages location persistence. This specification focuses on QA testing using Playwright MCP to verify both existing functionality and identify missing features.

## User Responses Summary

### Scope
- **Test existing functionality**: Verify current location creation, editing, and reuse behavior
- **Test missing functionality**: Document gaps in location browsing/autocomplete features
- **Testing approach**: Use Playwright MCP for in-browser automated testing

### Workflows to Test
All workflows EXCEPT location validation:
1. Creating events with new locations
2. Reusing existing locations (exact match)
3. Creating new locations when similar but not exact
4. Editing event locations
5. Deleting events and observing location persistence

### Visual Assets
None provided. Location editing UI exists in the event editor form.

### Expected Behavior

#### Location Persistence
- **Locations persist forever** - Once created, locations are never automatically deleted
- No location cleanup logic exists or should exist
- Locations remain in the database even after all events using them are deleted

#### Location Editor
- **NO dedicated location editor** - Defer this feature for future work
- Location management happens only through event creation/editing
- No standalone interface to browse, edit, or delete locations

#### Partial Location Data
- **Partial locations are allowed** with hierarchical validation rule:
  - More specific fields (street address) require more general fields (city) to be present
  - Example: Can have only "City" without "Street", but cannot have "Street" without "City"
  - All location fields are optional, but follow this hierarchy rule
  - **NOTE**: This validation is NOT currently implemented (documented as missing feature)

#### Duplicate Location Handling
- **NO validation warnings** about duplicate locations
- System performs exact match on all fields to determine if location already exists
- Similar but not identical locations create new location records
- No user notification about potential duplicates

### Follow-Up Clarifications

#### Country Field Bug (Confirmed)
**Question**: EventLocation.toObject() excludes the country field. Is this a bug?
**Answer**: YES, this is a bug causing data loss. Additionally, it would be handy for calendar owners to have a default country setting in the future.

**Impact**:
- Country data can be saved via API but is lost when editing events through UI
- toObject() method strips country field during serialization
- Need to fix serialization and add UI field

#### Hierarchy Validation (Confirmed Missing)
**Question**: Should we document the partial location hierarchy rule as missing validation?
**Answer**: YES, document as missing validation. The rule exists in requirements but is not implemented in code.

**Rule**: Street address requires city; city requires state/province, etc.
**Current State**: No validation enforces this rule
**Expected**: Validation should prevent invalid hierarchies before save

#### Test Data Strategy (Clarified)
**Question**: Should tests be independent or can we reuse data across scenarios?
**Answer**:
- **Automated tests**: Independent - each test sets up its own data
- **Manual Playwright MCP testing**: One session is fine for manual verification

**Approach**:
- Automated test suites should clean up between tests
- Manual QA can use persistent session for workflow testing
- Document database state at checkpoints during manual testing

#### Playwright MCP Testing Scope (Clarified)
**Question**: What should Playwright MCP verify?
**Answer**:
- **Primary focus**: Verify UI behavior (form interactions, submissions, visual feedback)
- **Secondary**: Check API responses and JavaScript console if things don't work properly to discover underlying causes

**Testing Strategy**:
- Start with UI-level verification
- Drill into API/console only when debugging issues
- Document both UI behavior and underlying technical causes of problems

## Current Implementation Analysis

### Backend Components

#### Database Schema (`LocationEntity`)
```typescript
@Table({ tableName: 'location' })
class LocationEntity extends Model {
  id: string;                    // Primary key (UUID URL format)
  calendar_id: string;           // Foreign key to calendar
  name: string;                  // Location/venue name
  address: string;               // Street address
  city: string;                  // City name
  state: string;                 // State/province
  postal_code: string;           // ZIP/postal code
  country: string;               // Country name
}
```

**Key Characteristics:**
- ID format: `https://{domain}/places/{uuid}`
- Scoped to calendar (calendar_id foreign key)
- No cascade delete - locations persist after events deleted
- All fields are optional strings

#### Location Service (`LocationService`)

**findLocation(calendar, location)**
- Searches for existing location by ID (if provided)
- Falls back to exact match on all fields (name, address, city, state, postal_code, country)
- Returns null if no match found
- Validates location belongs to correct calendar

**createLocation(calendar, location)**
- Generates unique URL-based ID
- Associates with calendar
- Saves to database
- Returns created location model

**findOrCreateLocation(calendar, locationParams)**
- Primary method used by EventService
- Attempts to find existing location first
- Creates new location if not found
- Ensures location reuse when exact match exists

#### Integration with Events (`EventService`)

**Location handling in createEvent:**
```typescript
if (eventParams.location) {
  let location = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
  eventEntity.location_id = location.id;
  event.location = location;
}
```

**Location handling in updateEvent:**
```typescript
// Remove location reference
if (eventEntity.location_id && !eventParams.location) {
  eventEntity.location_id = '';
  event.location = null;
}
// Create or reuse location
else if (eventParams.location) {
  let location = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
  eventEntity.location_id = location.id;
  event.location = location;
}
```

**Location handling in deleteEvent:**
- Locations are NOT deleted when events are deleted
- Only the foreign key reference (location_id) is removed from event
- Location records persist indefinitely in database

### Frontend Components

#### Event Editor (`edit_event.vue`)

**Location Input Fields (lines 312-358):**
- Location Name (text input)
- Address (text input)
- City (text input)
- State/Province (text input)
- Postal Code (text input)
- **Country field exists in model but NOT in UI form** (Bug confirmed)

**Current Implementation:**
- Simple text input fields with no validation
- No autocomplete or suggestions
- No indication of existing similar locations
- No browsing of previously used locations
- All fields are optional
- Location data saved as part of event save operation

#### Location Model (`EventLocation`)

```typescript
class EventLocation extends PrimaryModel {
  id: string = '';
  name: string = '';
  address: string = '';
  city: string = '';
  state: string = '';
  postalCode: string = '';
  country: string = '';
}
```

**Methods:**
- `fromObject()` - Create from plain object
- `toObject()` - Serialize to plain object (**BUG**: excludes ID and country)

**Confirmed Bug:** The `toObject()` method does NOT include `id` or `country` in serialization, causing data loss when editing events through the UI.

## Testing Scenarios

### Test Data Strategy
- **Automated tests**: Each test should set up independent data
- **Manual testing**: One Playwright MCP session is acceptable
- **Database verification**: Check state at key points

### Playwright MCP Focus
- **Primary**: Verify UI behavior (interactions, submissions, visual feedback)
- **Secondary**: Check API responses and console when debugging issues
- **Document**: Both UI observations and underlying technical causes

### Scenario 1: Create Event with New Location

**Setup:**
1. Log in as calendar owner/editor
2. Open event creation form

**Test Steps:**
1. Fill in event details (name, description, schedule)
2. Enter location information:
   - Name: "Community Center"
   - Address: "123 Main St"
   - City: "Springfield"
   - State: "IL"
   - Postal Code: "62701"
3. Save event

**Expected Results:**
- Event created successfully (UI confirmation)
- Location created in database with unique URL ID
- Location associated with calendar
- Location_id stored on event record
- Location data retrievable when viewing event

**Verification:**
- **UI**: Event shows location information in details view
- **Database**: Check location table for new record with correct calendar_id
- **API**: Verify event.location_id matches location.id in response

### Scenario 2: Reuse Existing Location (Exact Match)

**Setup:**
1. Create Event A with location "Community Center, 123 Main St, Springfield, IL 62701"
2. Note the location ID created

**Test Steps:**
1. Create Event B with identical location information:
   - Name: "Community Center"
   - Address: "123 Main St"
   - City: "Springfield"
   - State: "IL"
   - Postal Code: "62701"
2. Save event

**Expected Results:**
- Event B created successfully
- NO new location record created
- Event B references same location_id as Event A
- Only one location record exists in database

**Verification:**
- **UI**: Both events display same location details
- **Database**: Count location records (should be 1)
- **API**: Verify both events have identical location_id

### Scenario 3: Similar But Not Exact Location Creates New Record

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

**Expected Results:**
- Event B created successfully
- NEW location record created (not exact match)
- Two separate location records exist in database
- No warning to user about potential duplicate

**Verification:**
- **UI**: Events show slightly different address text
- **Database**: Count location records (should be 2)
- **API**: Verify events have different location_ids

### Scenario 4: Edit Event Location

**Setup:**
1. Create event with location "Community Center, 123 Main St, Springfield, IL"

**Test Steps:**
1. Open event for editing
2. Change location name to "Downtown Community Center"
3. Save event

**Expected Results:**
- Event updated successfully
- Original location record unchanged (no modifications)
- NEW location record created with updated name
- Event now references new location_id
- Original location still exists in database (persistence)

**Verification:**
- **UI**: Event shows updated location name
- **Database**: Two location records exist (old and new)
- **API**: Event location_id changed to new location

**Alternative Test - Remove Location:**
1. Open event for editing
2. Clear all location fields
3. Save event

**Expected Results:**
- Event updated successfully
- Event.location_id cleared (empty string)
- Original location record still exists in database
- Event no longer associated with location

**Verification:**
- **UI**: Event shows no location information
- **Database**: Location still exists but not referenced
- **API**: Event location_id is empty string

### Scenario 5: Delete Event - Location Persists

**Setup:**
1. Create Event A with location "Community Center, 123 Main St, Springfield, IL"
2. Note the location_id

**Test Steps:**
1. Delete Event A
2. Check location table

**Expected Results:**
- Event deleted successfully
- Location record still exists in database
- Location.id unchanged
- Location.calendar_id unchanged
- Location is now orphaned (no events reference it)

**Verification:**
- **UI**: Event no longer appears in calendar
- **Database**: Location record still exists
- **Query**: No events reference that location_id

### Scenario 6: Partial Location Data - Valid Hierarchy

**Test Steps (Valid Case 1):**
1. Create event with only location name: "Virtual Event"
2. Save event

**Expected Results:**
- Event created successfully
- Location created with only name populated
- Other fields empty but valid

**Test Steps (Valid Case 2):**
1. Create event with city and state: "Springfield, IL"
2. Save event

**Expected Results:**
- Event created successfully
- Location created with city and state
- Address and name fields empty but valid

**Verification:**
- **UI**: Event saves without errors
- **Database**: Location has partial data
- **API**: Response includes partial location data

### Scenario 7: Partial Location Data - Invalid Hierarchy (Missing Validation)

**Test Steps:**
1. Create event with address but no city:
   - Address: "123 Main St"
   - City: "" (empty)
2. Attempt to save event

**Current Behavior (Bug):**
- Event saves successfully (no validation)
- Location created with invalid hierarchy
- No error message to user

**Expected Behavior (Requirements):**
- Should reject save with validation error
- Error message: "Address requires City to be filled"
- Enforce hierarchy rule before database save

**Document as:** Missing validation feature (Scenario 7 in Missing Features section)

**Verification:**
- **UI**: No error shown (incorrect)
- **Database**: Invalid location data saved
- **Note**: This validates the bug exists

### Scenario 8: Multiple Events Same Location

**Setup:**
1. Create Event A with location
2. Create Event B with same location (exact match)
3. Create Event C with same location (exact match)

**Test Steps:**
1. Verify all events created successfully
2. Verify all reference same location_id
3. Delete Event A
4. Verify Events B and C still work
5. Check location still exists

**Expected Results:**
- All events use same location (location reuse working)
- Deleting one event doesn't affect location
- Other events continue to reference location
- Location persists after partial event deletion

**Verification:**
- **UI**: All events show location information correctly
- **Database**: One location, three events (then two after delete)
- **API**: Events B and C unaffected by Event A deletion

### Scenario 9: Country Field Bug Testing

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
3. Edit event in UI (change event title, leave location unchanged)
4. Save event
5. Check database for country field

**Expected Results (Bug Confirmation):**
- Country field initially saved via API
- After UI edit, country field is lost
- toObject() method strips country during serialization
- UI form has no country input field

**Verification:**
- **Database Before Edit**: Country field populated
- **Database After Edit**: Country field empty/lost
- **UI**: No country input field visible
- **Bug Confirmed**: Data loss due to serialization issue

**Document as:** Critical bug - country field data loss (Scenario 9 in Missing Features section)

### Scenario 10: Cross-Calendar Location Isolation

**Setup:**
1. Create Calendar A with Event 1 (location: "Community Center, 123 Main St")
2. Create Calendar B with Event 2 (same location data)

**Test Steps:**
1. Verify both events created successfully
2. Check location records

**Expected Results:**
- Two separate location records created
- Each location associated with its respective calendar
- Locations are NOT shared across calendars
- Calendar_id properly scopes location reuse

**Verification:**
- **Database**: Count locations (should be 2)
- **API**: Each location has different calendar_id
- **Query**: Verify locations have same data but different IDs

### Scenario 11: Default Country Setting (Future Enhancement)

**User Suggestion:** "It would be handy for calendar owners to have a default country setting"

**Test Scenario (Future):**
1. Calendar owner sets default country in calendar settings
2. Create new event with location
3. Country field auto-populated with default
4. User can override default for specific events

**Current State:** Not implemented
**Document as:** Future enhancement (Missing Features section)

## Missing Features Documentation

### Missing Feature 1: Country Field Data Loss (CRITICAL BUG)

**Status:** Critical Bug - Confirmed by User

**Description:**
The EventLocation.toObject() method excludes the country field from serialization, causing data loss when events are edited through the UI. Additionally, the event editor form does not include a country input field.

**Bug Components:**
1. `toObject()` in EventLocation model strips country field
2. Event editor UI has no country input field
3. Country data saved via API is lost on UI edit

**Impact:**
- Country information cannot be entered via UI
- Country data saved via API is lost when editing events
- Data integrity compromised
- International events missing critical location data

**Expected Behavior:**
1. Fix toObject() to include country field in serialization
2. Add country input field to event editor location fieldset
3. Preserve country data through edit cycles
4. Consider adding default country setting per calendar

**Related User Feedback:**
"YES, this is a bug. Additionally, it would be handy for calendar owners to have a default country setting."

### Missing Feature 2: Partial Location Hierarchy Validation

**Status:** Not Implemented - Confirmed by User

**Description:**
No validation enforces the hierarchical field requirements for partial locations. The rule states that more specific fields (street address) require more general fields (city) to be present, but this is not enforced in code.

**Hierarchy Rules (Not Enforced):**
- Street address requires city
- City requires state/province
- Any field can be omitted if no dependent fields are present
- Example: "123 Main St" without city is invalid

**Impact:**
- Invalid location data can be saved to database
- Incomplete addresses may not be usable
- Data quality issues accumulate
- User confusion about valid combinations

**Expected Behavior:**
1. Client-side validation before form submission
2. Server-side validation in LocationService
3. Clear error messages: "Address requires City to be filled"
4. Prevent save of invalid location hierarchies

**Test Case:**
- Scenario 7 demonstrates this bug - address without city saves successfully

### Missing Feature 3: Location Browsing/Autocomplete

**Status:** Not Implemented (Confirmed Deferred)

**Description:**
Users cannot browse previously used locations or get suggestions while typing. Each location entry requires manual typing of all fields.

**Impact:**
- Inconsistent data entry (typos create duplicate locations)
- No way to discover existing locations
- Poor user experience for repeated location entry
- Database accumulates duplicate locations with minor variations

**Expected Future Behavior:**
- Autocomplete suggestions based on partial input
- Dropdown showing previously used locations for calendar
- Selection populates all location fields
- Continues to allow manual entry for new locations
- Search/filter existing locations

### Missing Feature 4: Dedicated Location Editor

**Status:** Not Implemented (Confirmed Deferred)

**Description:**
No standalone interface to view, edit, or manage locations separate from events.

**Impact:**
- Cannot fix typos in existing locations
- Cannot merge duplicate locations
- No location management capability
- No way to clean up orphaned locations

**Expected Future Behavior:**
- Location list view showing all locations for calendar
- Edit location details (affects all events using it)
- Delete unused locations (with safeguards)
- Merge duplicate locations
- View events using each location

### Missing Feature 5: Duplicate Location Detection

**Status:** Not Implemented (Confirmed Intentional)

**Description:**
System does not warn users about similar existing locations.

**Impact:**
- Many near-duplicate locations accumulate
- Data inconsistency across events
- Database clutter
- Wasted storage

**User Confirmation:**
"NO validation warnings about duplicate locations" - This is intentional design per requirements.

**Potential Future Enhancement:**
- Detect similar locations during entry
- Show warning: "Similar location exists: [name]"
- Allow user to choose existing or create new
- Optional feature that can be enabled per calendar

### Missing Feature 6: Default Country Setting

**Status:** Not Implemented (User Suggested Enhancement)

**Description:**
No way for calendar owners to set a default country for their calendar, which would auto-populate the country field when creating events.

**Expected Behavior:**
1. Add "Default Country" setting to calendar configuration
2. Auto-populate country field when creating new events
3. Allow override for specific events
4. Store at calendar level, not event level

**User Feedback:**
"It would be handy for calendar owners to have a default country setting"

**Benefits:**
- Reduces repetitive data entry
- Ensures consistent country data
- Especially useful for calendars focused on one country
- Improves data quality

### Missing Feature 7: Location Usage Statistics

**Status:** Not Implemented

**Description:**
No way to see which events use a location or how many times it's referenced.

**Impact:**
- Cannot determine if location is safe to delete
- No visibility into location usage patterns
- Cannot identify popular venues

**Expected Future Behavior:**
- Show event count for each location
- List events using specific location
- Filter events by location
- Sort locations by usage frequency

## Database Considerations

### Current Schema Constraints
- No foreign key cascade delete from location to event
- Locations persist indefinitely (by design)
- Calendar_id foreign key ensures location belongs to calendar
- No unique constraints (allows duplicate location data)

### Data Integrity Concerns
1. **Country Field Data Loss:** Critical bug causing data loss (toObject serialization)
2. **Orphaned Locations:** Locations with no events referencing them accumulate
3. **Duplicate Data:** Multiple locations with identical or near-identical data
4. **Invalid Hierarchies:** No validation prevents address without city, etc.
5. **No Cleanup:** No mechanism to remove unused locations

### Testing Database State
After running all test scenarios, expect:
- Multiple location records per calendar
- Some locations referenced by multiple events
- Some locations with no event references (orphaned)
- Location data persists even after all events deleted
- Some locations with missing country data (due to bug)
- Some locations with invalid hierarchies (due to missing validation)

## Testing Tools

### Playwright MCP Testing Strategy

**Primary Focus:**
- Verify UI behavior (form interactions, field population, submissions)
- Check visual feedback (success messages, error states)
- Validate form field behavior
- Test user workflows end-to-end

**Secondary Focus (When Debugging):**
- Check API responses if UI behavior unexpected
- Examine JavaScript console for errors
- Verify network requests/responses
- Investigate underlying technical causes

**Approach:**
1. Start with UI-level observations
2. Document what user sees and experiences
3. Drill into API/console when behavior is incorrect
4. Report both symptoms (UI) and causes (technical)

### Database Verification Queries

Essential verification queries for manual testing:
```sql
-- Count locations for calendar
SELECT COUNT(*) FROM location WHERE calendar_id = ?;

-- Find orphaned locations
SELECT * FROM location WHERE id NOT IN (SELECT DISTINCT location_id FROM event WHERE location_id != '');

-- Check location reuse
SELECT location_id, COUNT(*) as event_count
FROM event
WHERE location_id != ''
GROUP BY location_id
HAVING event_count > 1;

-- Verify exact match logic
SELECT * FROM location
WHERE calendar_id = ?
  AND name = ?
  AND address = ?
  AND city = ?
  AND state = ?
  AND postal_code = ?
  AND country = ?;

-- Check for country field data loss
SELECT id, name, country FROM location WHERE calendar_id = ? ORDER BY created_at;

-- Find invalid location hierarchies (address without city)
SELECT * FROM location WHERE address != '' AND city = '';
```

## Success Criteria

### Functional Testing Success
- All 11 test scenarios execute successfully
- Location creation confirmed via UI and database
- Location reuse (exact match) verified
- Location persistence after event deletion confirmed
- Cross-calendar isolation working correctly
- Country field bug confirmed and documented
- Hierarchy validation bug confirmed and documented

### Gap Documentation Success
- All 7 missing features documented with impact assessment
- Critical bugs identified (country field, hierarchy validation)
- Future implementation guidance specified
- User suggestions captured (default country setting)

### Deliverables
1. **Test Execution Results** - Outcome for all 11 scenarios with UI observations
2. **Bug Reports** - Critical: country field data loss; hierarchy validation missing
3. **Database State Documentation** - Verification queries and results at checkpoints
4. **Missing Features Documentation** - Comprehensive list with priorities
5. **Recommendations** - Prioritized improvements for future implementation

## Recommendations for Future Implementation

### Priority 1: Critical Bugs (Immediate)
1. **Fix Country Field Serialization**
   - Update EventLocation.toObject() to include country
   - Add country input field to event editor UI
   - Add tests for country field persistence

2. **Implement Hierarchy Validation**
   - Add client-side validation for field dependencies
   - Add server-side validation in LocationService
   - Provide clear error messages

### Priority 2: Data Quality (Short-term)
3. **Location Autocomplete/Browse**
   - Reduce duplicate locations from typos
   - Improve user experience
   - Leverage existing location data

4. **Default Country Setting**
   - Add calendar-level configuration
   - Auto-populate country field
   - User can override per event

### Priority 3: Management Features (Medium-term)
5. **Location Editor Interface**
   - Manage locations independently of events
   - Fix typos affecting multiple events
   - Merge duplicate locations

6. **Location Usage Statistics**
   - Show which events use each location
   - Identify orphaned locations
   - Support location cleanup decisions

### Priority 4: Optional Enhancements (Long-term)
7. **Duplicate Detection Warnings**
   - Optional feature for calendars that want it
   - Suggest existing locations during entry
   - Configurable similarity threshold

## Notes and Assumptions

### Test Data Strategy
- **Automated tests**: Independent test data per test
- **Manual Playwright MCP**: Single session acceptable
- **Database resets**: Development server resets on restart
- **Test isolation**: Each scenario documents expected database state

### Playwright MCP Approach
- **Primary**: UI behavior verification
- **Secondary**: API/console investigation when debugging
- **Documentation**: Both user-visible behavior and technical causes

### Known Limitations
1. No country field in UI (critical bug)
2. No location validation implemented (confirmed missing)
3. No duplicate detection (intentional design)
4. No location cleanup mechanism (by design)
5. No location browsing capability (deferred)
6. Country field data loss in toObject() (critical bug)

### Future Considerations
1. Default country setting per calendar (user suggestion)
2. Location validation rules need implementation (confirmed missing)
3. Duplicate detection could be optional per calendar
4. Location browsing/autocomplete to improve UX
5. Location editor for data quality management
6. Cleanup mechanism for orphaned locations (optional)

## Reusability Opportunities

**User mentioned:** The location editing interface on events has been started.

**Existing Implementation:**
- `src/client/components/logged_in/calendar/edit_event.vue` (lines 312-358) - Location fieldset
- `src/server/calendar/service/locations.ts` - Location service logic
- `src/server/calendar/entity/location.ts` - Database entity
- `src/common/model/location.ts` - Shared model

**Reuse for QA Testing:**
- Use existing event editor form for all location testing
- Leverage LocationService test patterns from existing tests
- Follow EventService test patterns for integration testing
- Database queries based on existing schema

## Additional Context

### User Provided Clarifications

1. **Country Field Bug**: CONFIRMED - This is a bug causing data loss
2. **Default Country Setting**: USER SUGGESTION - Would be handy feature
3. **Hierarchy Validation**: CONFIRMED MISSING - Document as gap in validation
4. **Test Data Strategy**: Independent for automated tests, one session OK for manual testing
5. **Playwright MCP Scope**: Primary focus on UI behavior, secondary on API/console for debugging

### Development Server Behavior
- Database resets and re-seeds on development server restart
- Test data doesn't persist across server restarts
- Event instances refreshed after seeding
- Consider this when planning test execution timing

### Testing Philosophy
- Start with UI-level verification (what user sees)
- Investigate API/console when behavior is unexpected
- Document both symptoms and underlying causes
- Prioritize user experience over technical implementation details
