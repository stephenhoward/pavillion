# Unpost Control for Reposted Events

> Date: 2026-04-11
> Status: Approved (design)

## Problem

Calendar owners have no way to remove a reposted event from their own calendar
after the fact. The gap appears in two places:

1. **Calendar event list** (`events-tab.vue`): reposted events render inline
   with a "repost" badge and offer only Edit / Duplicate / Report actions. No
   unpost action exists, regardless of whether the event was manually reposted
   or auto-reposted.
2. **Feed view** (`feed/events.vue`): manually reposted events show a clickable
   "Reposted" label that calls `handleUnrepost`. Auto-reposted events render a
   non-clickable `<span class="auto-posted-label">`, so there is no path to
   unshare an auto-reposted event from the feed either.

The backend can already unshare — `memberService.unshareEvent()` destroys the
`SharedEventEntity`, emits an `Undo Announce`, and fires an `eventUnreposted`
domain event. The frontend just never invokes it for auto-reposted events, and
the calendar list view never invokes it at all.

There is a second, subtler problem: because the auto-repost handler in
`inbox.ts` only skips when a `SharedEventEntity` currently exists for the
`(event_id, calendar_id)` pair, a naive unshare would be fragile — if the
source calendar re-broadcasts or updates the event, the dismissed event would
re-auto-post. Owners would have to unpost repeatedly, and the control would
feel broken.

## Goals

- Give calendar owners a one-click, post-hoc way to remove a reposted event
  from their calendar, from either the calendar event list or the feed.
- Make the removal sticky: once dismissed, the event does not silently
  re-auto-post when the source calendar re-broadcasts or updates it.
- Preserve the existing federation behavior: an `Undo Announce` is emitted
  and Update activities for the underlying event continue to process normally
  so other consumers stay in sync.
- Keep the unpost affordance visually and semantically distinct from destructive
  delete — unposting a share is reversible by re-sharing; deleting an owned
  event is not.

## Non-goals

- Changing how owned events are deleted. The existing bulk delete flow for
  owned events stays as-is.
- Bulk unpost. Row-level unpost only for v1; we can add bulk later if needed.
- Blocking future Update activities. The dismissal only gates creation of a
  new `SharedEventEntity` for the dismissing calendar. The underlying event
  continues to sync so any other calendar still sharing it stays current.

## Design

### Data model

A new entity and table:

**`RepostDismissalEntity`** (`ap_repost_dismissal`)

| Column         | Type      | Notes                                       |
|----------------|-----------|---------------------------------------------|
| `id`           | UUID PK   |                                             |
| `event_id`     | UUID      | References the local `event` row            |
| `calendar_id`  | UUID      | The calendar that dismissed the repost      |
| `dismissed_at` | TIMESTAMP |                                             |

Unique index on `(event_id, calendar_id)`.

A row here means "calendar X has explicitly said this event should not appear
on its calendar via auto-repost." It gates only auto-repost creation. Manual
re-shares by the owner supersede the dismissal — see the service changes
below.

### Backend service changes

**`memberService.unshareEvent()`** (`src/server/activitypub/service/members.ts`)

For each `SharedEventEntity` the method destroys, upsert a
`RepostDismissalEntity` row for `(event_id, calendar_id)` in the same
transaction. Continue emitting the `Undo Announce` to the outbox and the
`eventUnreposted` domain event exactly as today.

**`memberService.shareEvent()`** (`src/server/activitypub/service/members.ts`)

Before creating a new `SharedEventEntity`, delete any existing
`RepostDismissalEntity` row for `(event_id, calendar_id)`. A manual share is
an explicit opt-in that supersedes any prior dismissal.

**`inboxService.handleAnnounceAutoRepost()`** (`src/server/activitypub/service/inbox.ts`)

Add a dismissal check immediately before the existing duplicate-share guard
(around line 888). If a `RepostDismissalEntity` exists for
`(event_id, calendar_id)`, log a skip reason ("previously dismissed by calendar
owner") and return without creating a `SharedEventEntity` or writing to the
outbox. Update activities that modify the underlying `EventEntity` are
unaffected — only the re-share step is gated.

**`calendarEventsService.listEvents()`** (`src/server/calendar/service/events.ts`)

Replace the plain `isRepost: boolean` assignment (currently line 207) with a
`repostStatus: 'none' | 'manual' | 'auto'` field derived by joining against
`SharedEventEntity.auto_posted`. This mirrors what the feed service already
computes (`members.ts:695`) and keeps the two surfaces consistent. Keep
`isRepost` as a derived getter (`repostStatus !== 'none'`) on the
`CalendarEvent` model so existing call sites keep working without churn.

### API

No new endpoints. The existing
`DELETE /api/v1/social/shares/:eventId?calendarId=...` is the correct entry
point and will automatically gain the dismissal behavior via the service
change above.

### Frontend

**Common model** (`src/common/model/event.ts`)

Add an optional `repostStatus: 'none' | 'manual' | 'auto'` field to the
`CalendarEvent` model's serialization. Keep `isRepost` as a computed getter
derived from `repostStatus` so existing templates continue to work.

**Calendar event list** (`src/client/components/logged_in/calendar-content/events-tab.vue`)

Add a new row-level icon button — `Link2Off` from lucide — between the
Duplicate and Report buttons. It renders only when
`event.repostStatus !== 'none'`.

Clicking the button opens a lightweight confirmation modal:

> **Remove this reposted event from your calendar?**
> It will not be automatically reposted again if the original calendar
> re-broadcasts it.

On confirm, call a new `calendarService.unshareReposted(calendarId, eventId)`
wrapper that hits
`DELETE /api/v1/social/shares/:eventId?calendarId=...`. On success, remove the
event from the local events store and show a success toast. On failure, show
an error toast and leave the row in place.

**Feed view** (`src/client/components/logged_in/feed/events.vue`)

Convert the `<span class="auto-posted-label">` element (around line 343) to a
`<button>` with the same `handleUnrepost(event.id)` handler used by the manual
case. Give it a distinct aria-label key (`unrepost_auto_aria_label`) so assistive
tech announces the action accurately. Visual styling stays close to the current
label, with a hover state added to signal interactivity.

### i18n keys

Add to the client translation files:

- `events-tab.unpost_button_label`
- `events-tab.unpost_aria_label`
- `events-tab.unpost_confirm_title`
- `events-tab.unpost_confirm_body`
- `events-tab.unpost_confirm_action`
- `events-tab.unpost_success_toast`
- `events-tab.unpost_error_toast`
- `feed.events.unrepost_auto_aria_label`

## Testing

### Unit (backend)

- `unshareEvent` creates a `RepostDismissalEntity` row and leaves one behind
  after the `SharedEventEntity` is destroyed.
- `shareEvent` deletes any existing dismissal for the same
  `(event_id, calendar_id)` before creating the new share.
- `handleAnnounceAutoRepost` skips when a dismissal exists, creates no
  `SharedEventEntity`, and writes nothing to the outbox. A matching log line
  is emitted for observability.
- `listEvents` sets `repostStatus` correctly for owned, manually-reposted, and
  auto-reposted events.

### Component (frontend)

- `events-tab.vue`: the unpost button renders only when
  `event.repostStatus !== 'none'`. Clicking opens the confirm modal. Confirming
  calls `calendarService.unshareReposted` with the expected args. The store is
  updated on success. A server error shows the error toast and leaves the row
  in place.
- `feed/events.vue`: the auto-posted label renders as a button, is keyboard
  focusable, and triggers `handleUnrepost` on click. Existing manual-repost
  click behavior is unchanged.

### Integration / E2E

One high-value E2E scenario: calendar A follows calendar B with auto-repost
enabled. B posts event X. A auto-reposts it. A unposts X from the calendar
event list. B then re-broadcasts X. A does not re-receive it as a
`SharedEventEntity`, and the event does not reappear in A's calendar list.

## Risks and open questions

- **Dismissal cleanup.** If the underlying event is deleted upstream, we
  should not leave orphaned `RepostDismissalEntity` rows. Either add an
  `ON DELETE CASCADE` on `event_id`, or have the existing event-delete handler
  clean up dismissals alongside other dependent rows. The migration should set
  this up from the start.
- **Event lookup semantics.** `memberService.unshareEvent()` currently resolves
  the incoming event URL to a UUID via `EventObjectEntity`. The dismissal write
  needs to use the same resolved UUID so it lines up with the inbox handler's
  dismissal check (which queries by `event_id` UUID).
- **Visibility of dismissed events.** For v1 we do not expose a "view dismissed
  reposts" surface. If owners ever want to see what they've dismissed, that is
  a follow-up feature — the data will be there when we need it.
