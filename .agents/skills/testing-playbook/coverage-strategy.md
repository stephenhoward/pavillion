# Coverage Strategy

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for what behavior to validate and how to target coverage effectively.

## Established Convention

### The Coverage Triangle

For any piece of functionality, test in this priority order:

1. **Happy path** -- the primary success case that most users will hit. Always test this.
2. **Key error states** -- the 2-3 most likely failure modes (invalid input, not found, unauthorized). Test these.
3. **Edge cases** -- boundary conditions, empty collections, concurrent access, Unicode. Test only when the cost of a bug is high.
4. **Exhaustive branches** -- every if/else, every enum value. Test only for state machines or security-critical paths.

Most features need levels 1-2. Level 3 is for payment, auth, and federation code. Level 4 is rare.

### What to Assert

**Assert behavior, not implementation:**

```typescript
// GOOD: asserts what the user cares about
it('should return only upcoming events', async () => {
  const result = await service.getUpcomingEvents(calendarId);
  for (const event of result) {
    expect(event.startDate >= now).toBe(true);
  }
});

// BAD: asserts internal implementation details
it('should call findAll with the right where clause', async () => {
  await service.getUpcomingEvents(calendarId);
  expect(stub.firstCall.args[0].where.startDate[Op.gte]).toBeDefined();
});
```

**Assert the meaningful output:**

| Function type | Assert on |
|--------------|-----------|
| Returns a value | The returned value's properties |
| Modifies state | The state after the call |
| Throws an exception | The exception type and message |
| Calls an external system | That the call was made with correct arguments (stub verification) |
| Emits an event | That the event was emitted with correct payload |

### Happy Path Coverage

Every public method/endpoint needs at least one happy path test that:
- Provides valid input
- Asserts the primary success output
- Verifies any side effects (database writes, events emitted)

### Error State Coverage

For each public method/endpoint, identify the 2-3 most likely failures:

| Failure type | When to test | Example |
|-------------|-------------|---------|
| Invalid input | Always | Empty title, invalid email format |
| Not found | When the method does a lookup | Event/calendar/account doesn't exist |
| Unauthorized | When auth is enforced | Non-owner tries to edit |
| Conflict | When uniqueness matters | Duplicate URL name |

Skip error states that are:
- Handled by framework middleware (express body parsing, type coercion)
- Impossible given the type system (TypeScript prevents wrong types at compile time)
- Only reachable through internal code paths (no user-facing trigger)

### Regression Tests

A regression test is justified when:
- A bug was found in production or during testing
- The fix is non-obvious (someone might revert it unknowingly)
- The bug crosses a boundary (e.g., API serialization issue, timezone edge case)

Format: include a comment linking to the bug context.

```typescript
// Regression: events with no endTime were rejected by Mobilizon (pv-abc123)
it('should synthesize endTime when schedule has no explicit end', () => { ... });
```

## Anti-Patterns

### Testing the Framework

```typescript
// BAD: testing that Express routes a request (Express already does this)
it('should route GET /api/v1/calendars to listCalendars', () => { ... });

// BAD: testing that Sequelize saves a record (Sequelize already does this)
it('should persist the entity to the database', async () => {
  await entity.save();
  const found = await Entity.findByPk(entity.id);
  expect(found).toBeDefined();
});

// GOOD: testing YOUR logic that uses the framework
it('should return only calendars the user can edit', async () => { ... });
```

### Asserting on Irrelevant Details

```typescript
// BAD: asserting exact call count when it doesn't matter
expect(stub.callCount).toBe(3);

// BAD: asserting argument order when only some args matter
expect(stub.firstCall.args).toEqual([calendarId, accountId, 'editor', true, null]);

// GOOD: asserting only what matters
expect(stub.calledWith(calendarId, accountId)).toBe(true);
```

### Testing Every Enum Value

```typescript
// BAD: a separate test for each role type when the logic is identical
it('should allow admin role', () => { ... });
it('should allow editor role', () => { ... });
it('should allow viewer role', () => { ... });

// GOOD: parameterized test if the logic differs, or one test if it doesn't
it('should allow any valid role', () => {
  for (const role of ['admin', 'editor', 'viewer']) {
    expect(service.isValidRole(role)).toBe(true);
  }
});
```

### Over-Testing Simple CRUD

```typescript
// BAD: 15 tests for a simple CRUD service with no business logic
// (create returns, create persists, create sets id, create sets name, ...)

// GOOD: 3-4 tests covering the meaningful behavior
it('should create and return the entity with generated id', () => { ... });
it('should reject creation with invalid data', () => { ... });
it('should throw NotFound when updating non-existent entity', () => { ... });
```

## Known Drift

- Some service test files have extensive stub verification tests that test wiring rather than behavior
- Integration test coverage is inconsistent -- some domains have thorough API tests, others rely mostly on unit tests
- Some tests assert on exact error messages rather than error types, making them brittle to copy changes
