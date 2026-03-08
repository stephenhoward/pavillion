# API & Interface Consistency

> Version: 1.0.0
> Last Updated: 2026-02-21

Conventions for Express route handlers, HTTP API patterns, and domain interface classes.

## Route Registration

### Established Convention

Each domain has an API installer class and one or more route handler classes:

```typescript
// Domain API installer — src/server/{domain}/api/v1.ts
export default class CalendarAPI {
  static install(app: Application, internalAPI: CalendarInterface): void {
    app.use(express.json());

    let eventsRoutes = new EventRoutes(internalAPI);
    eventsRoutes.installHandlers(app, '/api/v1');
    let calendarRoutes = new CalendarRoutes(internalAPI);
    calendarRoutes.installHandlers(app, '/api/v1');
  }
}
```

```typescript
// Route handler class — src/server/{domain}/api/v1/{resource}.ts
export default class EventRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendars/:calendar/events', ExpressHelper.loggedInOnly, this.listEvents.bind(this));
    router.post('/events', ExpressHelper.loggedInOnly, this.createEvent.bind(this));
    router.put('/events/:id', ExpressHelper.loggedInOnly, this.updateEvent.bind(this));
    router.delete('/events/:id', ExpressHelper.loggedInOnly, this.deleteEvent.bind(this));
    app.use(routePrefix, router);
  }
}
```

**Key points:**
- Route handler classes are named `{Resource}Routes` (not `{Resource}Controller`)
- Constructor receives the domain interface, stored as `this.service`
- `installHandlers(app, routePrefix)` method registers all routes
- Handler methods are bound with `.bind(this)`
- Auth middleware (`ExpressHelper.loggedInOnly`) is applied per-route

### Known Drift

- Some public API routes use a separate `PublicCalendarRoutes` class that receives `PublicCalendarInterface` instead of `CalendarInterface`
- Widget routes use `WidgetRoutes` with a dedicated interface — this is justified (different domain, criterion 3)

---

## HTTP Verbs & Route Paths

### Established Convention

```
GET    /api/v1/calendars/:calendar/events     — List resources within parent
GET    /api/v1/events/:id                      — Get single resource
POST   /api/v1/events                          — Create resource
PUT    /api/v1/events/:id                      — Update resource
DELETE /api/v1/events/:id                      — Delete resource
POST   /api/v1/events/bulk-assign-categories   — Bulk operation (POST with descriptive path)
```

**Key points:**
- Standard CRUD uses GET/POST/PUT/DELETE
- Bulk operations use POST with a descriptive action path
- Parent-scoped listings use nested paths: `/calendars/:calendar/events`
- Resource IDs use `:id` or `:resourceId` as parameter name

### Known Drift

- Route parameters inconsistently name the calendar: some use `:calendar` (URL name), others use `:calendarId` (UUID). The established pattern uses `:calendar` for URL name lookups on list endpoints.

---

## Parameter Handling

### Established Convention

**Route parameters:**
```typescript
const calendarName = req.params.calendar;
const eventId = req.params.id;
```

**Query parameters — always type-check before using:**
```typescript
// String query param
if (req.query.search && typeof req.query.search === 'string') {
  options.search = req.query.search.trim();
}

// Array/comma-separated query param
if (req.query.categories) {
  if (typeof req.query.categories === 'string') {
    options.categories = req.query.categories.split(',').map(c => c.trim()).filter(c => c.length > 0);
  }
  else if (Array.isArray(req.query.categories)) {
    options.categories = req.query.categories.filter(c => typeof c === 'string' && c.trim().length > 0);
  }
}
```

**Body parameters — extract needed fields:**
```typescript
const { title, description, content } = req.body;
```

---

## Authentication Checks

### Established Convention

```typescript
// Authenticated routes use ExpressHelper.loggedInOnly middleware
router.get('/events', ExpressHelper.loggedInOnly, this.listEvents.bind(this));

// Inside handlers, extract account from req.user
async listEvents(req: Request, res: Response) {
  const account = req.user as Account;
  if (!account) {
    res.status(401).json({ "error": "not authenticated" });
    return;
  }
  // ... proceed with account
}
```

**Key points:**
- Middleware handles route-level auth gating
- Handlers still check `req.user` defensively and return 401 if missing
- Account is extracted as `req.user as Account`

---

## Error Response Shape

### Established Convention

```typescript
// Standard error response
res.status(400).json({
  "error": "human readable message",
  errorName: 'ValidationError',
});

// 404 pattern
res.status(404).json({
  "error": "calendar not found",
  errorName: 'CalendarNotFoundError',
});

// 401 pattern
res.status(401).json({
  "error": "not authenticated",
});
```

**Key points:**
- Always includes `"error"` field with a human-readable message
- Optionally includes `errorName` with the exception class name
- Never includes stack traces or internal details in responses
- `"error"` key uses quoted notation; `errorName` uses unquoted

### Known Drift

- Some handlers return `{ "error": "message" }` without `errorName`. This is acceptable for simple validation errors where no exception class exists.
- Some handlers catch domain exceptions and map them: `catch (e) { if (e instanceof CalendarNotFoundError) { res.status(404)... } }`. This is the preferred pattern for service-layer exceptions.

---

## Response Serialization

### Established Convention

```typescript
// Single resource
const event = await this.service.getEvent(eventId);
res.json(event.toObject());

// Collection
const events = await this.service.listEvents(calendar, options);
res.json(events.map((event) => event.toObject()));

// Augmented response (adding computed fields)
const calendarsWithRelationship = await this.service.editableCalendarsWithRoleForUser(account);
res.json(calendarsWithRelationship.map((calendarInfo) => ({
  ...calendarInfo.calendar.toObject(),
  userRelationship: calendarInfo.role,
})));
```

**Key points:**
- Always call `.toObject()` on domain models before sending to client
- Never send entity objects directly
- Augmented responses spread `.toObject()` with additional fields

---

## Domain Interface Pattern

### Established Convention

```typescript
// src/server/{domain}/interface/index.ts
export default class CalendarInterface {
  private calendarService: CalendarService;
  private eventService: EventService;

  constructor(eventBus: EventEmitter, accountsInterface?: AccountsInterface) {
    this.calendarService = new CalendarService(accountsInterface, eventBus);
    this.eventService = new EventService(eventBus);
  }

  // Delegates to service methods — thin wrapper
  async getCalendar(id: string): Promise<Calendar | null> {
    return this.calendarService.getCalendar(id);
  }
}
```

**Key points:**
- Named `{Domain}Interface`, exported as default
- Constructor receives `EventEmitter` and other domain interfaces it depends on
- Creates service instances internally — services are private
- Methods are thin delegates that forward to the appropriate service
- Cross-domain communication always goes through interfaces, never directly to services
