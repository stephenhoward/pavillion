# Cancel Recurring Event Occurrence — UX Redesign

> Created: 2026-04-20
> Branch: feat/cancel-recurring-event-instance-pv-hi9p
> Status: Design — pending implementation

## Problem

Calendar owners can currently cancel a specific occurrence of a recurring event,
but only when the occurrence is already materialized as an `EventInstanceEntity`
row. The server materializes recurring occurrences in a rolling
`GENERATION_HORIZON_MONTHS = 6` window from "now". Occurrences beyond that
window don't exist in the database, so the UI shows them as nothing at all —
and the user sees "No upcoming instances to cancel" on recurring events whose
schedule extends further out.

This hits monthly and yearly events hardest. A yearly event one year and a day
away is invisible to the cancellations panel; a monthly event eight months out
is invisible. Both cases are real and legitimate cancellation requests (e.g.
"cancel the July 4th occurrence"; "cancel next year's annual meeting").

The *data layer* is horizon-agnostic — cancellation is stored as an
`EventScheduleEntity` with `is_exclusion=true` and a `start_date`, and
`EventInstanceService.generateInstances` already honors those exclusions when
materializing. Only the UI is horizon-coupled, because it treats the
`EventInstanceEntity` row as the unit the user interacts with.

## Goal

Decouple the cancellation UX from the materialization horizon. If a recurring
schedule extends N years into the future, the user should be able to navigate
to any future occurrence and cancel it — using the same schedule-based exclusion
data model already in place.

## Design

### Interaction model

Pure discovery. The user sees a list of upcoming occurrences and picks one to
cancel or restore. No free-form date entry — the user can only act on
occurrences the RRule actually produces, so mismatched-date mistakes are
impossible by construction.

Three navigation controls keep near-future and far-future occurrences both
reachable:

1. **Default list**: the next 10 occurrences, computed from the event's
   `RRuleSet` regardless of materialization state.
2. **"Show more" button**: appends the next 10 occurrences to the list.
3. **"Jump to month…" control**: a month/year picker. Selecting a month
   replaces the list with 10 occurrences starting from the first day of that
   month. Used to reach far-future dates in a single action rather than many
   "Show more" clicks.

Terminal states:

- Bounded recurrence (has `count` or `until`) where the list has reached the
  end: show "No further occurrences" and hide the "Show more" button.
- "Jump to month…" target where no occurrences follow: show "No occurrences
  after [month]" with a link back to "Start from today".

Existing cancellations render inline at their dates with badges
(`cancelled-shown` or `hidden`), the same as today.

### Row states

| State             | Source                                                            | Action           |
|-------------------|-------------------------------------------------------------------|------------------|
| `active`          | occurrence produced by RRuleSet, no matching exclusion row        | Cancel           |
| `cancelled-shown` | occurrence produced by RRuleSet AND matching exclusion row with `hide_from_public=false` | Restore          |
| `hidden`          | exclusion row with `hide_from_public=true` (suppressed from the set; surfaced as an informational row) | Restore          |

### Backend: new occurrences endpoint

```
GET /api/v1/events/:eventId/upcoming-occurrences?limit=10&after=<iso-date>
```

Response:

```json
{
  "occurrences": [
    { "start": "2026-05-07T18:00:00Z", "state": "active", "scheduleId": null },
    { "start": "2026-05-14T18:00:00Z", "state": "cancelled-shown", "scheduleId": "uuid-..." },
    { "start": "2026-05-21T18:00:00Z", "state": "hidden", "scheduleId": "uuid-..." }
  ],
  "hasMore": true
}
```

Parameters:

- `limit` — positive integer, max 50, default 10.
- `after` — ISO-8601 datetime; results include occurrences with `start > after`.
  If omitted, defaults to server "now".

Behavior:

- Implemented on `EventInstanceService` as
  `listUpcomingOccurrences(event, afterDate, limit)`.
- Builds an `RRuleSet` similar to the existing `rrules()` helper, with one
  important change: shown-cancellations (`is_exclusion=true,
  hide_from_public=false`) must not contribute `rdate`/`rrule` suppression
  (existing behavior) AND must not suppress the parent rule's production of
  that occurrence (existing behavior). Hidden-cancellations
  (`is_exclusion=true, hide_from_public=true`) DO suppress. The existing
  `rrules()` method already matches this contract; reuse it.
- After running `rruleSet.after(afterDate, inc=false)` in a loop to collect
  `limit + 1` occurrences, tag each with state by matching against the
  event's schedules (exclusion rows keyed by millisecond-precision
  `start_date`). The `limit + 1`th occurrence is used only to compute
  `hasMore`, then discarded.
- Hidden occurrences are also included in the output so the user can see and
  restore them. They come from the event's schedule list directly, not from
  the RRuleSet (since the set suppresses them). The service merges
  RRuleSet-produced occurrences with hidden-exclusion rows whose `start_date
  > afterDate`, sorts by start, and truncates to `limit`.
- Authorization: same calendar-editor check as `cancelInstance`. Non-editors
  get 403.
- IDOR: if the event does not exist or the account cannot edit the owning
  calendar, return 404 (match `cancelInstance` pattern — do not leak
  existence).

### Backend: cancel/restore by date

```
POST   /api/v1/events/:eventId/occurrences/cancel    { start, hideFromPublic }
DELETE /api/v1/events/:eventId/occurrences/cancel    { start }
```

Service-layer methods on `EventInstanceService`:

- `cancelOccurrenceByDate(account, eventId, startDate: DateTime, hideFromPublic: boolean): Promise<void>`
- `restoreOccurrenceByDate(account, eventId, startDate: DateTime): Promise<void>`

Implementation:

- Refactor the core "find-or-create / find-and-delete exclusion row by
  `start_date`" logic out of `cancelInstance` and `restoreInstance` into
  private helpers. The new date-based methods and the old instance-ID-based
  methods both call the helpers.
- Strict-date validation: before writing the exclusion, confirm the supplied
  `start` falls on an actual occurrence of the event's RRuleSet. Use
  `rruleSet.between(start - 1ms, start + 1ms, true)` or the existing
  `RRuleSet.before(start, inc=true)` with an equality check. Mismatched dates
  return 422 with `errorName: 'InvalidOccurrenceDateError'`. The new UI never
  hits this path (it only submits dates returned by
  `upcoming-occurrences`), but the endpoint remains honest for direct API
  callers. `InvalidOccurrenceDateError` is a new exception added to
  `@/common/exceptions/calendar`.
- Idempotency: same `(event_id, start_date, is_exclusion=true)` uniqueness
  as `cancelInstance` today. Re-cancelling with the same `hideFromPublic`
  is a no-op; re-cancelling with a different `hideFromPublic` updates the
  row in place; restore on a non-existent row is a silent no-op.
- Emits the existing `eventInstanceCancelled` / `eventInstanceRestored` bus
  events so AP outbound propagation continues to work unchanged. The
  payload's `instanceId` field becomes optional (date-based path has none).

### Backend: delete the instance-ID-based endpoints

The existing endpoints go away:

```
POST   /api/v1/events/:eventId/instances/:instanceId/cancel   — DELETE
DELETE /api/v1/events/:eventId/instances/:instanceId/cancel   — DELETE
```

Service methods `cancelInstance` / `restoreInstance` are removed along with
their integration tests. The `EventService.cancelEventInstance` /
`restoreEventInstance` client-service methods are replaced by
`cancelOccurrence(eventId, start, hideFromPublic)` /
`restoreOccurrence(eventId, start)`.

Bus event payloads: `eventInstanceCancelled` / `eventInstanceRestored` retain
their names (AP handlers subscribe to them); `instanceId` becomes an optional
field on the payload since the date-based path has no instance ID to supply.
AP handlers already rebuild the full instance set on these events and do not
rely on the ID.

Call-site audit confirms only `EventCancellationsPanel` calls these endpoints
today (via `EventService`). No other consumers.

### Frontend: rewrite `EventCancellationsPanel`

Replace the props-based `instances` input with direct fetching via a new
`EventService.listUpcomingOccurrences(eventId, after?, limit)` method.

Panel state:

```ts
const occurrences = ref<UpcomingOccurrence[]>([]);
const cursor = ref<DateTime>(DateTime.now());  // advances for "Show more"
const anchor = ref<DateTime>(DateTime.now());  // set by "Jump to month"
const hasMore = ref(true);
const loading = ref(false);
const jumpMonth = ref<string>('');             // YYYY-MM input
```

Behavior:

- On mount: fetch 10 occurrences with `after = anchor`. Update `cursor` to
  the last occurrence's `start`.
- "Show more": fetch 10 with `after = cursor`; append to list; update
  `cursor`. Hide the button when server reports `hasMore: false`.
- "Jump to month": set `anchor = DateTime.fromFormat(jumpMonth, 'yyyy-MM').startOf('month')`,
  replace `occurrences` with a fresh fetch from `anchor`, set
  `cursor = occurrences.at(-1)?.start ?? anchor` so subsequent "Show more"
  extends from the jump target correctly.
- Cancel button: opens the existing `EventCancelConfirmModal`; on confirm,
  calls `cancelOccurrence(eventId, occurrence.start, hideFromPublic)`;
  mutates the row's `state` in place to `cancelled-shown` or `hidden` on
  success. For `hidden` → that row moves out of the RRuleSet-produced list,
  so replace the row with a hidden-badge variant inline (no refetch).
- Restore button: calls `restoreOccurrence(eventId, occurrence.start)`;
  mutates the row's `state` in place to `active`.
- The "cancelled" pill on the event row (events-tab) continues to derive
  from the event's `schedules` array (per commit 5973a64) — no change
  needed there.

Props reduced from `{ event, instances }` to `{ event }`. The
`eventInstances` computed in `edit_event.vue` and its associated store-cache
read are no longer passed in — they may remain for other consumers of the
event store but are not used by this panel.

### What goes away

- `cancelInstance` / `restoreInstance` service methods
- Instance-ID-based cancel/restore API routes
- The panel's dependency on `eventInstances` (materialized cache)
- The panel's coupling to the `GENERATION_HORIZON_MONTHS = 6` materialization
  window
- The "No upcoming instances to cancel" empty state for events that do have
  recurring schedules

## Testing

### Service (`event_instance.test.ts`)

- `listUpcomingOccurrences`:
  - Weekly event: returns 10 consecutive weekly occurrences starting after
    `after`.
  - Monthly event: returns 10 consecutive monthly occurrences.
  - Yearly event: returns 10 yearly occurrences (spans 10 years).
  - Bounded recurrence (`count=5`): returns 5 occurrences, `hasMore=false`.
  - Bounded recurrence (`until=...`): returns occurrences up to `until`,
    `hasMore=false`.
  - `after` cursor: supplying the last returned occurrence's start yields
    the next 10 without overlap or gap.
  - Hidden exclusion: that date appears in the output with state `hidden`
    and a `scheduleId`, not omitted.
  - Shown exclusion: that date appears with state `cancelled-shown`.
  - Non-recurring rdate within the window: produced with state `active`.
  - Non-recurring rdate before `after`: omitted.
- `cancelOccurrenceByDate`:
  - Valid matching date: writes a new exclusion row.
  - Valid matching date, existing row with same `hideFromPublic`: no-op.
  - Valid matching date, existing row with different `hideFromPublic`: row
    flipped in place.
  - Non-matching date (e.g. event is Mondays, supply a Thursday): throws
    `InvalidOccurrenceDateError`.
  - Non-editor account: throws `InsufficientCalendarPermissionsError`.
  - Non-existent event: throws `EventNotFoundError`.
- `restoreOccurrenceByDate`:
  - Existing exclusion row: deleted.
  - No existing row: silent no-op.
  - Strict-date validation: not required for restore (restoring a
    non-occurrence is already a no-op). Skip this check to keep restore
    robust.
  - Non-editor: throws `InsufficientCalendarPermissionsError`.

### API (`cancel_event_instance.test.ts` rename → `cancel_event_occurrence.test.ts`)

- `GET /api/v1/events/:eventId/upcoming-occurrences`:
  - Happy path returns expected shape for weekly event.
  - `limit` bounds enforced (max 50).
  - `after` honored.
  - Non-editor gets 403.
  - Unknown event gets 404.
- `POST .../occurrences/cancel`:
  - Valid date cancels (default hide).
  - Valid date with `hideFromPublic: true` creates hidden exclusion.
  - Invalid date returns 422 with `errorName: InvalidOccurrenceDateError`.
  - Missing `start` returns 400.
- `DELETE .../occurrences/cancel`:
  - Existing cancellation restored.
  - No existing cancellation: 204 no-op.

### Component (`event-cancellations-panel.test.ts`, rewritten)

- On mount: calls `listUpcomingOccurrences` with `after = now`,
  `limit = 10`; renders 10 rows.
- "Show more" click: calls service with `after = last.start`; appends 10
  rows.
- "Jump to month": calls service with `after = YYYY-MM-01T00:00:00`;
  replaces rows.
- Cancel row action: opens confirm modal; on confirm calls
  `cancelOccurrence`; row state flips in place.
- Restore row action: calls `restoreOccurrence`; row state flips in place.
- `hasMore: false` from server: "Show more" hidden.
- Empty response from "Jump to month" target: shows "No occurrences after
  [month]" with "Start from today" link that resets `anchor = now`.
- Event with no recurring schedule: panel is not rendered (gated by
  `hasRecurringSchedule` in `edit_event.vue`, unchanged).

## Non-goals

- Bulk cancellation of a date range.
- Cancellation reasons / notes on exclusion rows.
- Federation of cancellation events beyond the existing AP `Update(Event)`
  flow that the bus events already drive.
- Changing `GENERATION_HORIZON_MONTHS`. This spec decouples the UI from the
  horizon; the materialization window itself is unchanged.
- A calendar grid picker for date selection. Considered and rejected as
  overkill for the current need; the list + jump-to-month covers the real
  use cases.

## Architectural notes for reviewer agents

- **Consistency with DDD boundaries**: all new logic stays in
  `calendar/service/event_instance.ts` and `calendar/api/v1/events.ts`. No
  cross-domain imports added.
- **Entity/model separation**: occurrences returned by
  `listUpcomingOccurrences` are plain DTOs
  (`{ start, state, scheduleId }`), not models or entities. Match the
  response-shape-only pattern used by other listing endpoints.
- **Service layer does validation**: strict-date check and editor-permission
  check both live in the service methods, not the API handlers.
- **API handler is thin**: parse params, call service, map exceptions to
  HTTP codes.
- **DEC-005 compliance**: occurrences are keyed by `start` (ISO datetime),
  not by any URL name. Event ID is a UUID; calendar context is implicit via
  the event's owning calendar.
- **Privacy (DEC-004)**: all new endpoints are editor-only. No public
  endpoint changes.
- **Testing**: unit + integration coverage matching existing
  `cancel_event_instance.test.ts` patterns; no new e2e tests required since
  the underlying federation path is unchanged.
