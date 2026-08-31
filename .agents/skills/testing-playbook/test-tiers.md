# Test Tiers

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for choosing the right test type for each piece of functionality.

## Established Convention

### Tier Definitions

| Tier | Tool | What it validates | Speed | When to use |
|------|------|-------------------|-------|-------------|
| **Unit** | Vitest + sinon stubs | Single function/method logic in isolation | < 50ms per test | Service methods, model methods, utility functions, computed logic |
| **Integration** | Vitest + supertest (no stubs) | Multiple layers working together through a real request | < 500ms per test | API route -> service -> database round-trips, cross-domain interface calls |
| **E2E** | Playwright | Full user workflow through the browser | Seconds | Critical user journeys, flows that cross frontend/backend boundary |
| **Federation E2E** | Playwright + Docker | Multi-instance ActivityPub flows | Minutes | Federation-specific: follow, share, inbox/outbox processing |

### Tier Selection Rules

**Default to unit tests.** Most logic should be testable in isolation.

**Use integration tests when:**
- The value is in the wiring, not the logic (e.g., "does the API handler call the right service method with the right arguments and return the right HTTP status?")
- The behavior depends on database queries (joins, ordering, filtering)
- The behavior spans domain boundaries through interfaces

**Use e2e tests when:**
- The flow involves user interaction across multiple pages or components
- The behavior requires both frontend and backend to be correct simultaneously
- The flow is a critical path that must not break (login, event creation, calendar viewing)

**Do NOT use e2e tests for:**
- Validation logic (test at unit or integration level)
- Individual API endpoints in isolation (use integration tests)
- Edge cases or error states that can be triggered at a lower tier

### Backend Test Boundaries

```
Unit tests (sinon stubs):
  Service method -> stub entity calls -> verify logic

Integration tests (real database):
  HTTP request -> API handler -> service -> entity -> SQLite -> response

E2e tests (browser):
  Browser -> Vite frontend -> Express backend -> database -> rendered page
```

### Frontend Test Boundaries

```
Unit tests (happy-dom + vue test utils):
  Mount component -> interact -> verify rendered output and emitted events

E2e tests (Playwright):
  Browser -> full app -> verify user-visible behavior
```

### What Each Tier Owns

| Concern | Tested at |
|---------|-----------|
| Business rule logic | Unit |
| Model serialization (toObject/fromObject) | Unit |
| Entity conversion (toModel/fromModel) | Unit |
| API route wiring and HTTP status codes | Integration |
| Database query correctness | Integration |
| Cross-domain interface contracts | Integration |
| Authentication/authorization enforcement | Integration |
| Component rendering and user interaction | Unit (vue test utils) |
| Full user workflows | E2e |
| Visual regressions | E2e (screenshot comparison) |

## Anti-Patterns

### E2E Testing What Should Be Unit Tested

```typescript
// BAD: e2e test for validation logic
test('event title cannot be empty', async ({ page }) => {
  await page.goto('/calendar/test/events/new');
  await page.click('button[type="submit"]');
  await expect(page.locator('.error')).toBeVisible();
});

// GOOD: unit test for validation logic
it('should reject empty event title', () => {
  expect(() => service.validateEvent({ title: '' })).toThrow();
});
```

### Unit Testing Database Queries

```typescript
// BAD: unit test that stubs the query but doesn't test it
sandbox.stub(EventEntity, 'findAll').resolves([mockEvent]);
const result = await service.getUpcomingEvents(calendarId);
expect(result).toHaveLength(1);
// This only tests that the service returns what findAll returns -- not useful

// GOOD: integration test that runs the real query
const result = await request(app)
  .get(`/api/v1/calendars/${calendarId}/events?upcoming=true`)
  .expect(200);
expect(result.body[0].startDate).toBeAfter(now);
```

### Integration Testing Pure Logic

```typescript
// BAD: hitting the database to test a pure function
it('should format event duration correctly', async () => {
  const event = await EventEntity.create({ ... });
  const model = event.toModel();
  expect(model.formattedDuration()).toBe('2 hours');
});

// GOOD: unit test for pure logic
it('should format event duration correctly', () => {
  const event = new Event();
  event.startDate = DateTime.fromISO('2026-01-01T10:00:00');
  event.endDate = DateTime.fromISO('2026-01-01T12:00:00');
  expect(event.formattedDuration()).toBe('2 hours');
});
```

## Known Drift

- Some older service tests use integration-style setup (creating real database records) when stubs would suffice
- Some API handler tests stub at the service level rather than using supertest through the full stack
- E2e test coverage is uneven -- critical paths like login and event creation are well covered, but some admin workflows lack e2e tests
