# Requirements: Category Test Updates

This is the technical requirements document for the spec detailed in @agent-os/specs/2025-11-10-category-test-updates/spec.md

> Created: 2025-11-10
> Version: 1.0.0

## Technical Requirements

### Test File Updates

All category integration tests must be updated to use the correct calendar-scoped API route format:

**Old Format (Incorrect):**
- `GET /api/v1/categories/:categoryId`
- `PUT /api/v1/categories/:categoryId`
- `DELETE /api/v1/categories/:categoryId`
- `GET /api/v1/categories/:categoryId/events`

**New Format (Correct):**
- `GET /api/v1/calendars/:calendarId/categories/:categoryId`
- `PUT /api/v1/calendars/:calendarId/categories/:categoryId`
- `DELETE /api/v1/calendars/:calendarId/categories/:categoryId`
- `GET /api/v1/calendars/:calendarId/categories/:categoryId/events`

### Files Requiring Updates

1. **src/server/test/integration/category_basic.test.ts** (1 failure)
   - Update GET category request to include calendarId in route

2. **src/server/test/integration/category_multilingual.test.ts** (4 failures)
   - Update all category CRUD operations to use calendar-scoped routes
   - Maintain multilingual content testing logic

3. **src/server/test/integration/category_permissions.test.ts** (6 failures)
   - Update permission test routes to include calendarId
   - Preserve permission validation test logic

4. **src/server/test/integration/category_permissions_simple.test.ts** (5 failures)
   - Update simplified permission tests to use calendar-scoped routes
   - Maintain test scenarios for unauthorized access

5. **src/server/calendar/test/api/categories.test.ts** (3 failures)
   - Fix DELETE operation tests returning 500 errors
   - Investigate root cause of unexpected 500 responses
   - Ensure proper error codes (404, 403) are returned

### Technical Approach

**Pattern to Follow:**

```typescript
// OLD (incorrect):
const response = await request(app)
  .get(`/api/v1/categories/${categoryId}`)
  .set('Authorization', `Bearer ${token}`);

// NEW (correct):
const response = await request(app)
  .get(`/api/v1/calendars/${calendarId}/categories/${categoryId}`)
  .set('Authorization', `Bearer ${token}`);
```

**Calendar ID Extraction:**
- Tests should use the `calendar.id` from test setup fixtures
- Maintain existing test data creation patterns
- No changes to test assertions or validation logic

### Testing Strategy

1. **Update tests one file at a time** - Complete each file before moving to next
2. **Run targeted tests** - Verify each updated file independently
3. **Maintain test coverage** - Ensure all existing test scenarios remain covered
4. **No new tests required** - Only update existing test routes

### Success Criteria

- All 23 integration test failures resolved
- All 3 unit test failures in categories.test.ts resolved
- Test suite achieves 100% pass rate for category tests
- No regression in test coverage or assertions
- Test execution time remains similar

## Implementation Notes

### Reference Implementation

The `category_comprehensive.test.ts` file was successfully updated in the previous spec and serves as the reference implementation for proper calendar-scoped route usage.

### Common Pitfalls

1. **Missing calendarId variable** - Ensure test fixtures provide calendar.id
2. **Route parameter order** - calendarId must come before categoryId in URL
3. **Authorization headers** - Maintain existing auth patterns
4. **Response assertions** - Do not modify expected response formats

### External Dependencies

- No new dependencies required
- Uses existing Vitest and Supertest infrastructure
- Leverages current test fixture patterns
