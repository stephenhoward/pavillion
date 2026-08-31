# Domain Event Handlers

Events are one of two ways domains communicate (the other being interface calls). Use events for async/decoupled activities where the caller doesn't need to wait for or know about handlers.

## Structure

```typescript
// src/server/{domain}/events/index.ts
import { DomainEventHandlers } from '@/server/common/events';

export default class CalendarEventHandlers implements DomainEventHandlers {
  constructor(private calendarInterface: CalendarInterface) {}

  install(eventBus: EventEmitter): void {
    eventBus.on('mediaAttachedToEvent', this.handleMediaAttached.bind(this));
    eventBus.on('subscription:created', this.handleSubscription.bind(this));
  }

  private handleMediaAttached(payload: { eventId: string; mediaId: string }) {
    // Handle the event
  }
}
```

## Rules

- One event handlers class per domain in `{domain}/events/index.ts`
- Implements `DomainEventHandlers` interface with `install(eventBus)` method
- Always use `.bind(this)` when registering handlers
- Event names: `verbNoun` for domain-internal, `domain:action` for cross-domain
- Payloads are plain objects with typed properties

## When to Use Events vs Interface Calls

| Use Events | Use Interface Calls |
|------------|--------------------|
| Caller doesn't need response | Caller needs the result |
| Multiple domains might react | Single target domain |
| Side effects (notifications, logging) | Core business logic |
| Async processing acceptable | Synchronous required |

## Common Events

- `eventCreated`, `eventUpdated`, `eventDeleted` — calendar changes
- `outboxMessageAdded`, `inboxMessageAdded` — ActivityPub federation
- `subscription:created`, `subscription:cancelled` — subscription lifecycle
