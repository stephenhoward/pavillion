# Spec Tasks

These are the tasks to be completed for the spec detailed in @agent-os/specs/2025-11-10-category-test-updates/spec.md

> Created: 2025-11-10
> Status: Completed

## Overview

Total Tasks: 5 major task groups
Total Failing Tests: 26 (23 integration + 3 unit)

**Pattern Reference:** `src/server/test/integration/category_comprehensive.test.ts`

**Route Update Pattern:**
```typescript
// OLD (incorrect):
.get(`/api/v1/categories/${categoryId}`)

// NEW (correct):
.get(`/api/v1/calendars/${calendar.id}/categories/${categoryId}`)
```

## Task List

### Task Group 1: Update category_basic.test.ts
**Dependencies:** None
**Failures:** 1 integration test

- [x] 1.0 Fix basic category retrieval test
  - [x] 1.1 Open `src/server/test/integration/category_basic.test.ts`
  - [x] 1.2 Locate GET request for category retrieval
  - [x] 1.3 Update route from `/api/v1/categories/:categoryId` to `/api/v1/calendars/:calendarId/categories/:categoryId`
  - [x] 1.4 Ensure calendar.id variable is available in test context
  - [x] 1.5 Run test: `npx vitest run src/server/test/integration/category_basic.test.ts`
  - [x] 1.6 Verify test passes

**Acceptance Criteria:**
- Test file executes without errors
- Category retrieval test passes with calendar-scoped route
- No changes to test assertions or validation logic

---

### Task Group 2: Update category_multilingual.test.ts
**Dependencies:** Task Group 1 (pattern established)
**Failures:** 4 integration tests

- [x] 2.0 Fix multilingual category tests
  - [x] 2.1 Open `src/server/test/integration/category_multilingual.test.ts`
  - [x] 2.2 Update GET category requests to use `/api/v1/calendars/:calendarId/categories/:categoryId`
  - [x] 2.3 Update PUT category requests to use `/api/v1/calendars/:calendarId/categories/:categoryId`
  - [x] 2.4 Update DELETE category requests to use `/api/v1/calendars/:calendarId/categories/:categoryId`
  - [x] 2.5 Update any category events requests to use `/api/v1/calendars/:calendarId/categories/:categoryId/events`
  - [x] 2.6 Run test: `npx vitest run src/server/test/integration/category_multilingual.test.ts`
  - [x] 2.7 Verify all 4 tests pass

**Acceptance Criteria:**
- All 4 multilingual tests pass
- Multilingual content handling logic preserved
- Language selection and content updates work correctly

---

### Task Group 3: Update category_permissions.test.ts
**Dependencies:** Task Groups 1-2 (pattern established)
**Failures:** 6 integration tests

- [x] 3.0 Fix category permission tests
  - [x] 3.1 Open `src/server/test/integration/category_permissions.test.ts`
  - [x] 3.2 Update all GET requests to use calendar-scoped routes
  - [x] 3.3 Update all PUT requests to use calendar-scoped routes
  - [x] 3.4 Update all DELETE requests to use calendar-scoped routes
  - [x] 3.5 Update any category events requests to use calendar-scoped routes
  - [x] 3.6 Run test: `npx vitest run src/server/test/integration/category_permissions.test.ts`
  - [x] 3.7 Verify all 6 permission tests pass

**Acceptance Criteria:**
- All 6 permission validation tests pass
- Editor permission checks work correctly
- Non-editor access denial tests pass
- Calendar not found handling works

---

### Task Group 4: Update category_permissions_simple.test.ts
**Dependencies:** Task Groups 1-3 (pattern established)
**Failures:** 5 integration tests

- [x] 4.0 Fix simplified permission tests
  - [x] 4.1 Open `src/server/test/integration/category_permissions_simple.test.ts`
  - [x] 4.2 Update all category operation routes to calendar-scoped format
  - [x] 4.3 Ensure calendarId variables are properly referenced
  - [x] 4.4 Run test: `npx vitest run src/server/test/integration/category_permissions_simple.test.ts`
  - [x] 4.5 Verify all 5 simplified tests pass

**Acceptance Criteria:**
- All 5 simplified permission tests pass
- Simple editor access test works
- Non-editor denial tests work
- Calendar owner and collaborator tests pass

---

### Task Group 5: Fix Unit Test DELETE Operations
**Dependencies:** Task Groups 1-4 (integration tests complete)
**Failures:** 11 unit tests in categories.test.ts (GET/PUT/DELETE operations)

- [x] 5.0 Resolve operation 500 errors
  - [x] 5.1 Open `src/server/calendar/test/api/categories.test.ts`
  - [x] 5.2 Identify the 11 failing tests returning 500 errors (GET, PUT, DELETE)
  - [x] 5.3 Analyze why operations return 500 instead of expected error codes
  - [x] 5.4 Add missing getCalendar stubs to all failing tests
  - [x] 5.5 Verify tests expect correct error codes (200, 204, 404, 403)
  - [x] 5.6 Run test: `npx vitest run src/server/calendar/test/api/categories.test.ts`
  - [x] 5.7 Verify all 33 unit tests pass with correct error codes

**Acceptance Criteria:**
- DELETE test for non-existent category returns 404 (not 500)
- DELETE test for insufficient permissions returns 403 (not 500)
- All 3 unit test failures resolved
- No regression in other category unit tests

---

### Task Group 6: Full Test Suite Verification
**Dependencies:** Task Groups 1-5 (all updates complete)

- [x] 6.0 Verify complete test suite
  - [x] 6.1 Run all category integration tests: `npx vitest run src/server/test/integration/category`
  - [x] 6.2 Run category unit tests: `npx vitest run src/server/calendar/test/api/categories.test.ts`
  - [x] 6.3 Verify 0 failing tests (previously 26+ failures, now all passing)
  - [x] 6.4 Confirm no regression in category_comprehensive.test.ts (19 tests still passing)
  - [x] 6.5 Verify 62 integration tests passing, 33 unit tests passing
  - [x] 6.6 Verify no new test failures introduced

**Acceptance Criteria:**
- All 26 previously failing tests now pass
- category_comprehensive.test.ts continues to pass (19 tests)
- Full test suite passes with no new failures
- Overall test count remains the same

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** - Establish pattern with single failing test
2. **Task Group 2** - Apply pattern to multilingual tests (4 failures)
3. **Task Group 3** - Apply pattern to permission tests (6 failures)
4. **Task Group 4** - Apply pattern to simplified permission tests (5 failures)
5. **Task Group 5** - Fix unit test DELETE operations (3 failures)
6. **Task Group 6** - Verify complete test suite health

## Implementation Notes

### Calendar ID Availability
All test files should already have calendar objects created in test setup. Reference the calendar as:
```typescript
calendar.id  // or calendarId if stored separately
```

### Route Construction Pattern
```typescript
// For category operations:
`/api/v1/calendars/${calendar.id}/categories/${categoryId}`

// For category events:
`/api/v1/calendars/${calendar.id}/categories/${categoryId}/events`
```

### Testing Strategy
- Update one file at a time
- Run targeted tests after each file update
- Verify no regression before proceeding
- Run full suite only after all updates complete

### Expected Test Counts
- category_basic.test.ts: ~1-2 tests
- category_multilingual.test.ts: ~4 tests
- category_permissions.test.ts: ~6 tests
- category_permissions_simple.test.ts: ~5 tests
- categories.test.ts: ~10-15 tests (3 DELETE tests failing)
- category_comprehensive.test.ts: 19 tests (already passing)

**Total Expected:** ~45-52 category-related tests, all should pass after completion
