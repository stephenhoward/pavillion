# Data Model Consistency

> Version: 1.0.0
> Last Updated: 2026-02-21

Conventions for Sequelize entities, domain models, serialization, and the exception hierarchy.

## Entity Patterns

### Established Convention

```typescript
// src/server/{domain}/entity/{resource}.ts
@Table({ tableName: 'calendar' })
class CalendarEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID })
  declare account_id: string;

  @Column({ type: DataType.STRING })
  declare url_name: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare widget_allowed_domain: string | null;

  @BelongsTo(() => AccountEntity, 'account_id')
  declare account: AccountEntity;

  @HasMany(() => EventContentEntity)
  declare content: EventContentEntity[];

  toModel(): Calendar {
    let calendar = new Calendar(this.id, this.url_name);
    calendar.languages = this.languages ? this.languages.split(',') : [];
    return calendar;
  }

  static fromModel(calendar: Calendar): CalendarEntity {
    return CalendarEntity.build({
      id: calendar.id,
      url_name: calendar.urlName,
      languages: calendar.languages.join(','),
    });
  }
}
```

**Key points:**
- Class name: `{Resource}Entity` (PascalCase with `Entity` suffix)
- `@Table({ tableName: 'resource_name' })` — snake_case table name
- Properties use `declare` keyword
- Property names match database columns: **snake_case** (`url_name`, `calendar_id`, `event_source_url`)
- `@PrimaryKey` + `@Column({ type: DataType.UUID })` for IDs
- Foreign keys use `@ForeignKey(() => RelatedEntity)` decorator
- Nullable columns use `allowNull: true` and `| null` type union
- Associations use `@BelongsTo`, `@HasMany`, `@HasOne` decorators
- Programmatic associations (to avoid circular imports) are documented with comments

### toModel() / fromModel()

Every entity has these two conversion methods:

- **`toModel(): DomainModel`** — Instance method that converts an entity to its domain model. Handles data transformation (e.g., comma-separated strings to arrays). Populates nested models from loaded associations.
- **`static fromModel(model: DomainModel): Entity`** — Static method that creates an entity from a domain model. Uses `Entity.build({...})` (not `Entity.create()` — the caller decides when to save).

### Known Drift

- Some entities have a `toModel()` that conditionally populates nested content only if the association was loaded (`if (this.content && this.content.length > 0)`). This is the correct pattern — don't assume associations are always eager-loaded.
- Circular dependency avoidance: Some associations are defined programmatically after model registration rather than via decorators. These are documented with `declare` and a comment explaining why.

---

## Domain Model Patterns

### Established Convention

```typescript
// src/common/model/{resource}.ts

// Simple model
class Calendar extends TranslatedModel<CalendarContent> {
  urlName: string = '';
  languages: string[] = ['en'];

  constructor(id?: string, urlName?: string) {
    super(id);
    this.urlName = urlName ?? '';
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      urlName: this.urlName,
      languages: this.languages,
    };
  }

  static fromObject(obj: Record<string, any>): Calendar {
    let calendar = new Calendar(obj.id, obj.urlName);
    calendar.languages = obj.languages;
    return calendar;
  }
}
```

**Key points:**
- Class name: PascalCase, no suffix (`Calendar`, `CalendarEvent`, `EventCategory`)
- Model properties use **camelCase** (`urlName`, `calendarId`, `eventSourceUrl`)
- Located in `src/common/model/` — shared between frontend and backend
- Extends `PrimaryModel` (with `id`) or `TranslatedModel<T>` (with multilingual content)
- No database imports — models are pure domain objects
- No business logic beyond data transformation and validation

### toObject() / fromObject()

Every model has these two serialization methods:

- **`toObject(): Record<string, any>`** — Converts to a plain object for JSON serialization. Property names use **camelCase**.
- **`static fromObject(obj: Record<string, any>): Model`** — Creates a model instance from a plain object. Used for deserialization from API responses.

### Property Casing Summary

| Layer | Casing | Example |
|-------|--------|---------|
| Database columns | snake_case | `url_name`, `calendar_id` |
| Entity properties | snake_case (match DB) | `this.url_name`, `this.calendar_id` |
| Model properties | camelCase | `this.urlName`, `this.calendarId` |
| API responses (toObject) | camelCase | `{ urlName, calendarId }` |
| API request bodies | camelCase | `{ urlName, calendarId }` |

The `toModel()` / `fromModel()` methods are where the casing conversion happens.

---

## TranslatedModel Pattern

### Established Convention

```typescript
// Model with multilingual content
class EventCategory extends TranslatedModel<EventCategoryContent> {
  _content: Record<string, EventCategoryContent> = {};

  constructor(id: string, public calendarId: string) {
    super(id);
  }

  protected createContent(language: string): EventCategoryContent {
    return new EventCategoryContent(language);
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      calendarId: this.calendarId,
      content: Object.fromEntries(
        Object.entries(this._content)
          .map(([language, content]) => [language, content.toObject()]),
      ),
    };
  }

  static fromObject(obj: Record<string, any>): EventCategory {
    const category = new EventCategory(obj.id, obj.calendarId);
    if (obj.content) {
      for (const [language, contentObj] of Object.entries(obj.content)) {
        const content = EventCategoryContent.fromObject(contentObj as Record<string, any>);
        category.addContent(content);
      }
    }
    return category;
  }
}
```

**Key points:**
- Extends `TranslatedModel<ContentType>`
- Declares `_content: Record<string, ContentType> = {}`
- Implements `createContent(language)` for lazy content initialization
- Content is accessed via `model.content('en')` — creates on demand
- Content is added via `model.addContent(contentInstance)`
- `toObject()` serializes content as `{ content: { en: {...}, fr: {...} } }`
- `fromObject()` deserializes each language's content

---

## Exception Hierarchy

### Established Convention

```typescript
// src/common/exceptions/{domain}.ts
export class CalendarNotFoundError extends Error {
  constructor(message: string = 'Calendar not found') {
    super(message);
    this.name = 'CalendarNotFoundError';
    Object.setPrototypeOf(this, CalendarNotFoundError.prototype);
  }
}
```

**Key points:**
- Class name: `{Description}Error` (PascalCase, ends with `Error`)
- Extends `Error` (not a custom base class)
- Constructor has a default message
- Sets `this.name` to match the class name exactly
- Calls `Object.setPrototypeOf()` to maintain `instanceof` support
- Located in `src/common/exceptions/{domain}.ts`
- One file per domain containing all that domain's exceptions
- JSDoc comment on each exception class

### Naming Patterns

Exceptions follow predictable naming:

| Pattern | Examples |
|---------|----------|
| `{Resource}NotFoundError` | `CalendarNotFoundError`, `EventNotFoundError`, `CategoryNotFoundError` |
| `{Resource}{Operation}Error` | `CategoryUpdateFailedError`, `CategoryAlreadyAssignedError` |
| `Insufficient{Resource}PermissionsError` | `InsufficientCalendarPermissionsError` |
| `Invalid{Field}Error` | `InvalidUrlNameError` |
| `{Field}AlreadyExistsError` | `UrlNameAlreadyExistsError` |
| `{Constraint}Error` | `MixedCalendarEventsError`, `CategoryEventCalendarMismatchError` |

### Extended Exceptions

Some exceptions carry additional data beyond the message:

```typescript
export class LocationValidationError extends Error {
  public errors: string[];

  constructor(errors: string[]) {
    super(errors.join('; '));
    this.name = 'LocationValidationError';
    this.errors = errors;
    Object.setPrototypeOf(this, LocationValidationError.prototype);
  }
}
```

This is acceptable when the handler needs structured error data (e.g., multiple validation failures).

---

## Known Drift

- **Entity file naming**: Most entities use the resource name (`calendar.ts`, `event.ts`) but some use compound names (`event_category.ts`, `event_category_assignment.ts`). Both are acceptable — the key is that the filename matches the table/resource name in snake_case.
- **Model constructor signatures**: Some models accept positional parameters (`new Calendar(id, urlName)`) while others use only `id` and set properties afterward. The pattern is moving toward positional for required fields, property assignment for optional ones.
