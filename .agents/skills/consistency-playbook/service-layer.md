# Service Layer Consistency

> Version: 1.0.0
> Last Updated: 2026-02-21

Conventions for service classes, method signatures, validation, cross-domain communication, and event bus usage.

## Service Class Structure

### Established Convention

```typescript
// src/server/{domain}/service/{resource}.ts

/**
 * Service for managing event categories within calendars.
 * Handles CRUD operations for categories with multi-language support.
 */
class CategoryService {
  constructor(private calendarService?: CalendarService) {}

  /**
   * Create a new category for a calendar
   */
  async createCategory(account: Account, calendarId: string, categoryData: Record<string, any>): Promise<EventCategory> {
    // 1. Validate permissions
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) throw new CalendarNotFoundError();

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) throw new InsufficientCalendarPermissionsError();

    // 2. Perform operation
    const categoryEntity = EventCategoryEntity.build({ id: uuidv4(), calendar_id: calendarId });
    await categoryEntity.save();

    // 3. Return domain model
    return categoryEntity.toModel();
  }
}
```

**Key points:**
- Class name: `{Resource}Service` (PascalCase)
- Constructor receives dependencies (other services or interfaces)
- JSDoc comment on the class and public methods
- Methods are `async` and return `Promise<DomainModel>`
- All business logic lives here — not in API handlers or entities

---

## Method Signature Conventions

### Established Convention

Method parameters follow a consistent order:

```typescript
// Pattern: (account, resourceId, data)
async createCategory(account: Account, calendarId: string, categoryData: Record<string, any>): Promise<EventCategory>
async updateEvent(account: Account, eventId: string, eventData: CalendarEvent): Promise<CalendarEvent>
async deleteEvent(account: Account, eventId: string): Promise<void>

// Pattern: (resourceId) for lookups
async getCalendar(id: string): Promise<Calendar | null>
async getCategory(categoryId: string, calendarId?: string): Promise<EventCategory>

// Pattern: (account) for user-scoped queries
async editableCalendarsForUser(account: Account): Promise<Calendar[]>

// Pattern: (resource, options) for filtered queries
async listEvents(calendar: Calendar, options?: EventFilterOptions): Promise<CalendarEvent[]>
```

**Parameter order:**
1. `account: Account` — when the operation requires authentication/authorization
2. Resource identifiers — IDs as `string` (not full objects) when the service will look them up
3. Data payloads — the content being created or updated
4. Optional parameters — filters, options, flags

**Return types:**
- Single lookup: `Promise<Model | null>` (null when not found) or throws exception
- Creation/update: `Promise<Model>` (returns the created/updated model)
- Deletion: `Promise<void>`
- Lists: `Promise<Model[]>`

---

## Validation & Permission Checking

### Established Convention

Services perform all validation and permission checks — never in API handlers:

```typescript
async createCategory(account: Account, calendarId: string, categoryData: Record<string, any>): Promise<EventCategory> {
  // 1. Existence check
  const calendar = await this.getCalendar(calendarId);
  if (!calendar) throw new CalendarNotFoundError();

  // 2. Permission check
  const canModify = await this.userCanModifyCalendar(account, calendar);
  if (!canModify) throw new InsufficientCalendarPermissionsError();

  // 3. Business validation
  if (!categoryData.content || Object.keys(categoryData.content).length === 0) {
    throw new Error('Category must have content in at least one language');
  }

  // 4. Perform operation
  // ...
}
```

**Key points:**
- Services throw domain exceptions (never HTTP status codes)
- Existence checks happen in the service, not the handler
- Permission checks use service-level helper methods
- Validation logic is colocated with the business operation

### API Handler Responsibility

API handlers only handle HTTP concerns:

```typescript
// GOOD: Handler catches service exceptions and maps to HTTP
async createCategory(req: Request, res: Response) {
  try {
    const account = req.user as Account;
    const category = await this.service.createCategory(account, req.params.calendarId, req.body);
    res.status(201).json(category.toObject());
  } catch (e) {
    if (e instanceof CalendarNotFoundError) {
      res.status(404).json({ error: e.message, errorName: e.name });
    } else if (e instanceof InsufficientCalendarPermissionsError) {
      res.status(403).json({ error: e.message, errorName: e.name });
    } else {
      throw e;
    }
  }
}

// BAD: Handler performing existence checks
async createCategory(req: Request, res: Response) {
  const calendar = await this.service.getCalendar(req.params.calendarId);
  if (!calendar) { res.status(404)... return; }  // This belongs in the service
}
```

---

## Cross-Domain Communication

### Established Convention

Domains communicate through interfaces, never by importing another domain's services directly:

```typescript
// GOOD: Receiving another domain's interface via constructor
class CalendarService {
  constructor(
    private accountsInterface?: AccountsInterface,
    private emailInterface?: EmailInterface,
    private eventBus: EventEmitter,
  ) {}

  async someMethod() {
    // Call through the interface
    const account = await this.accountsInterface.getAccount(accountId);
  }
}

// BAD: Importing another domain's service directly
import AccountService from '@/server/accounts/service/accounts';
// Violates domain boundaries
```

**Key points:**
- Domain interfaces are injected via constructor
- Services within the same domain can reference each other directly
- Cross-domain calls always go through `{Domain}Interface`

---

## Event Bus Usage

### Established Convention

Cross-domain side effects use the shared event bus:

```typescript
// Emitting domain events
this.eventBus.emit('calendar:event:created', { event, calendar });
this.eventBus.emit('calendar:event:updated', { event, calendar });
this.eventBus.emit('calendar:event:deleted', { eventId, calendarId });

// Listening in another domain
// src/server/{other-domain}/events/handlers.ts
eventBus.on('calendar:event:created', async ({ event, calendar }) => {
  // React to the event from the other domain
});
```

**Event naming:** `{domain}:{resource}:{action}` using colon-separated segments.

**When to use event bus vs interface:**
- Use **interfaces** for synchronous cross-domain queries (getting data from another domain)
- Use **event bus** for asynchronous cross-domain side effects (notifying other domains that something happened)

**Handler location:** Event handlers must live in `{domain}/events/` directory, implementing a `DomainEventHandlers` pattern with an `install(eventBus)` method. Always use `.bind(this)` when registering handlers.

**How to check:** If a changed file emits or listens to events, verify:
1. Event names follow `{domain}:{resource}:{action}` format
2. Handlers are in the `events/` directory, not inline in services
3. Cross-domain side effects use the event bus, not direct interface calls

---

## Domain Boundary Import Rules

### Established Convention

Domains must never import directly from another domain's internal modules. The only valid cross-domain import is through the interface.

```typescript
// ✅ CORRECT — import the interface
import AccountsInterface from '@/server/accounts/interface';

// ❌ VIOLATION — importing service directly from another domain
import AccountService from '@/server/accounts/service/account';

// ❌ VIOLATION — importing entity from another domain
import { AccountEntity } from '@/server/accounts/entity/account';

// ❌ VIOLATION — importing internal types from another domain
import { AccountSettings } from '@/server/accounts/service/types';
```

**How to check:** For each file in `src/server/{domain}/`, scan its imports for references to `@/server/{other-domain}/` where the path does NOT end in `/interface` or `/interface/index`.

**Exceptions:**
- `src/server/common/` is shared infrastructure, importable by all domains
- `src/common/` (common models, exceptions) is shared across client and server
- Test files may import from other domains for test setup (but flag it as a note)
- `src/server/app.ts` wires domains together and imports everything

---

## Dependency Injection Patterns

### Established Convention

Dependencies between domains must be passed via constructor injection, never imported and instantiated directly:

```typescript
// ✅ CORRECT — dependency injected via constructor
class CalendarInterface {
  constructor(eventBus: EventEmitter, accountsInterface?: AccountsInterface) { ... }
}

// ❌ VIOLATION — importing and instantiating another domain's interface
import AccountsInterface from '@/server/accounts/interface';
const accounts = new AccountsInterface();
```

**Key rule:** `new {Domain}Interface()` calls must only appear in `src/server/app.ts`, which wires domains together. Any other file instantiating a domain interface is a violation.

---

## Known Drift

- **Optional constructor parameters**: Some services make dependencies optional with `?` for backward compatibility (`constructor(private calendarService?: CalendarService)`). Newer services should make required dependencies non-optional.
- **Mixed return patterns for lookups**: Some services return `null` for not-found, others throw `{Resource}NotFoundError`. The trend is toward throwing exceptions for operations that expect the resource to exist, and returning `null` for optional lookups.
- **Private helper method naming**: No strict convention — some use `private validateCalendarOwnership()`, others use `private userCanModifyCalendar()`. The important thing is that helpers are private and clearly named.
