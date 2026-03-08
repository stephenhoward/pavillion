# Test Pattern Consistency

> Version: 1.0.0
> Last Updated: 2026-02-21

Conventions for test file structure, mocking, assertions, and test organization.

## Test File Location

### Established Convention

```
src/server/{domain}/test/              # Backend domain tests
src/client/test/                        # Client component and store tests
src/site/test/                          # Site component and store tests
src/common/test/                        # Shared model tests
```

**Key points:**
- Backend tests live within their domain's `test/` directory
- Frontend tests live in the app's `test/` directory (`client/test/`, `site/test/`)
- Common model tests live in `src/common/test/`
- Test file names match the module under test with `.test.ts` suffix

### Test File Naming

```
# Backend service tests
src/server/calendar/test/categories_service.test.ts
src/server/calendar/test/events_service.test.ts
src/server/calendar/test/calendar_service.test.ts

# Frontend store tests
src/client/test/categoryStore.test.ts
src/client/test/calendarStore.test.ts

# Model tests
src/common/test/event_category.test.ts
src/common/test/calendar.test.ts
```

Backend test files use **snake_case** (matching the service/entity naming). Frontend test files use **camelCase** (matching the store naming). Both use `.test.ts` suffix.

---

## Test Structure

### Established Convention

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

describe('CategoryService', () => {
  let sandbox: sinon.SinonSandbox;
  let categoryService: CategoryService;
  let mockCalendarService: sinon.SinonStubbedInstance<CalendarService>;
  let testAccount: Account;
  let testCalendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create mock dependencies
    mockCalendarService = sandbox.createStubInstance(CalendarService);
    categoryService = new CategoryService(mockCalendarService as any);

    // Create test data
    testAccount = new Account('account-123', 'test@example.com', 'testuser');
    testCalendar = new Calendar('calendar-123', 'account-123');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createCategory', () => {
    it('should create a new category with content', async () => {
      // Setup
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const categorySaveStub = sandbox.stub(EventCategoryEntity.prototype, 'save');

      // Act
      const category = await categoryService.createCategory(testAccount, 'calendar-123', categoryData);

      // Assert
      expect(category).toBeInstanceOf(EventCategory);
      expect(category.calendarId).toBe('calendar-123');
      expect(categorySaveStub.calledOnce).toBeTruthy();
    });

    it('should throw error for non-existent calendar', async () => {
      mockCalendarService.getCalendar.resolves(null);

      await expect(
        categoryService.createCategory(testAccount, 'non-existent', categoryData),
      ).rejects.toThrow(CalendarNotFoundError);
    });
  });
});
```

**Key points:**
- Imports from `vitest`: `describe`, `it`, `expect`, `beforeEach`, `afterEach`
- `sinon` for mocking (not `vi.mock()`)
- Nested `describe` blocks: outer = class name, inner = method name
- `beforeEach` creates sandbox, mocks, and test data
- `afterEach` calls `sandbox.restore()`
- Test names use `should {expected behavior}` format

---

## Sinon Sandbox Lifecycle

### Established Convention

```typescript
let sandbox: sinon.SinonSandbox;

beforeEach(() => {
  sandbox = sinon.createSandbox();
});

afterEach(() => {
  sandbox.restore();
});
```

**All stubs, spies, and mocks are created through the sandbox** — never with bare `sinon.stub()`. This ensures complete cleanup between tests.

---

## Stub Patterns

### Established Convention

**Stubbing service dependencies:**
```typescript
// Create a fully stubbed instance of a class
mockCalendarService = sandbox.createStubInstance(CalendarService);

// Configure stub behavior
mockCalendarService.getCalendar.resolves(testCalendar);
mockCalendarService.userCanModifyCalendar.resolves(true);
mockCalendarService.getCalendar.resolves(null); // For not-found tests
```

**Stubbing entity/model methods:**
```typescript
// Stub prototype methods (for entity .save(), .destroy(), etc.)
const saveSaveStub = sandbox.stub(EventCategoryEntity.prototype, 'save');
const contentSaveStub = sandbox.stub(EventCategoryContentEntity.prototype, 'save');

// Stub static methods (for findAll, findByPk, etc.)
sandbox.stub(EventCategoryEntity, 'findAll').resolves([mockEntity]);
sandbox.stub(EventCategoryEntity, 'findByPk').resolves(mockEntity);
```

**Stub assertions:**
```typescript
// Check if a stub was called
expect(saveSaveStub.calledOnce).toBeTruthy();
expect(mockCalendarService.getCalendar.called).toBeTruthy();

// Check stub call arguments
expect(saveSaveStub.calledWith(expectedArgs)).toBeTruthy();
```

---

## Assertion Style

### Established Convention

```typescript
// Type/instance checks
expect(category).toBeInstanceOf(EventCategory);
expect(result).toBeNull();

// Value equality
expect(category.calendarId).toBe('calendar-123');
expect(store.categories['calendar-123']).toHaveLength(1);

// Deep equality
expect(store.categories['calendar-123'][0]).toStrictEqual(category);

// Boolean truthy (for sinon stubs)
expect(categorySaveStub.calledOnce).toBeTruthy();

// Exception assertions
await expect(
  categoryService.createCategory(testAccount, 'non-existent', data),
).rejects.toThrow(CalendarNotFoundError);

// Negative assertions
expect(store.categories['calendar-123']).not.toContain(removedCategory);
```

**Key points:**
- Use `toBe()` for primitives and strict equality
- Use `toStrictEqual()` for deep object comparison
- Use `toBeInstanceOf()` for type checks
- Use `toHaveLength()` for array length
- Use `toBeTruthy()` for sinon stub call checks
- Use `rejects.toThrow(ErrorClass)` for async exception testing

---

## Pinia Store Tests

### Established Convention

```typescript
import { createPinia, setActivePinia } from 'pinia';

describe('CategoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('addCategory', () => {
    it('should add a category to the store', () => {
      const store = useCategoryStore();
      const category = new EventCategory('category-1', 'calendar-123');

      store.addCategory('calendar-123', category);

      expect(store.categories['calendar-123']).toHaveLength(1);
    });
  });
});
```

**Key points:**
- `setActivePinia(createPinia())` in `beforeEach` — required for Pinia test isolation
- Store is obtained via the composable: `const store = useCategoryStore()`
- No sinon sandbox needed for pure store tests
- Test data uses domain model instances

---

## Known Drift

- **Assertion style for stubs**: Some tests use `expect(stub.calledOnce).toBe(true)` while others use `expect(stub.calledOnce).toBeTruthy()`. Both work, but `toBeTruthy()` is more common in the codebase.
- **Test data factories**: There are no shared test data factory functions. Each test file creates its own test data in `beforeEach`. This is acceptable for the current codebase size — a shared factory would be premature abstraction.
- **Integration vs unit test distinction**: Integration tests (in `vitest.integration.config.ts`) test against a real database. Unit tests mock all DB access with sinon stubs. The two should not be mixed in the same file.
