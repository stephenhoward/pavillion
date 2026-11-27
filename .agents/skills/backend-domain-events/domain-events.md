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

## Exception: Bounded Wait for a Dispatch Count

One caller keeps the event and also waits on its listeners: the ICS import, which reports how many events it could not confirm. The wait is sanctioned only in this shape:

- **Opt-in per transaction.** The operation calls `trackDispatch(tx)` (`src/server/common/helper/emit-after-tx.ts`) on its own transaction. Emissions under any other transaction go through `eventBus.emit` unchanged.
- **Awaited only after commit.** `DispatchTally.settled()` is called once, after the transaction commits; listeners never run before it.
- **Bounded.** `settled(timeoutMs)` resolves at the deadline whether or not every listener has settled. Unsettled emissions count as incomplete, and the listeners keep running.
- **An anonymous count only.** The tally yields a number of incomplete emissions. It never carries an event name, payload, listener, or per-listener or per-domain detail, and must not be extended to.
- **Never control flow.** The count is reported to the person who ran the operation. Nothing branches, retries, or rolls back on it.
- **A listener that wants to be counted returns its promise.** The tally awaits what a listener returns; a listener that fires work without returning it counts as completed when its synchronous part returns.

A tallied emission also has different failure semantics, not just a count. It dispatches through `invokeListeners`, which runs every listener and turns a synchronous throw into a logged, counted failure. `eventBus.emit` stops at the first synchronous throw and the throw escapes.

Nothing running inside a limiter slot (the slots ActivityPub's `serialize()` and `serializeLifecycle()` hand out, or a link in its SQLite `dispatchQueue`) may await another listener's promise, since that can deadlock the slot. Only `invokeListeners` awaits listener promises, and it runs outside any slot.

An interface call is not used instead because the emitter would have to know federation exists to call it, which is the coupling [DEC-003](../../../docs/decisions/dec-003-domain-driven-architecture.md) prevents. The event keeps the emitter ignorant of its listeners; the count reveals only that some did not complete.

A second caller of `trackDispatch` should prompt a DEC rather than extend this exception.

## Common Events

- `eventCreated`, `eventUpdated`, `eventDeleted` — calendar changes
- `outboxMessageAdded`, `inboxMessageAdded` — ActivityPub federation
- `subscription:created`, `subscription:cancelled` — subscription lifecycle
