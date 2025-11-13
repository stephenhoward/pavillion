# Tests Specification

This is the tests coverage details for the spec detailed in @agent-os/specs/2025-11-10-category-test-updates/spec.md

> Created: 2025-11-10
> Version: 1.0.0

## Test Coverage

### Verification Strategy

Since this spec updates existing tests rather than creating new functionality, the verification approach focuses on:

1. **Test Execution Verification** - Ensuring updated tests pass
2. **No Regression** - Confirming existing test coverage is maintained
3. **Coverage Analysis** - Validating that test assertions remain comprehensive

### Unit Test Updates

**File: src/server/calendar/test/api/categories.test.ts**

Tests to fix (3 failures):
- DELETE operation returning 500 instead of 404 for non-existent category
- DELETE operation returning 500 instead of 403 for insufficient permissions
- DELETE operation returning 500 instead of proper error codes

Verification:
- Run unit tests for categories.test.ts specifically
- Confirm all DELETE operation tests pass with correct error codes
- Verify no regression in other category unit tests

### Integration Test Updates

**File: src/server/test/integration/category_basic.test.ts (1 failure)**

Tests to update:
- Basic category retrieval test using GET route

Verification:
- Run `npx vitest run src/server/test/integration/category_basic.test.ts`
- Confirm test passes with calendar-scoped route
- Verify test assertion logic unchanged

**File: src/server/test/integration/category_multilingual.test.ts (4 failures)**

Tests to update:
- Category creation with multiple languages
- Category retrieval with language selection
- Category update with multilingual content
- Category deletion with multilingual content

Verification:
- Run `npx vitest run src/server/test/integration/category_multilingual.test.ts`
- Confirm all 4 tests pass
- Verify multilingual content logic preserved

**File: src/server/test/integration/category_permissions.test.ts (6 failures)**

Tests to update:
- Editor permission validation for GET
- Editor permission validation for PUT
- Editor permission validation for DELETE
- Non-editor access denial for PUT
- Non-editor access denial for DELETE
- Calendar not found handling

Verification:
- Run `npx vitest run src/server/test/integration/category_permissions.test.ts`
- Confirm all 6 permission tests pass
- Verify permission validation logic intact

**File: src/server/test/integration/category_permissions_simple.test.ts (5 failures)**

Tests to update:
- Simple editor access test
- Simple non-editor denial test
- Calendar owner access test
- Collaborator access test
- Anonymous user denial test

Verification:
- Run `npx vitest run src/server/test/integration/category_permissions_simple.test.ts`
- Confirm all 5 simplified permission tests pass
- Verify test scenarios remain valid

### Full Test Suite Verification

After all updates complete:

**Targeted Test Run:**
```bash
npx vitest run src/server/test/integration/category --reporter=verbose
npx vitest run src/server/calendar/test/api/categories.test.ts --reporter=verbose
```

**Expected Results:**
- All category integration tests pass (previously 23 failures)
- All category unit tests pass (previously 3 failures)
- Total category test count remains the same
- No new test failures introduced

**Success Metrics:**
- 0 failing tests in category test files
- 100% pass rate for category-related tests
- Test execution time within 10% of baseline

### Regression Prevention

**Tests That Must Continue Passing:**

1. **category_comprehensive.test.ts** - 19 tests (already passing)
2. **Service layer tests** - 26 tests (already passing)
3. **Frontend component tests** - 39 tests (already passing)

Verification:
- Run full test suite after updates
- Confirm no regression in passing tests
- Verify overall test count unchanged

### Coverage Analysis

**No Coverage Reduction:**
- Maintain line coverage for category routes
- Preserve branch coverage for error handling
- Keep statement coverage for permission logic

Verification:
```bash
npm run test:coverage
```

Confirm category-related files maintain or improve coverage percentages.

## Mocking Requirements

No new mocking required - tests use existing patterns:
- Supertest for HTTP request mocking
- Sinon for service layer stubbing (where applicable)
- Test fixtures for database state setup

## Test Data

Tests use existing fixture data:
- Pre-created calendar instances
- Pre-created user accounts with various permissions
- Pre-created category instances for update/delete tests

No changes to test data structure or creation patterns required.
