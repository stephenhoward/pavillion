# Public Event Instance URL: Timestamp Slug

> Created: 2026-04-22
> Status: Design
> Scope: Public site + embeddable widget

## Problem

Public URLs for specific event occurrences currently use the instance UUID:

```
/view/:calendar/events/:event/:instance     ← instance = UUID
/api/public/v1/instances/:id                ← lookup by UUID
```

Instances are materialized from an event's RRuleSet for a rolling window. When the window is re-expanded (schedule edit, pruning, rebuild), row IDs can change even when the underlying occurrence date does not. Any externally shared or bookmarked URL keyed on UUID is therefore fragile across materialization changes.

The widget has a separate but related problem: its route `/widget/:urlName/events/:eventId` ignores instance identity entirely. Clicking two different occurrences of the same recurring event in the widget lands on the same event-detail overlay with no indication of which date was picked.

## Goal

Replace the UUID in public instance URLs with a stable, minute-precision UTC timestamp slug (`yyyymmdd-hhmm`) derived from the occurrence's start time. Instances become addressable by their actual schedule-defined identity rather than by an internal materialization artifact. The widget gains an optional matching segment so it can deep-link to occurrences.

Scope is (a) public URL durability only. ActivityPub object identity and `EventInstanceEntity.id` itself are out of scope.

## Non-Goals

- **ActivityPub identity.** AP surfaces the event as the object, not the instance; no AP-visible URLs change.
- **Backward-compatible UUID URLs.** Pre-launch posture (DEC-006): old URLs stop working cleanly with no redirect.
- **Authenticated client surfaces.** The `/view/` and `/widget/` namespaces are the public surface. Authenticated calendar-editing views keep UUIDs internally.
- **Cancellation audit/undo UI.** Already a separate backlog item.

## Design

### 1. Slug format

Minute-precision UTC timestamp: `yyyymmdd-hhmm`, regex `^\d{8}-\d{4}$`.

Example: `2026-05-01T18:30:00Z` → `20260501-1830`.

**UTC over event-local time**: unambiguous, DST-safe, matches the stored column (`start_time` is UTC). URL timestamps are machine identifiers; the page itself renders the time in the event's display timezone.

### 2. Shared parsing utility

New module `src/common/utils/instance-slug.ts` usable by both frontend and backend:

```ts
export function formatInstanceSlug(start: DateTime): string      // DateTime → "yyyymmdd-hhmm" (UTC)
export function parseInstanceSlug(slug: string): DateTime | null // slug → UTC DateTime, null on malformed/semantic-invalid
```

`parseInstanceSlug` validates:
- **Structural** (regex): `^\d{8}-\d{4}$`
- **Semantic** (Luxon `isValid`): month 01–12, day 01–31 (honoring month length and leap years), hour 00–23, minute 00–59
- **Year bounds**: year must be within `[currentYear − 5, currentYear + 10]` (rationale below)

The year bound is a defense-in-depth guard against very-distant timestamps being forwarded to `rrule.between`, which otherwise walks the entire occurrence series between `dtstart` and the probe point. `currentYear + 10` is well beyond any legitimate bookmarked occurrence; `currentYear − 5` accommodates historical bookmarks without being unbounded. Router regex catches most structural garbage before it reaches the service; semantic + bounds validation catches values that pass the structural regex but are not real or plausible timestamps.

### 3. Server lookup — `findOrMaterializeInstanceWithDetails`

New method on `EventInstanceService`:

```ts
async findOrMaterializeInstanceWithDetails(
  eventId: string,
  startTime: DateTime,
): Promise<CalendarEventInstance | null>
```

Flow:

1. **Single eager-load attempt** on `EventInstanceEntity` by `(event_id, start_time)`, including all associations the public detail page needs (same include shape as the existing `getEventInstanceWithDetails`). Hit → hydrate via a shared `hydrateInstanceEntity(entity)` helper and return. This helper is extracted from the existing `getEventInstanceWithDetails` body so both methods share one hydration path — no parallel implementations.
2. Miss → load the event (with schedules eager-loaded, plus the same detail-page associations so the cancellation branch does not need a second fetch). Event missing → return `null`.
3. **Pre-flight schedule guard.** Before calling into rrule, reject the request if:
   - The requested `startTime` year is outside `[currentYear − 5, currentYear + 10]` (slug-level check, duplicated server-side as defense-in-depth against a malicious client bypassing `parseInstanceSlug`), OR
   - The requested `startTime` is beyond `GENERATION_HORIZON_MONTHS + 12` from `dtstart` for an unbounded recurring schedule (no `UNTIL`, no `COUNT`)
   Either case returns `null`. Prevents an attacker from probing years-distant timestamps against a DAILY schedule with no bound.
4. Call existing `assertDateMatchesOccurrence(event, startTime)`. Throws `InvalidOccurrenceDateError` → return `null`.
5. Check exclusion rows for `(event_id, startTime)`:
   - `cancelled-hidden` (`is_exclusion=true`, `hide_from_public=true`) → return `null` (treat as 404)
   - `cancelled-shown` (`is_exclusion=true`, `hide_from_public=false`) → build an in-memory `CalendarEventInstance` flagged cancelled from the already-loaded entity, **do not persist**
6. Otherwise build `EventInstanceEntity`, save it. On `SequelizeUniqueConstraintError`, re-read via the same eager-load path and return that row (race loser).

**Duration derivation.** Occurrence `end_time` is derived by applying the duration of the event's first non-exclusion schedule (matching `generateInstances` semantics). The duration computation is extracted from `generateInstances` into a single private helper called by both paths — no duplication. If the schedule has no configured `event_end_time`, the occurrence's `end_time` is `null`.

**Materialization cap.** To bound the total work any single event's history can produce, the materialize path also refuses to persist a new row if the event already has `MATERIALIZATION_CAP` persisted instances (default: 1000). Cancelled-shown and cancelled-hidden paths are unaffected because they do not persist.

**Concurrency.** Two simultaneous requests for the same uncached instance could both reach step 6. A unique DB constraint on `(event_id, start_time)` enforces at most one row; the loser catches the unique-violation error and re-fetches via the same eager-load helper used for the cache-hit path.

### 4. Public API

- **Remove**: `GET /api/public/v1/instances/:id`
- **Add**: `GET /api/public/v1/events/:eventId/instances/:startTime`

**Handler responsibilities (in order):**
1. Rate-limit the request via a new `publicEventInstanceByIp` IP limiter (defined in `src/server/common/middleware/rate-limiters.ts` alongside `publicWidgetByIp`). Suggested defaults: 120 req / 15 min / IP, configurable via `rateLimit.publicEventInstance.byIp.max` / `.windowMs`.
2. Validate `:eventId` via `ExpressHelper.isValidUUID(eventId)`. Invalid → 404 (not 400, to avoid distinguishing nonexistent from malformed).
3. Parse `:startTime` via `parseInstanceSlug`. Invalid → 404.
4. Call `getInstanceByStartTime(eventId, startTime)`.
5. On hit, build the response body from an explicit allow-list: `{ id, start, end, isCancelled, event: toPublicEventObject(event) }`. Do not spread `instance.toObject()` at the top level — a new `toPublicInstanceObject(instance)` helper in `src/server/public/api/v1/calendar.ts` (or colocated) enforces the allow-list so future additions to `CalendarEventInstance.toObject()` cannot silently leak through the public surface. 404 otherwise.

Pre-launch, no redirect from the old route.

**Timing note.** The 404 responses for "nonexistent event" vs "nonexistent occurrence" vs "hidden-cancelled" vary by a small number of DB queries and (in the no-cache case) an rrule call. A latency-measuring attacker can in principle distinguish them. Accepted risk: event existence is already public knowledge via listings, and hidden-cancellation existence is not considered a confidential signal worth normalizing (which would impose a constant-cost floor on every 404). This decision is documented here so future review can revisit it if the threat model changes.

### 5. Site routing

`src/site/app.ts`:

```ts
{ path: '/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})',
  component: EventInstanceView, name: 'instance' }
// plus locale-prefixed variant
```

Router regex constraint makes non-matching paths 404 at the router level.

**Component** (`src/site/components/event-instance.vue:24`): replace `const instanceId = route.params.instance` with `const startTime = parseInstanceSlug(route.params.startTime as string)` and pass `(eventId, startTime)` to the service.

**Service** (`src/site/service/calendar.ts`): `getEventInstance(id)` → `getEventInstance(eventId, startTime)` pointing at the new endpoint.

**Link generation** (all sites that currently build instance URLs from `instance.id`):
- `src/site/components/calendar.vue:175`
- `src/site/components/event-card.vue`
- OG meta tags / sharing helpers that emit instance URLs (grep during implementation)
- Sitemap generator (grep; update if it emits instance URLs)

All switch to `formatInstanceSlug(instance.start)`.

### 6. Widget routing & overlay

`src/widget/router.ts`:

```ts
{ path: '/widget/:urlName/events/:eventId/:startTime(\\d{8}-\\d{4})?',
  name: 'widget-event-detail',
  component: EventDetailOverlay, ... }
```

The `?` keeps the segment optional so callers without occurrence context still work.

**Navigation** (`src/widget/components/month-view.vue:138`, `week-view.vue:81`):

```ts
const openEvent = (instance: any) => {
  router.push({
    name: 'widget-event-detail',
    params: {
      urlName: widgetStore.calendarUrlName!,
      eventId: instance.event.id,
      startTime: formatInstanceSlug(instance.start),
    },
  });
};
```

**Overlay** (`event-detail-overlay.vue`): branch on presence of `startTime`:
- Present → fetch instance via `/events/:eventId/instances/:startTime`, display occurrence-specific start/end
- Absent → fall back to existing event-only fetch
- Cancelled-shown → render with a "cancelled" affordance matching the site's existing treatment

If the widget has a public store that fetches instance data, its method gets the same `(eventId, startTime)` signature. If it currently only fetches events, add an instance fetch parallel to it.

### 7. Edge cases & guardrails

- **Minute-truncation invariant.** Event create/edit paths must truncate `start_time` to minute precision so equality lookups against minute-precision slugs always hit. Verify during implementation; truncate at generation time if RRule inherits sub-minute precision from `dtstart`. Integration test: create event with seconds-precision start, verify stored row is minute-truncated.
- **Semantic slug validation.** Router regex catches structural garbage; `parseInstanceSlug` catches values that pass regex but aren't real dates (e.g. `20261301-2500`) or are outside the plausible year range.
- **`:eventId` validation.** Handler calls `ExpressHelper.isValidUUID(eventId)` before any service call and 404s on failure — matches the pattern already established in `src/server/calendar/api/v1/events.ts`.
- **Response shaping allow-list.** `toPublicInstanceObject` (new helper) enforces an explicit field list rather than spreading `toObject()`. Analogous to `toPublicEventObject`.
- **Unique constraint.** Add a migration creating a unique index on `(event_id, start_time)` if not already present. Enforces the data-model invariant that was always implicit and protects the materialize race.
- **Migration idempotency.** Because the project already uses `createTableIfNotExists` / `addColumnIfNotExists` patterns, this spec also requires adding an `addIndexIfNotExists` helper to `src/server/common/migrations/helpers.ts` and using it here. Fills a gap in the helpers module.
- **RRule edit after bookmark.** If a calendar owner narrows the RRule so a bookmarked occurrence is no longer produced and its row still exists, the URL continues to resolve (the cache-hit path short-circuits before RRule validation). If the row doesn't exist, the RRule validation 404s it. That's correct — the occurrence genuinely no longer exists.
- **Race.** Concurrent materialize calls: unique constraint makes one succeed; loser re-fetches via the same hydration helper used for cache hits.
- **Meta-tags path segment length.** `parseEventPageParams` caps `calendarUrlName` (max 64 chars, matching `calendar.url_name`'s column constraint) and `eventId` (must match UUID regex after capture) before returning a result. Prevents arbitrarily long segments from reaching DB lookups.
- **Legacy UUID OG meta behavior.** A request path containing a legacy UUID instance segment fails the new regex and `parseEventPageParams` returns `null`, producing a page with no OG meta (not a 500, not a 404 from the meta-tags layer). Accepted pre-launch because no UUID-based instance URLs have been publicly shared.

## Testing

### Unit

`src/common/test/utils/instance-slug.test.ts`:
- `formatInstanceSlug` round-trips through `parseInstanceSlug`
- Semantic validation rejects bad month/day/hour/minute
- Structural validation rejects missing dash, wrong segment lengths, non-digits
- Year-bounds rejection: e.g. `00010101-0000`, `99991231-2359`, and a year > `currentYear + 10`

`src/server/calendar/test/service/event_instance.test.ts` — `findOrMaterializeInstanceWithDetails` describe block:
- Cache hit → returns existing, no RRule call
- **Cache hit with RRule-that-no-longer-matches** → returns existing row (short-circuit before `assertDateMatchesOccurrence`); stub the RRule call to throw and assert it's never invoked on the hit path
- Cache miss + valid RRule occurrence → materializes, saves, subsequent call hits cache
- Cache miss + invalid date → returns null
- Cache miss + cancelled-hidden → returns null, no row persisted
- Cache miss + cancelled-shown → returns cancelled in-memory model, no row persisted
- Cache miss + pre-flight guard triggered (unbounded DAILY schedule, timestamp > horizon) → returns null without calling rrule
- Cache miss + materialization cap exceeded → returns null
- Missing event → returns null
- Cache miss + schedule with no `event_end_time` → returned instance has `end = null`

### Integration

Public API (`src/server/public/test/`):
- `GET /events/:eventId/instances/:startTime` happy path
- 404 on malformed slug
- 404 on well-formed UUID `:eventId` that does not exist
- 404 on non-UUID `:eventId` (e.g. `../secret`)
- 404 on structurally-valid slug that doesn't match an occurrence
- 404 on cancelled-hidden
- 200 with cancelled flag on cancelled-shown
- 200 with `end: null` for an event with no configured duration
- Materialize-on-miss observable: call once with uncached valid slug, verify row exists afterward
- **Concurrent-miss race**: two parallel requests for the same uncached valid slug → both return 200 with the same instance id, exactly one row exists in the DB afterward (this exercises the real unique-constraint branch end-to-end, not a stubbed version)
- Rate limiter: N+1 requests from the same IP within the window return 429 (wire to the configured limit)
- Response allow-list: verify the JSON body has exactly `{id, start, end, isCancelled, event}` at the top level and no extra fields leak

### Meta-tags (`src/server/common/helper/test/meta-tags.test.ts`)

- `parseEventPageParams` accepts slug; rejects legacy UUID segment; rejects over-long calendar name; locale-prefix variant
- `buildMetaTagsInternal` canonical URL shape — one test each for the instance path (`/view/X/events/Y/20260508-1800`) and the non-instance path (`/view/X/events/Y`). Verify the `og:url`/`url` output matches the expected shape.

### Frontend unit

- `event-instance.vue` reads `startTime` from route, calls service with `(eventId, startTime)`, renders data
- `event-card.vue` / `calendar.vue` generate links via `formatInstanceSlug(instance.start)`
- Widget `openEvent` pushes route with `startTime`
- Widget overlay branches correctly on `startTime` presence/absence
- **Widget overlay: slug present but semantically invalid** (e.g. `20261301-2500`) → shows not-found state; neither `loadEventInstance` nor `loadCalendarEvents` is called
- `CalendarService.loadEventInstance` returns `null` when `ModelService.getModel` returns `null` (404 upstream)

### E2E

One Playwright scenario on the site: navigate to a calendar, click an occurrence, verify the URL slug is minute-precision UTC and the page renders the occurrence. Widget e2e skipped — unit tests cover it.

## Affected Files

- `src/common/utils/instance-slug.ts` — **new**
- `src/common/test/utils/instance-slug.test.ts` — **new**
- `src/server/calendar/service/event_instance.ts` — add `findOrMaterializeInstanceWithDetails`; extract shared hydration helper + duration helper from existing methods (no parallel implementations)
- `src/server/calendar/entity/event_instance.ts` — (maybe) minute-truncation in `fromModel`
- `src/server/common/migrations/helpers.ts` — add `addIndexIfNotExists` helper
- `migrations/0025_add_event_instance_unique_index.ts` — **new**: unique index on `(event_id, start_time)` via idempotent helper
- `src/server/common/middleware/rate-limiters.ts` — add `publicEventInstanceByIp` limiter
- `config/default.yaml` — add `rateLimit.publicEventInstance.byIp.{max,windowMs}`
- `src/server/public/api/v1/calendar.ts` — swap route, UUID validation, rate-limiter middleware, `toPublicInstanceObject` allow-list helper
- `src/server/public/interface/index.ts`, `src/server/public/service/calendar.ts`, `src/server/calendar/interface/index.ts` — `(eventId, startTime)` signature chain
- `src/server/common/helper/meta-tags.ts` — regex constrained to slug shape, segment length caps, `getInstanceByStartTime` lookup, canonical URL shape
- `src/site/app.ts` — router regex + param rename
- `src/site/service/calendar.ts` — service signature update
- `src/site/components/event-instance.vue` — consume `startTime`
- `src/site/components/calendar.vue`, `event-card.vue` — switch to `formatInstanceSlug`
- `src/widget/router.ts` — optional `:startTime` segment
- `src/widget/components/month-view.vue`, `week-view.vue` — push slug
- `src/widget/components/event-detail-overlay.vue` — branch on `startTime`; on fallback path avoid redundant 3rd fetch
- Tests per Testing section

## Risks / Known Unknowns

- Whether event creation/edit already produces minute-aligned `start_time`. If not, add truncation + data-fix migration for existing seconds-precision rows.
- Whether the sitemap currently emits instance URLs. Grep during implementation; update if present.
- Whether any sharing / OG meta path not yet identified emits instance URLs.
- Exact `MATERIALIZATION_CAP` value (default: 1000) — may need tuning based on typical event lifetimes. Pre-flight horizon bound (default: `GENERATION_HORIZON_MONTHS + 12`) may likewise need review once real usage is observed.
