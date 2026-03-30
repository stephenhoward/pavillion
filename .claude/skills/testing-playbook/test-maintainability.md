# Test Maintainability

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for keeping test suites maintainable, readable, and appropriately sized.

## Established Convention

### Test Suite Size

**Guideline:** A test file should have 5-15 tests. More than 20 tests in a single describe block is a smell -- either the code under test does too much, or the tests are too granular.

**Right-sizing heuristic:**
- Simple CRUD service: 3-5 tests
- Service with business logic: 5-12 tests
- Complex state machine or workflow: 10-20 tests (justified by branch coverage)
- API route handler: 3-6 tests per endpoint (happy path, auth, key errors)

### Test Readability

**Each test should tell a story in three lines:**

```typescript
// GOOD: setup, act, assert are clear
it('should reject event creation without a title', async () => {
  const eventData = { ...validEvent, title: '' };       // setup
  const result = service.createEvent(account, eventData); // act
  await expect(result).rejects.toThrow(ValidationError);  // assert
});
```

**Test names should describe behavior, not implementation:**

```typescript
// GOOD: describes what the user/caller experiences
'should return 404 when calendar does not exist'
'should include category names in the response'
'should reject dates in the past'

// BAD: describes internal mechanics
'should call findOne with the correct ID'
'should invoke the validateDate helper'
'should set the category_id column'
```

### Fixture and Setup Patterns

**Sinon sandbox per describe block:**

```typescript
describe('EventService', () => {
  let sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());
});
```

**Fresh instances per test:**

```typescript
beforeEach(() => {
  service = new EventService(new EventEmitter());
});
```

**Factory helpers for complex objects:**

When multiple tests need the same complex object shape, extract a helper:

```typescript
function buildEvent(overrides: Partial<Event> = {}): Event {
  return new Event({
    id: uuidv4(),
    title: 'Test Event',
    startDate: DateTime.now().plus({ days: 1 }),
    ...overrides,
  });
}
```

Keep factories in the same test file unless shared across multiple test files. Shared factories go in `src/server/{domain}/test/helpers/` or `src/common/test/helpers/`.

### DRY vs Clarity in Tests

**Prefer clarity over DRY.** Some duplication in tests is acceptable if it makes each test independently readable. A reader should understand what a test does without scrolling to a shared setup.

**Extract when:**
- The same 5+ line setup appears in 4+ tests
- The setup is complex enough that repetition makes tests hard to read
- The helper would have a clear, descriptive name

**Don't extract when:**
- The duplication is 1-3 lines
- The shared setup would need parameters that obscure its purpose
- Only 2-3 tests share the pattern

### Test Isolation

- Tests must not depend on execution order
- Tests must not share mutable state
- Each test restores its own stubs (sandbox.restore in afterEach)
- Integration tests that touch the database should clean up after themselves

## Anti-Patterns

### God Test Files

```typescript
// BAD: 40+ tests in one file covering every method of a service
describe('CalendarService', () => {
  // ... 45 tests covering create, update, delete, list, permissions, url names, ...
});

// GOOD: split by concern
// calendar-service.create.test.ts
// calendar-service.permissions.test.ts
// calendar-service.url-names.test.ts
```

### Setup-Heavy Tests

```typescript
// BAD: 20 lines of setup for a 1-line assertion
it('should return true', async () => {
  const account = new Account(uuidv4());
  const calendar = new Calendar(uuidv4());
  const event = new Event(uuidv4());
  // ... 17 more lines of setup ...
  expect(result).toBe(true);
});

// GOOD: extract setup to helper or beforeEach, keep test focused
it('should return true for valid event', async () => {
  const result = await service.isValid(buildEvent());
  expect(result).toBe(true);
});
```

### Snapshot Overuse

```typescript
// BAD: snapshot testing complex objects (brittle, hard to review)
expect(response.body).toMatchSnapshot();

// GOOD: assert on specific fields that matter
expect(response.body.title).toBe('Community Meetup');
expect(response.body.categories).toHaveLength(2);
```

### Commented-Out Tests

```typescript
// BAD: dead tests left in the file
// it('should handle edge case', () => { ... });

// GOOD: delete it. Git has the history.
```

## Known Drift

- Some test files exceed 20 tests, particularly in the calendar and activitypub domains
- Factory helpers are inconsistently used -- some test files build objects inline, others use helpers
- A few test files have shared mutable state between tests (setup in describe scope rather than beforeEach)
