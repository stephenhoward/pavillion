# Service Layer Pattern

Services contain all business logic. API handlers are thin HTTP adapters. This separation allows services to be reused across contexts (HTTP, event handlers, CLI, tests).

## Service Layer (Business Logic)

```typescript
// src/server/{domain}/service/*.ts
class CalendarService {
  async createCalendar(account: Account, data: CreateCalendarData): Promise<Calendar> {
    // Validation, authorization, business rules
    if (!this.isValidUrlName(data.urlName)) {
      throw new InvalidUrlNameError('URL name must be 2-24 characters');
    }
    // Database operations, cross-domain calls
    // Returns domain models
  }
}
```

**Services must:**
- Accept primitive values or domain models as parameters
- Throw domain-specific exceptions for errors
- Return domain models
- Contain all validation and authorization logic

**Services must NOT:**
- Import or reference `Request`, `Response`, or any HTTP types
- Know about status codes, headers, or JSON serialization
- Catch exceptions to convert them to responses

## API Layer (HTTP Adapter)

```typescript
// src/server/{domain}/api/v1/*.ts
async createCalendar(req: Request, res: Response) {
  const account = req.user as Account;
  const data = { urlName: req.body.urlName, ... };

  try {
    const calendar = await this.service.createCalendar(account, data);
    res.status(201).json(calendar.toObject());
  } catch (error) {
    if (error instanceof InvalidUrlNameError) {
      res.status(400).json({ error: error.message, errorName: error.name });
    }
  }
}
```

**API handlers must:**
- Parse request parameters into simple values
- Call service methods
- Catch exceptions and map to HTTP responses
- Serialize models via `toObject()`
