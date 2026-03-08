# Complexity Principles

> Version: 1.0.0
> Last Updated: 2026-02-13

This file covers all complexity dimensions for the Pavillion project, anchored by the **solo-maintainer test**:

> **Can one person understand, debug, and modify this 6 months from now without context?**

If the answer is "probably not without re-reading a lot of surrounding code," the change is too complex.

## Related Standards

These complexity principles complement and cross-reference existing Pavillion standards:

- `backend/service-layer.md` — Services for business logic, API handlers for HTTP only
- `backend/domain-interface.md` — Facade pattern for domain public APIs
- `backend/entity-model-separation.md` — Bidirectional conversion between DB entities and domain models
- `global/conventions.md` — General development conventions

---

## Scope Creep

Features beyond what was asked for. The most common source of unnecessary complexity in a solo-maintained project.

### Threats

- **Uncontrolled growth**: Each "while we're here" addition compounds maintenance burden
- **Spec drift**: Implementation delivers more than the spec requested, making verification harder
- **Testing overhead**: Every added feature needs tests, error handling, and edge case coverage
- **Review blindness**: Extra features slip through because they seem "small" or "obvious"

### Red Flags

**In specs:**
- Sub-specs that cover functionality not mentioned in the main spec requirements
- "Nice to have" items that aren't explicitly marked as out-of-scope
- API endpoints beyond what the user stories require
- Database schema additions that serve future features, not the current spec

**In code:**
- New files or modules that weren't part of the implementation plan
- "Defensive" code for scenarios that can't happen given the current architecture
- Backwards-compatibility shims for code that hasn't been released yet
- Error handling for impossible states (e.g., checking if a required service is null when DI guarantees it)
- Comments like `// TODO: extend this for...` or `// Future:` in new code
- Adding configuration options when a hardcoded value would work

### Safe Patterns

```typescript
// GOOD: Does exactly what was asked — bulk delete events
async bulkDeleteEvents(calendarId: string, eventIds: string[]): Promise<void> {
  await EventEntity.destroy({
    where: { id: eventIds, calendar_id: calendarId }
  });
}

// SCOPE CREEP: Adding soft-delete, audit logging, and undo support
// when the spec only asked for bulk delete
async bulkDeleteEvents(calendarId: string, eventIds: string[], options?: {
  soft?: boolean,
  auditLog?: boolean,
  undoWindow?: number
}): Promise<{ deleted: string[], undoToken?: string }> {
  // ...150 lines of code for features nobody asked for
}
```

---

## YAGNI (You Aren't Gonna Need It)

Building for hypothetical future requirements instead of current needs.

### Threats

- **Premature abstraction**: Generic solutions that serve one concrete use case
- **Config proliferation**: Configurable parameters that only ever have one value
- **Dead code**: Features built "for later" that are never used and never tested
- **Cognitive overhead**: Every abstraction layer is one more thing to understand

### Red Flags

**In specs:**
- "This will allow us to easily add X in the future" without X being on the roadmap
- Plugin or extension systems for a single implementation
- Configurable behavior when only one behavior is needed
- Abstract base classes with a single concrete implementation

**In code:**
- Generic type parameters used with only one type
- Factory functions that create only one kind of object
- Strategy/plugin patterns with a single strategy
- Feature flags for one-off changes that won't be toggled
- Interfaces with a single implementation (unless required for cross-domain boundaries per `domain-interface.md`)
- Event systems for communication that could be a direct function call
- Utility functions used exactly once
- Parameters that are always passed the same value

### Safe Patterns

```typescript
// GOOD: Direct implementation for the one thing we need
async getPublicEvents(calendarId: string, filters: EventFilters): Promise<Event[]> {
  const where: any = { calendar_id: calendarId, is_public: true };
  if (filters.categoryIds?.length) {
    where.category_id = filters.categoryIds;
  }
  return EventEntity.findAll({ where });
}

// YAGNI: Abstract query builder for hypothetical future query types
class QueryBuilder<T extends Model> {
  private filters: FilterStrategy<T>[] = [];
  addFilter(strategy: FilterStrategy<T>): this { /* ... */ }
  build(): WhereOptions { /* ... */ }
}
// Used exactly once, for EventEntity, with one filter type
```

```typescript
// GOOD: Hardcoded value that works
const MAX_EVENTS_PER_PAGE = 50;

// YAGNI: Making it configurable via YAML when nobody changes it
// config/default.yaml: pagination.events.maxPerPage: 50
const MAX_EVENTS_PER_PAGE = config.get<number>('pagination.events.maxPerPage');
```

---

## Consistency

Pattern drift from established project conventions. Introducing new patterns where existing ones would work adds cognitive switching cost and maintenance burden.

> **Detailed convention standards:** For comprehensive consistency checking across APIs, data models, services, components, tests, and translations, see the `consistency-playbook` skill. The consistency standards include a Justified Divergence Framework for distinguishing accidental drift from intentional deviation.

### Why Consistency Is a Complexity Concern

Inconsistency is a complexity multiplier. Each new pattern for the same problem is one more thing to hold in your head. The solo-maintainer test applies directly: if you return to the code after 6 months and find two different ways to handle errors, two different naming schemes, or two different state management approaches, you have to understand both — doubling the cognitive load for no functional benefit.

### Quick Check

When reviewing for consistency as a complexity dimension, ask:
- Does this introduce a new pattern where an existing one would work?
- Would someone familiar with the codebase be surprised by the approach?
- Does this create a second way to do the same thing?

For detailed convention-by-convention checking, use the consistency standards or the consistency-advisor/consistency-auditor agents.

---

## Maintainability

Can a reader hold enough context in their head to understand and modify the code?

### Threats

- **Cognitive overload**: Functions that require understanding too many things at once
- **Hidden dependencies**: Side effects or implicit state that aren't obvious from function signatures
- **God objects**: Services or classes that accumulate too many responsibilities
- **Deep coupling**: Changes in one module cascade through many others

### Red Flags

**In specs:**
- A single service responsible for too many unrelated operations
- Data flows that touch more than 3 domain boundaries
- Features that require modifying 10+ files across multiple domains

**In code:**
- Functions longer than ~50 lines (including blank lines and comments)
- Nesting depth beyond 3 levels (e.g., `if` inside `for` inside `try` inside `if`)
- Service classes with more than ~10 public methods
- Functions with more than 4 parameters
- Boolean parameters that change function behavior (use separate functions instead)
- Mutable state shared between methods without clear lifecycle
- Test files that are harder to read than the code they test

### Safe Patterns

```typescript
// GOOD: Short, focused function with clear purpose
async assignCategoriesToEvents(
  calendarId: string,
  eventIds: string[],
  categoryIds: string[]
): Promise<void> {
  await this.validateCalendarOwnership(calendarId);
  await this.validateCategoriesBelongToCalendar(calendarId, categoryIds);
  await EventCategoryEntity.bulkCreate(
    eventIds.flatMap(eventId =>
      categoryIds.map(categoryId => ({ event_id: eventId, category_id: categoryId }))
    ),
    { ignoreDuplicates: true }
  );
}

// HARD TO MAINTAIN: One function that validates, assigns, notifies,
// logs, syncs federation, and updates cache — 200 lines, 5 levels deep
```

```typescript
// GOOD: Clear parameter intent
async getEvents(calendarId: string, filters: EventFilters): Promise<Event[]>

// HARD TO MAINTAIN: Boolean flags that change behavior
async getEvents(
  calendarId: string,
  includePrivate: boolean,
  includePast: boolean,
  expandRecurring: boolean,
  withCategories: boolean
): Promise<Event[]>
// Use an options/filters object instead
```

---

## Simplicity

Unnecessary indirection, over-engineered abstractions, wrapper layers that add no value.

### Threats

- **Indirection maze**: Following code through 4 layers of abstraction to find what actually happens
- **Premature generalization**: Making something generic before there's a second use case
- **Wrapper tax**: Each wrapper layer adds cognitive cost without adding functionality
- **Abstraction mismatch**: Abstractions that don't match how the code is actually used

### Red Flags

**In specs:**
- Architecture diagrams with more than 3 layers between request and database
- "Framework" or "engine" language for one-off functionality
- Separate configuration files for settings that could be constants

**In code:**
- Classes that wrap another class without adding meaningful behavior
- Adapter/wrapper patterns with only one adapted type
- Helper modules with 1-2 functions that are used in one place
- Abstract classes where the "template method" has one implementation
- Service methods that just delegate to another service method with the same signature
- Three lines of similar code refactored into an abstraction used once
- Custom event emitter systems for synchronous, in-process communication

### Safe Patterns

```typescript
// GOOD: Three similar lines are fine
const titleMatch = event.title?.toLowerCase().includes(search);
const descMatch = event.description?.toLowerCase().includes(search);
const locationMatch = event.location?.toLowerCase().includes(search);
return titleMatch || descMatch || locationMatch;

// OVER-ENGINEERED: Abstraction for something used once
const searchableFields = ['title', 'description', 'location'];
const matchesSearch = (obj: any, fields: string[], query: string) =>
  fields.some(f => obj[f]?.toLowerCase().includes(query));
return matchesSearch(event, searchableFields, search);
// Harder to read, harder to debug, used exactly once
```

```typescript
// GOOD: Direct service call
class EventRoutes {
  async deleteEvent(req: Request, res: Response) {
    await this.eventService.deleteEvent(req.params.id, req.user);
    res.status(204).send();
  }
}

// OVER-ENGINEERED: Command pattern for simple CRUD
class DeleteEventCommand implements Command {
  constructor(private eventId: string, private user: Account) {}
  async execute(service: EventService) {
    return service.deleteEvent(this.eventId, this.user);
  }
}
class CommandBus {
  async dispatch(command: Command) { /* ... */ }
}
// Four files and two abstractions for what was one line of code
```
