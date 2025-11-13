# Spec Requirements Document

> Spec: Category Test Updates
> Created: 2025-11-10
> Status: Planning

## Overview

Update remaining category integration tests to use calendar-scoped routes, resolving 23 failing tests identified during the category-crud-fixes verification. This spec addresses technical debt by updating legacy test files that were written expecting routes that were never implemented.

## User Stories

### Test Maintenance Engineer

As a test maintenance engineer, I want all category integration tests to use the correct calendar-scoped API routes, so that the test suite accurately reflects the actual API implementation and provides reliable regression protection.

**Workflow:**
1. Identify all test files with failing category API calls
2. Update each test to use calendar-scoped routes (`/api/v1/calendars/:calendarId/categories/:categoryId`)
3. Verify all tests pass after updates
4. Ensure test coverage remains comprehensive

## Spec Scope

1. **Update category_basic.test.ts** - Fix 1 failing test to use calendar-scoped routes
2. **Update category_multilingual.test.ts** - Fix 4 failing tests to use calendar-scoped routes
3. **Update category_permissions.test.ts** - Fix 6 failing tests to use calendar-scoped routes
4. **Update category_permissions_simple.test.ts** - Fix 5 failing tests to use calendar-scoped routes
5. **Fix DELETE operation tests** - Resolve 3 unit test failures in categories.test.ts where DELETE operations return 500 instead of expected error codes

## Out of Scope

- Creating new test cases (only updating existing tests)
- Fixing the 4 E2E test configuration errors (unrelated to this spec)
- Modifying API implementation (routes are correct, tests are outdated)
- Adding additional test coverage beyond existing tests

## Expected Deliverable

1. All 23 failing category integration tests updated and passing
2. All 3 unit test failures in categories.test.ts resolved
3. Test suite achieves 100% pass rate for category-related tests
4. No regression in existing test coverage
