# Domain Interface Pattern

Each domain exposes a single "interface" class as its public API. Despite the name, these are **concrete classes**, not TypeScript interfaces.

## Structure

```typescript
// src/server/{domain}/interface/index.ts
export default class CalendarInterface {
  private calendarService: CalendarService;
  private eventService: EventService;

  constructor(eventBus: EventEmitter, accountsInterface?: AccountsInterface) {
    this.calendarService = new CalendarService(eventBus);
    this.eventService = new EventService(eventBus);
  }

  // Public methods only - curated API surface
  async getCalendar(id: string): Promise<Calendar> { ... }
}
```

## Rules

- One interface class per domain in `{domain}/interface/index.ts`
- Services instantiated inside constructor, never exposed
- Cross-domain dependencies passed via constructor
- This is the **only** export other domains should use
- Name signals "this is how you interact with this domain"

## Cross-Domain Usage

```typescript
// Correct - use the interface
const calendar = await calendarInterface.getCalendar(id);

// Wrong - never import services directly from another domain
import CalendarService from '@/server/calendar/service/calendar';
```
