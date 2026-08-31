# Store-Service Pattern

Frontend uses three layers: Components → Services → Stores. Components always interact through services, never accessing stores directly.

## Layer Responsibilities

**Stores** (`src/client/stores/`) — State only
```typescript
export const useCalendarStore = defineStore('calendars', {
  state: () => ({ calendars: [] as Calendar[], loaded: false }),
  actions: {
    setCalendars(calendars: Calendar[]) { this.calendars = calendars; },
    addCalendar(calendar: Calendar) { this.calendars.push(calendar); },
  }
});
```

**Services** (`src/client/service/`) — API calls + store updates
```typescript
export default class CalendarService {
  private store = useCalendarStore();

  async loadCalendars(): Promise<Calendar[]> {
    const data = await fetch('/api/v1/calendars');
    const calendars = data.map(c => Calendar.fromObject(c));
    this.store.setCalendars(calendars);
    return calendars;
  }
}
```

**Components** — Use services only
```typescript
const service = new CalendarService();
await service.loadCalendars();
// Never: const store = useCalendarStore();
```

## Rules

- Components **never** import stores directly
- Services own the relationship between API calls and store updates
- Services reconstruct domain exceptions from `errorName` in responses
- Models are reconstructed via `fromObject()` after API calls

## Error Handling in Services

```typescript
catch (error) {
  if (error?.response?.data?.errorName in errorMap) {
    throw new errorMap[error.response.data.errorName]();
  }
  throw error;
}
```
