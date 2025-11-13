# Task Breakdown: Location Management Fixes

## Overview
Total Tasks: 3 major task groups (LOC-001, LOC-003, LOC-002)
Implementation Order: Simplest to most complex
Separate Commits: Each bug fix gets its own commit

## Task List

### Bug Fix 1: Country Field Data Loss (LOC-001)

#### Task Group 1: Fix Country Parameter in EventLocation Model
**Dependencies:** None
**Estimated Effort:** 4 hours
**Commit Message:** "fix: add country parameter to EventLocation.fromObject() [LOC-001]"

- [x] 1.0 Fix country field data loss
  - [x] 1.1 Write 2-4 focused unit tests for country field serialization
    - Test that EventLocation.fromObject() preserves country field
    - Test that country field round-trips through toObject() and fromObject()
    - Test that country field remains optional (can be undefined)
    - Do NOT test entire EventLocation class (focus only on country field)
  - [x] 1.2 Add country parameter to EventLocation.fromObject() method
    - File: `src/common/model/location.ts` (line 45)
    - Add `obj.country` as 7th parameter to constructor call in fromObject()
    - Verify constructor already supports country parameter (line 27)
    - Verify toObject() already serializes country field (lines 53-61)
  - [x] 1.3 Ensure tests pass for country field fix
    - Run ONLY the 2-4 tests written in 1.1
    - Verify country data persists through serialization cycle
    - Do NOT run entire test suite at this stage
  - [x] 1.4 Commit LOC-001 fix
    - Commit message: "fix: add country parameter to EventLocation.fromObject() [LOC-001]"
    - Include unit tests in commit
    - Do NOT push yet (wait until all three fixes are complete)

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- Country field persists through EventLocation.fromObject() deserialization
- No data loss when country is present in serialized object
- Country field remains optional (no breaking changes)

### Bug Fix 2: Event Update 404 Error (LOC-003)

#### Task Group 2: Investigate and Fix Event Update Errors
**Dependencies:** None (independent of LOC-001)
**Estimated Effort:** 6-8 hours
**Commit Message:** "fix: resolve event update 404 error [LOC-003]"

- [x] 2.0 Fix event update 404 error
  - [x] 2.1 Use Playwright MCP to reproduce the 404 error
    - Start development server (npm run dev) - NOTE: Server is already running
    - Use Playwright MCP to navigate to login page
    - Log in with test account credentials
    - Create a new event with location data
    - Edit the event and modify location fields
    - Document exact steps that trigger the 404 error
    - Capture error details from browser console and network tab
  - [x] 2.2 Investigate potential root causes
    - Check frontend edit_event.vue component (lines 311-358)
    - Examine event update API endpoint (src/server/calendar/api/v1/events.ts, lines 104-152)
    - Review LocationService.findOrCreateLocation() method (src/server/calendar/service/locations.ts)
    - Check for location ID mismatch or invalid URL patterns
    - Verify permission checks are not failing incorrectly
    - Look for differences between new location creation and existing location editing
  - [x] 2.3 Write 2-6 focused tests for the identified issue
    - Write integration tests that reproduce the 404 scenario
    - Test both new location creation during event update
    - Test existing location editing during event update
    - Test edge cases identified during investigation
    - Focus only on the specific bug, not comprehensive coverage
  - [x] 2.4 Implement fix for root cause
    - Apply targeted fix based on investigation findings
    - Document root cause in code comments
    - Ensure fix handles both new and existing location scenarios
    - Maintain backward compatibility with existing events
  - [x] 2.5 Ensure LOC-003 tests pass
    - Run ONLY the 2-6 tests written in 2.3
    - Verify event updates succeed without 404 errors
    - Test both new location creation and existing location editing
    - Do NOT run entire test suite at this stage
  - [x] 2.6 Commit LOC-003 fix
    - Commit message: "fix: resolve event update 404 error [LOC-003]"
    - Include root cause explanation in commit message body
    - Include integration tests in commit
    - Do NOT push yet (wait until all three fixes are complete)

**Acceptance Criteria:**
- The 2-6 tests written in 2.3 pass
- 404 error is reliably reproduced and documented
- Root cause is identified and documented in commit message
- Event updates succeed for both new and existing locations
- No regression in existing event update functionality

### Bug Fix 3: Location Hierarchy Validation (LOC-002)

#### Task Group 3: Implement Location Validation Rules
**Dependencies:** Task Group 2 (LOC-003 should be fixed before adding validation)
**Estimated Effort:** 10 hours
**Commit Message:** "feat: add location hierarchy validation [LOC-002]"

- [ ] 3.0 Implement location hierarchy validation
  - [ ] 3.1 Write 4-8 focused unit tests for validation logic
    - Test name-only is valid (no other fields required)
    - Test city requires address (city without address is invalid)
    - Test state requires city AND address (state without both is invalid)
    - Test postal code requires state AND city AND address (postal code without all three is invalid)
    - Test valid combinations pass validation
    - Test validation returns array of specific error messages
    - Limit to 4-8 highly focused tests on validation rules only
  - [ ] 3.2 Create shared validation utility function
    - File: `src/common/model/location.ts` or new `src/common/validators/location.ts`
    - Function: `validateLocationHierarchy(location: EventLocation): string[]`
    - Returns array of error messages (empty array if valid)
    - Implements bottom-up validation rules:
      - Name only: Valid
      - City requires Address
      - State requires City AND Address
      - Postal Code requires State AND City AND Address
    - Error message format: "City requires Address to be filled in"
    - Must be usable by both client and server code
  - [ ] 3.3 Implement client-side validation in edit_event.vue
    - File: `src/client/components/logged_in/calendar/edit_event.vue`
    - Call validation function in saveModel() before API call
    - Display all validation errors above form (follow existing error pattern, lines 244-249)
    - Highlight invalid fields with standard warning color (use existing validation styling, lines 92-94)
    - Prevent API call if validation fails
    - Show all errors at once (do NOT validate on blur)
  - [ ] 3.4 Write 2-4 integration tests for server-side validation
    - Test API endpoint rejects invalid location combinations with 400 status
    - Test API returns clear error messages for invalid combinations
    - Test API accepts valid location combinations
    - Focus on API validation behavior, not exhaustive field combinations
  - [ ] 3.5 Implement server-side validation in API/service layer
    - Location: EventService or LocationService
    - Call validation function before database operations
    - Return 400 Bad Request with validation error messages
    - Ensure validation happens for both event creation and updates
    - Maintain consistent error format with client-side validation
  - [ ] 3.6 Ensure all LOC-002 tests pass
    - Run ONLY the 4-8 unit tests from 3.1
    - Run ONLY the 2-4 integration tests from 3.4
    - Verify validation rejects invalid combinations on both client and server
    - Verify validation accepts valid combinations including name-only
    - Do NOT run entire test suite at this stage
  - [ ] 3.7 Commit LOC-002 implementation
    - Commit message: "feat: add location hierarchy validation [LOC-002]"
    - Include all tests in commit
    - Do NOT push yet (wait for final verification)

**Acceptance Criteria:**
- The 4-8 unit tests from 3.1 pass
- The 2-4 integration tests from 3.4 pass
- Invalid location combinations are rejected on both client and server
- All validation errors display simultaneously on save attempt
- Invalid fields are highlighted with warning color
- Error messages are clear and brief (e.g., "City requires Address to be filled in")
- Valid combinations including name-only are accepted
- Validation is consistent between client and server

### Final Verification and Delivery

#### Task Group 4: Test All Fixes and Create Pull Request
**Dependencies:** Task Groups 1, 2, and 3

- [ ] 4.0 Final verification and delivery
  - [ ] 4.1 Run all feature-specific tests
    - Run tests from Task Group 1 (LOC-001 country field tests)
    - Run tests from Task Group 2 (LOC-003 event update tests)
    - Run tests from Task Group 3 (LOC-002 validation tests)
    - Expected total: approximately 8-18 tests
    - Verify all feature-specific tests pass
    - Do NOT run entire application test suite
  - [ ] 4.2 Manual browser testing of all three fixes
    - Test that country field persists through event editing
    - Test that event updates succeed without 404 errors
    - Test that validation prevents invalid location combinations
    - Test that validation allows valid combinations including name-only
    - Verify error messages display correctly with proper highlighting
  - [ ] 4.3 Review all three commits
    - Verify commit 1: "fix: add country parameter to EventLocation.fromObject() [LOC-001]"
    - Verify commit 2: "fix: resolve event update 404 error [LOC-003]"
    - Verify commit 3: "feat: add location hierarchy validation [LOC-002]"
    - Ensure each commit has proper tests included
    - Ensure each commit message is clear and descriptive
  - [ ] 4.4 Push commits and create pull request
    - Push all three commits to GitHub on feature branch
    - Create PR with title: "Location Management Fixes (LOC-001, LOC-002, LOC-003)"
    - PR description should summarize all three bug fixes
    - Include testing details and manual verification results
    - Link to spec documentation in PR description

**Acceptance Criteria:**
- All 8-18 feature-specific tests pass
- Manual browser testing confirms all three fixes work correctly
- Three separate commits with clear messages
- Pull request created with comprehensive description

## Execution Order

Recommended implementation sequence:
1. Bug Fix 1: Country Field (Task Group 1) - Simplest, standalone fix
2. Bug Fix 2: Event Update 404 (Task Group 2) - Unblock editing workflow
3. Bug Fix 3: Hierarchy Validation (Task Group 3) - Prevent future invalid data
4. Final Verification (Task Group 4) - Ensure all fixes work together

## Important Notes

- **Separate Commits**: Each bug fix must be in its own commit
- **Test Focus**: Write only 2-8 tests per task group, focusing on critical behaviors
- **No E2E Tests**: This spec does not include Playwright end-to-end tests
- **No Full Test Suite**: Do not run entire application test suite during development
- **Manual Testing**: Use Playwright MCP for reproducing LOC-003, manual browser testing for final verification
- **Implementation Order**: Must follow LOC-001 → LOC-003 → LOC-002 sequence
