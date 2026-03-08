# Express Request Handling Security

> Version: 1.0.0
> Last Updated: 2026-02-13

## Threats

- **Parameter pollution**: Unexpected array values in query/body params
- **Body size abuse**: Oversized JSON payloads causing memory exhaustion
- **UUID injection**: Non-UUID values passed where UUIDs are expected, causing DB errors or unexpected behavior
- **Type confusion**: `req.query` values are always strings; treating them as other types without conversion leads to bugs
- **Error info leakage**: Stack traces or internal details exposed in HTTP responses
- **Prototype pollution**: Malicious `__proto__` or `constructor` keys in JSON bodies

## Safe Patterns

### UUID Validation

Always validate UUID route parameters using `ExpressHelper.isValidUUID()` before passing to services:

```typescript
// src/server/common/helper/express.ts provides this utility
import { ExpressHelper } from '@/server/common/helper/express';

// In route handlers — validate before using
const calendarId = req.params.id;
if (!ExpressHelper.isValidUUID(calendarId)) {
  res.status(400).json({ error: 'Invalid calendar ID' });
  return;
}
```

### Query Parameter Type Checking

Always explicitly convert query params — they are strings by default:

```typescript
// Safe: explicit conversion
const page = parseInt(req.query.page as string) || 1;
const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

// Safe: explicit string handling
const search = typeof req.query.search === 'string' ? req.query.search : '';
```

### JSON Body Size Limits

Express JSON parsing should enforce size limits:

```typescript
app.use(express.json({ limit: '1mb' }));
```

### Error Responses

Never expose internal error details to clients:

```typescript
// Safe: domain exception with controlled message
try {
  await service.doSomething();
} catch (error) {
  if (error instanceof CalendarNotFoundError) {
    res.status(404).json({ error: error.message, errorName: error.errorName });
    return;
  }
  // Generic fallback — no stack, no internal details
  res.status(500).json({ error: 'Internal server error' });
}
```

## Vulnerable Patterns

### Unvalidated UUIDs

```typescript
// VULNERABLE: raw param passed to DB query
const calendar = await service.getCalendar(req.params.id);
// If req.params.id is "'; DROP TABLE--", Sequelize will handle it,
// but non-UUID values may cause confusing errors or unexpected behavior
```

### Error Stack Leakage

```typescript
// VULNERABLE: exposing internal error details
catch (error) {
  res.status(500).json({ error: error.message, stack: error.stack });
}

// VULNERABLE: passing unknown error message directly
catch (error) {
  res.status(500).json({ error: error.message });
  // error.message could contain DB connection strings, file paths, etc.
}
```

### parseInt Without NaN Check

```typescript
// VULNERABLE: NaN propagates to DB query
const limit = parseInt(req.query.limit as string);
// If limit is NaN, it may cause unexpected query behavior
```

### Unchecked Array-Type Query Params

```typescript
// VULNERABLE: assumes single string, but could be array
const category = req.query.category;
// A request like ?category=a&category=b produces an array
```

## Known Codebase Patterns

- `ExpressHelper.isValidUUID()` in `src/server/common/helper/express.ts` — standard UUID validation
- Error serialization uses `errorName` field — see the `backend-error-serialization` skill
- Domain exceptions extend a base exception class in `src/common/exceptions/`
- `express.json()` middleware configured in `src/server/app.ts`
