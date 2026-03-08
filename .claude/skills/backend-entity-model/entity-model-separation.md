# Entity/Model Separation

Strict separation between database entities and domain models with bidirectional conversion.

## Location

- **Entities:** `src/server/{domain}/entity/` — Sequelize models, snake_case properties
- **Models:** `src/common/model/` — Domain objects, camelCase properties, shared client/server

## Conversion Methods

```typescript
// Entity → Model
class CalendarEntity {
  toModel(): Calendar {
    return new Calendar(this.id, this.url_name); // snake_case → camelCase
  }
}

// Model → Entity
class CalendarEntity {
  static fromModel(calendar: Calendar): CalendarEntity {
    return CalendarEntity.build({
      id: calendar.id,
      url_name: calendar.urlName, // camelCase → snake_case
    });
  }
}
```

## Rules

- Entities handle database persistence only — no business logic
- Models contain business logic, validation, and are shared with frontend
- Property name transformation (snake_case ↔ camelCase) happens in entity layer
- Not all entities have models (e.g., join tables, internal state)
- All shared domain concepts have models in `src/common/model/`

## API Serialization

Models serialize via `toObject()` / `fromObject()` for HTTP transport:

```typescript
// API handler returns model as object
res.json(calendar.toObject());

// Frontend reconstructs model from object
const calendar = Calendar.fromObject(data);
```
