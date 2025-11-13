# Critical Bugs Report: Event Location Management

> **Report Date:** 2025-11-12
> **Priority:** URGENT - Action Required
> **Bugs Identified:** 3 Critical Issues

---

## Bug #1: Country Field Missing and Data Loss

**Bug ID:** LOC-001
**Severity:** 🔴 CRITICAL
**Priority:** P0 - Fix Immediately
**Status:** Confirmed
**Discovered:** 2025-11-12 (QA Testing Scenario 1 + Code Analysis)

### Summary

The country field is completely missing from the event location editor UI, and the `EventLocation.fromObject()` method does not include the country parameter, causing data loss when events are edited through the UI.

### Root Cause

**File:** `src/common/model/location.ts`
**Lines:** 44-46

```typescript
static fromObject(obj: Record<string, any>): EventLocation {
  return new EventLocation(obj.id, obj.name, obj.address, obj.city, obj.state, obj.postalCode);
  // ❌ MISSING: obj.country as 7th parameter
}
```

The `fromObject()` method only passes 6 parameters to the constructor, omitting `obj.country`, while the `toObject()` method correctly includes country (line 60).

**File:** `src/client/components/logged_in/calendar/edit_event.vue`
**Lines:** 312-358

The location fieldset contains only 5 input fields:
1. Location Name
2. Address
3. City
4. State/Province
5. Postal Code
6. ❌ **Country field missing**

### Impact

**Data Loss:**
- Country data saved via API is lost when editing events through UI
- Existing country values are stripped during edit operations
- International events lose critical location information

**User Experience:**
- Users cannot enter country information through UI
- No way to specify country for events
- International events appear incomplete

**Data Integrity:**
- Location records incomplete for international calendars
- Geographic information insufficient for global events
- Search and filtering by country not possible

### Reproduction Steps

#### Method 1: Direct UI Testing
1. Create event through UI with complete location
2. Notice country field does not exist in form
3. Save event - country will be null/empty

#### Method 2: API to UI Testing
1. Create event via API with location including `"country": "United States"`
2. Verify country saved to database
3. Edit event in UI (change event title)
4. Save event through UI
5. Check database - country field will be empty (data lost)

### Expected Behavior

1. **UI:** Country input field should exist in location fieldset (after Postal Code field)
2. **Model:** `fromObject()` should include country parameter
3. **Persistence:** Country data should survive edit cycles
4. **Validation:** Country field should be optional but preserved when provided

### Proposed Fix

#### Fix 1: Update fromObject() Method

**File:** `src/common/model/location.ts` (line 45)

```typescript
static fromObject(obj: Record<string, any>): EventLocation {
  return new EventLocation(
    obj.id,
    obj.name,
    obj.address,
    obj.city,
    obj.state,
    obj.postalCode,
    obj.country  // ✅ Add country parameter
  );
}
```

#### Fix 2: Add Country Field to UI

**File:** `src/client/components/logged_in/calendar/edit_event.vue`

Insert after line 357 (after Postal Code field):

```vue
<div class="form-group">
  <label for="location-country">Country</label>
  <input id="location-country"
         type="text"
         name="country"
         :placeholder="t('country_placeholder')"
         v-model="props.event.location.country" />
</div>
```

#### Fix 3: Add Translation Keys

**File:** `src/client/locales/en.json`

```json
{
  "country_placeholder": "country"
}
```

### Testing Requirements

1. **Unit Tests:**
   - Test `fromObject()` includes country
   - Test `toObject()` includes country (already working)
   - Test country persists through serialization cycle

2. **Integration Tests:**
   - Create event with country via UI
   - Edit event, verify country persists
   - Create via API, edit via UI, verify country persists

3. **Manual QA:**
   - Verify country field visible in UI
   - Test form validation
   - Test data persistence

### Additional Recommendations

#### User Suggestion: Default Country Setting

**User Feedback:**
"It would be handy for calendar owners to have a default country setting"

**Recommended Enhancement (Post-Fix):**
- Add calendar-level "Default Country" setting
- Auto-populate country field when creating events
- Allow per-event override of default
- Store in calendar configuration

**Implementation:**
```typescript
// Calendar model
defaultCountry: string = '';

// Event creation
if (!location.country && calendar.defaultCountry) {
  location.country = calendar.defaultCountry;
}
```

### Estimated Effort

- **Fix fromObject():** 15 minutes
- **Add UI field:** 30 minutes
- **Add translations:** 15 minutes
- **Write tests:** 2 hours
- **QA testing:** 1 hour
- **Total:** ~4 hours

### Priority Justification

- **P0 - Critical:** Data loss occurring on every UI edit
- **Severity High:** Affects all international events
- **User Impact:** Cannot specify country through UI
- **Data Integrity:** Location data incomplete
- **Simple Fix:** Single parameter addition + UI field

---

## Bug #2: Missing Location Field Hierarchy Validation

**Bug ID:** LOC-002
**Severity:** 🟠 HIGH
**Priority:** P1 - Fix Soon
**Status:** Confirmed
**Discovered:** 2025-11-12 (QA Testing Scenario 7)

### Summary

No validation enforces location field hierarchy rules. The system allows invalid combinations such as address without city, violating documented requirements that "more specific fields require more general fields to be present."

### Root Cause

**Missing Validation in:**
1. Client-side: No form validation in `edit_event.vue`
2. Server-side: No validation in `LocationService.findOrCreateLocation()`

**Expected Rules (Not Enforced):**
- Address requires City
- City requires State/Province
- Postal Code requires City
- More specific fields require more general fields

### Impact

**Data Quality:**
- Invalid location data accumulates in database
- Incomplete addresses cannot be properly displayed
- Geographic hierarchy broken for invalid locations

**User Experience:**
- No guidance on valid field combinations
- Confusing behavior when some fields present without context
- Invalid data accepted without warning

**Search/Display:**
- Search by city fails for locations with address but no city
- Map display fails for invalid locations
- Filtering by geographic region unreliable

### Reproduction Steps

**Test Case: Address Without City**
1. Open event creation form
2. Enter Address: "123 Main St"
3. Leave City field empty
4. Leave State and Postal Code empty
5. Save event
6. **Result:** Event saves successfully ❌ (should fail validation)

**Other Invalid Combinations:**
- Postal Code without City
- State without City
- Address without any other fields

### Expected Behavior

**Validation Rules:**
```typescript
if (address && !city) {
  return error("Address requires City to be filled");
}
if (postalCode && !city) {
  return error("Postal Code requires City to be filled");
}
if (city && !state) {
  // Warning only - some cities known without state
  return warning("City should include State/Province");
}
```

**User Experience:**
- Real-time validation as user types
- Clear error messages
- Prevent save until validation passes
- Highlight invalid fields

### Proposed Fix

#### Fix 1: Client-side Validation

**File:** `src/client/components/logged_in/calendar/edit_event.vue`

Add validation method:

```typescript
function validateLocationHierarchy(location: EventLocation): string[] {
  const errors: string[] = [];

  if (location.address && !location.city) {
    errors.push("Address requires City to be filled");
  }

  if (location.postalCode && !location.city) {
    errors.push("Postal Code requires City to be filled");
  }

  // Optional: warn if city without state
  if (location.city && !location.state) {
    errors.push("City should include State/Province");
  }

  return errors;
}
```

Call before form submission:

```typescript
async function handleSubmit() {
  const locationErrors = validateLocationHierarchy(props.event.location);

  if (locationErrors.length > 0) {
    // Display errors to user
    state.errors = locationErrors;
    return;
  }

  // Proceed with save
  await saveEvent();
}
```

#### Fix 2: Server-side Validation

**File:** `src/server/calendar/service/locations.ts`

Add validation in `findOrCreateLocation()`:

```typescript
async findOrCreateLocation(calendar: Calendar, locationParams: any): Promise<EventLocation> {
  // Validate hierarchy
  if (locationParams.address && !locationParams.city) {
    throw new ValidationError("Address requires City to be filled");
  }

  if (locationParams.postalCode && !locationParams.city) {
    throw new ValidationError("Postal Code requires City to be filled");
  }

  // Existing logic...
}
```

#### Fix 3: Custom Exception

**File:** `src/common/exceptions/location.ts` (create new file)

```typescript
export class LocationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationValidationError';
  }
}
```

### Testing Requirements

1. **Unit Tests:**
   - Test validation function with valid combinations
   - Test validation function with invalid combinations
   - Test each hierarchy rule independently

2. **Integration Tests:**
   - Test API rejects invalid location data
   - Test form prevents submission with invalid data
   - Test error messages display correctly

3. **Manual QA:**
   - Test each invalid combination
   - Verify error messages are clear
   - Test form behavior and user experience

### Test Cases

```typescript
describe('Location Hierarchy Validation', () => {
  it('should reject address without city', () => {
    const location = { address: '123 Main St', city: '' };
    expect(() => validate(location)).toThrow('Address requires City');
  });

  it('should reject postal code without city', () => {
    const location = { postalCode: '12345', city: '' };
    expect(() => validate(location)).toThrow('Postal Code requires City');
  });

  it('should allow name only', () => {
    const location = { name: 'Virtual Event' };
    expect(() => validate(location)).not.toThrow();
  });

  it('should allow city and state without address', () => {
    const location = { city: 'Springfield', state: 'IL' };
    expect(() => validate(location)).not.toThrow();
  });
});
```

### Estimated Effort

- **Client validation:** 2 hours
- **Server validation:** 2 hours
- **Error handling:** 1 hour
- **Write tests:** 3 hours
- **QA testing:** 2 hours
- **Total:** ~10 hours

### Priority Justification

- **P1 - High:** Data quality issue affecting all locations
- **Severity Medium:** Invalid data accumulates over time
- **User Impact:** Confusing behavior, poor UX
- **Technical Debt:** Harder to fix as invalid data accumulates
- **Moderate Effort:** ~10 hours to implement properly

---

## Bug #3: Event Update Returns 404 Error

**Bug ID:** LOC-003
**Severity:** 🟡 MEDIUM-HIGH
**Priority:** P1 - Fix Soon
**Status:** Confirmed
**Discovered:** 2025-11-12 (QA Testing Scenario 4)

### Summary

Attempting to update an event after editing location data results in a 404 Not Found error from the API, preventing the save operation from completing.

### Root Cause

**Unknown - Requires Investigation**

Possible causes:
1. Incorrect API endpoint URL being called
2. Endpoint not properly registered in route handler
3. Event ID format issue in URL
4. Missing route parameter
5. API versioning mismatch

### Impact

**Functionality:**
- Cannot edit events with location changes
- Users cannot update event locations
- Core edit functionality broken

**User Experience:**
- Error message displayed: "Error saving event"
- Changes not saved
- No workaround available

**Data Integrity:**
- Event data cannot be corrected
- Location typos cannot be fixed
- Events stuck with incorrect data

### Reproduction Steps

1. Open existing event "QA Test Event 1" for editing
2. Change location name from "Community Center" to "Downtown Community Center"
3. Click "Update Event" button
4. **Result:** Error displayed, 404 in console

**Console Errors:**
```
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
[ERROR] Error saving event: AxiosError @ event.ts:79
```

### Expected Behavior

- Event should update successfully
- New location record created (changed location data)
- Original location record unchanged
- Event.location_id updated to new location
- Success confirmation displayed
- Event list updated with changes

### Investigation Needed

**Check:**
1. API endpoint being called (inspect network tab)
2. Event ID format in URL
3. Server route registration
4. Request payload format
5. Server logs for additional error details

**Files to Investigate:**
- `src/client/service/event.ts` (line 79 - error location)
- `src/server/calendar/api/v1/event-routes.ts` (route registration)
- `src/server/calendar/service/event.ts` (update method)

### Debugging Steps

```typescript
// Add logging to event service
async updateEvent(eventId: string, eventData: any) {
  console.log('Update Event Called:', {
    eventId,
    url: `/api/v1/events/${eventId}`,
    data: eventData
  });

  try {
    const response = await axios.put(`/api/v1/events/${eventId}`, eventData);
    return response;
  } catch (error) {
    console.error('Update Event Error:', {
      eventId,
      error: error.message,
      status: error.response?.status,
      url: error.config?.url
    });
    throw error;
  }
}
```

### Temporary Workaround

**Workaround:** None identified

Users cannot edit event locations until bug is fixed.

### Proposed Investigation Plan

1. **Reproduce bug with network logging**
   - Open browser dev tools
   - Attempt event update
   - Capture exact API URL being called
   - Capture request payload

2. **Verify server routes**
   - Check route registration
   - Verify endpoint exists
   - Check HTTP method (PUT vs PATCH)
   - Verify URL parameter format

3. **Check event ID format**
   - Verify event ID is valid UUID or URL format
   - Check if ID needs encoding
   - Verify ID passed correctly to API call

4. **Test with direct API call**
   - Use curl or Postman to call endpoint directly
   - Verify endpoint works outside UI
   - Compare payload formats

### Estimated Effort

- **Investigation:** 2 hours
- **Fix:** 2-4 hours (depends on root cause)
- **Testing:** 2 hours
- **Total:** 6-8 hours

### Priority Justification

- **P1 - High:** Breaks core functionality
- **Severity Medium-High:** Cannot edit events
- **User Impact:** Blocking workflow
- **Investigation Required:** Unknown root cause
- **Reasonable Effort:** 6-8 hours total

---

## Summary and Priorities

| Bug ID | Title | Severity | Priority | Effort | Status |
|--------|-------|----------|----------|--------|--------|
| LOC-001 | Country Field Missing & Data Loss | CRITICAL | P0 | 4h | Confirmed |
| LOC-002 | Missing Hierarchy Validation | HIGH | P1 | 10h | Confirmed |
| LOC-003 | Event Update 404 Error | MEDIUM-HIGH | P1 | 6-8h | Confirmed |

### Recommended Action Plan

**Week 1:**
1. Fix LOC-001 (Country field) - 4 hours
2. Fix LOC-003 (Event update error) - 8 hours
3. Write tests for both fixes - 4 hours

**Week 2:**
4. Implement LOC-002 (Hierarchy validation) - 10 hours
5. Comprehensive QA testing - 4 hours
6. Complete remaining test scenarios - 4 hours

**Total Effort:** ~34 hours (4-5 days)

### Critical Path

```
LOC-001 (Country field) → Must fix first (data loss)
    ↓
LOC-003 (Update error) → Blocks testing of LOC-001 fix
    ↓
LOC-002 (Validation) → Can proceed in parallel after LOC-001
    ↓
Complete QA testing
```

---

**Report Generated:** 2025-11-12
**Next Action:** Review with development team, prioritize fixes
**Risk:** Data loss ongoing until LOC-001 fixed
**Recommendation:** Deploy LOC-001 fix as hotfix ASAP
