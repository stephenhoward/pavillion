# Public Event Instance Timestamp Slug — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the UUID in public event-instance URLs with a minute-precision UTC timestamp slug (`yyyymmdd-hhmm`) so shared/bookmarked links survive instance materialization churn. Extend the widget so clicking an occurrence carries instance identity. Materialize missing occurrences on demand when the slug matches the event's RRuleSet.

**Architecture:** A new shared util parses and formats the slug on both frontend and backend (with defensive year bounds). A new service method `findOrMaterializeInstanceWithDetails(eventId, startTime)` looks up an instance by `(event_id, start_time)`, short-circuits RRule validation on cache hit, guards against pathological-schedule probes with a pre-flight horizon check and a per-event materialization cap on miss, honors cancellation exclusion rows, and materializes + persists valid occurrences. Shared `hydrateInstanceEntity` and `computeOccurrenceEndTime` helpers are extracted from existing code so the new method reuses rather than duplicates. The public API route changes from `/instances/:id` to `/events/:eventId/instances/:startTime`, fronted by a new `publicEventInstanceByIp` rate limiter, UUID validation on `:eventId`, and a `toPublicInstanceObject` allow-list for response shaping. Site + widget routers adopt the same slug shape (widget keeps the segment optional for non-occurrence-aware callers). A DB unique index on `(event_id, start_time)`, applied via a new `addIndexIfNotExists` migration helper, enforces the underlying invariant and protects the materialize race.

**Tech Stack:** TypeScript / Express / Sequelize / Vue 3 (Vite) / Pinia / Luxon / rrule / Vitest / Playwright.

**Design reference:** `docs/superpowers/specs/2026-04-22-instance-timestamp-slug-design.md`.

---

## File Structure

### New files
- `src/common/utils/instance-slug.ts` — shared `formatInstanceSlug` / `parseInstanceSlug` (with year-range validation)
- `src/common/test/utils/instance-slug.test.ts` — util tests
- `migrations/0025_add_event_instance_unique_index.ts` — unique compound index

### Modified files
- `src/server/common/migrations/helpers.ts` — add `addIndexIfNotExists` helper
- `src/server/calendar/service/event_instance.ts` — extract shared `hydrateInstanceEntity` from `getEventInstanceWithDetails`; extract `computeOccurrenceEndTime` from `generateInstances`; add `findOrMaterializeInstanceWithDetails` using both
- `src/server/calendar/interface/index.ts` — add `findOrMaterializeInstanceWithDetails` interface method
- `src/server/public/service/calendar.ts` — add `getInstanceByStartTime`
- `src/server/public/interface/index.ts` — add `getInstanceByStartTime`
- `src/server/common/middleware/rate-limiters.ts` — add `publicEventInstanceByIp`
- `config/default.yaml` — add `rateLimit.publicEventInstance.byIp.{max,windowMs}`
- `src/server/public/api/v1/calendar.ts` — swap route; delete old handler; add UUID validation, rate limiter, `toPublicInstanceObject` allow-list
- `src/server/common/helper/meta-tags.ts` — slug-shape regex with segment length caps; lookup via `getInstanceByStartTime`
- `src/site/app.ts` — router regex + param rename
- `src/site/service/calendar.ts` — `loadEventInstance(eventId, startTime)`
- `src/site/components/event-instance.vue` — consume `startTime` route param
- `src/site/components/event-card.vue` — emit slug-based href
- `src/widget/router.ts` — optional `:startTime` segment
- `src/widget/components/month-view.vue` — push slug in params
- `src/widget/components/week-view.vue` — push slug in params
- `src/widget/components/event-detail-overlay.vue` — branch on `startTime` presence; drop redundant 3rd fetch on fallback path

### Modified tests
- `src/server/calendar/test/service/event_instance.test.ts` — new describe block
- `src/server/public/test/calendar-api.test.ts` (or adjacent file used for public API integration) — route swap
- `src/server/common/helper/test/meta-tags.test.ts` — parser + builder updates
- `src/site/test/components/event-instance.test.ts` — param rename
- `src/site/test/components/event-card.test.ts` — href assertion
- `src/site/test/router-locale-guard.test.ts` — route path update
- `src/widget/test/widgetApp.test.ts`, `src/widget/test/event-detail-overlay.test.ts`, `src/widget/components/test/viewComponents.test.ts` — route path update + overlay branching

---

## Task 1: Shared Slug Utility

**Files:**
- Create: `src/common/utils/instance-slug.ts`
- Create: `src/common/test/utils/instance-slug.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/common/test/utils/instance-slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { formatInstanceSlug, parseInstanceSlug } from '@/common/utils/instance-slug';

describe('formatInstanceSlug', () => {
  it('formats a UTC DateTime to yyyymmdd-hhmm', () => {
    const dt = DateTime.fromISO('2026-05-01T18:30:00Z', { zone: 'utc' });
    expect(formatInstanceSlug(dt)).toBe('20260501-1830');
  });

  it('converts a zoned DateTime to UTC before formatting', () => {
    const dt = DateTime.fromISO('2026-05-01T14:30:00-04:00');
    expect(formatInstanceSlug(dt)).toBe('20260501-1830');
  });

  it('pads single-digit components with zeros', () => {
    const dt = DateTime.fromISO('2026-01-02T03:04:00Z', { zone: 'utc' });
    expect(formatInstanceSlug(dt)).toBe('20260102-0304');
  });
});

describe('parseInstanceSlug', () => {
  it('parses a valid slug to a UTC DateTime', () => {
    const result = parseInstanceSlug('20260501-1830');
    expect(result).not.toBeNull();
    expect(result!.zoneName).toBe('UTC');
    expect(result!.toISO()).toBe('2026-05-01T18:30:00.000Z');
  });

  it('round-trips through formatInstanceSlug', () => {
    const dt = DateTime.fromISO('2026-07-15T09:45:00Z', { zone: 'utc' });
    expect(parseInstanceSlug(formatInstanceSlug(dt))!.toMillis()).toBe(dt.toMillis());
  });

  it('returns null for structurally-malformed slugs', () => {
    expect(parseInstanceSlug('')).toBeNull();
    expect(parseInstanceSlug('20260501')).toBeNull();
    expect(parseInstanceSlug('2026-05-01-18-30')).toBeNull();
    expect(parseInstanceSlug('20260501_1830')).toBeNull();
    expect(parseInstanceSlug('abcd0501-1830')).toBeNull();
    expect(parseInstanceSlug('20260501-18300')).toBeNull();
  });

  it('returns null for semantically-invalid values', () => {
    expect(parseInstanceSlug('20261301-1830')).toBeNull(); // month 13
    expect(parseInstanceSlug('20260532-1830')).toBeNull(); // day 32
    expect(parseInstanceSlug('20260501-2500')).toBeNull(); // hour 25
    expect(parseInstanceSlug('20260501-1860')).toBeNull(); // minute 60
    expect(parseInstanceSlug('20260229-1200')).toBeNull(); // 2026 is not a leap year
  });

  it('rejects years outside the plausible bookmark range', () => {
    // Year bounds: [currentYear − 5, currentYear + 10].
    // These tests stay stable over time because they test the extremes.
    expect(parseInstanceSlug('00010101-0000')).toBeNull();
    expect(parseInstanceSlug('18000101-0000')).toBeNull();
    expect(parseInstanceSlug('99991231-2359')).toBeNull();
    // A year 50 years in the future should always be out of bounds.
    const farFuture = String(new Date().getUTCFullYear() + 50).padStart(4, '0');
    expect(parseInstanceSlug(`${farFuture}0101-0000`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/common/test/utils/instance-slug.test.ts`
Expected: FAIL with module-not-found or similar.

- [ ] **Step 3: Implement the utility**

Create `src/common/utils/instance-slug.ts`:

```ts
import { DateTime } from 'luxon';

const SLUG_REGEX = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/;

// Defense-in-depth year bounds to prevent distant timestamps from reaching
// rrule.between, which walks the occurrence series between dtstart and the
// probe point. These bounds widely accommodate legitimate bookmarks.
const YEAR_LOOKBACK = 5;
const YEAR_LOOKAHEAD = 10;

/**
 * Format a DateTime as a minute-precision UTC instance slug: `yyyymmdd-hhmm`.
 * The input is converted to UTC before formatting so callers may pass a
 * zoned DateTime without pre-conversion.
 */
export function formatInstanceSlug(start: DateTime): string {
  return start.toUTC().toFormat('yyyyMMdd-HHmm');
}

/**
 * Parse an instance slug (`yyyymmdd-hhmm`, UTC) into a Luxon DateTime.
 * Returns null for structurally-malformed, semantically-invalid, or
 * out-of-bounds input.
 */
export function parseInstanceSlug(slug: string): DateTime | null {
  if (!slug) return null;
  const match = SLUG_REGEX.exec(slug);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const yearNum = Number(year);
  const currentYear = new Date().getUTCFullYear();
  if (yearNum < currentYear - YEAR_LOOKBACK || yearNum > currentYear + YEAR_LOOKAHEAD) {
    return null;
  }
  const parsed = DateTime.fromObject(
    {
      year: yearNum,
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
    },
    { zone: 'utc' },
  );
  return parsed.isValid ? parsed : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/common/test/utils/instance-slug.test.ts`
Expected: PASS (all 9 test cases).

- [ ] **Step 5: Commit**

```bash
git add src/common/utils/instance-slug.ts src/common/test/utils/instance-slug.test.ts
git commit -m "feat(common): add instance slug util for yyyymmdd-hhmm URLs"
```

---

## Task 1a: Migration Helper — `addIndexIfNotExists`

**Files:**
- Modify: `src/server/common/migrations/helpers.ts`

The project's established migration pattern uses idempotent helpers (`createTableIfNotExists`, `addColumnIfNotExists`). No equivalent exists for indexes. Add one so Task 2's migration and future index migrations are re-run safe.

- [ ] **Step 1: Implement the helper**

In `src/server/common/migrations/helpers.ts`, add:

```ts
/**
 * Idempotent index addition: adds the index only if an index with the given
 * name does not already exist on the table. Mirrors the pattern of
 * createTableIfNotExists and addColumnIfNotExists.
 */
export async function addIndexIfNotExists(
  queryInterface: any,
  table: string,
  fields: string[],
  options: { name: string; unique?: boolean },
): Promise<void> {
  const indexes = await queryInterface.showIndex(table);
  const exists = indexes.some((ix: any) => ix.name === options.name);
  if (!exists) {
    await queryInterface.addIndex(table, fields, options);
  }
}
```

If an existing helper in this file uses a stricter typed `QueryInterface` signature rather than `any`, mirror that typing rather than using `any`.

- [ ] **Step 2: Commit**

```bash
git add src/server/common/migrations/helpers.ts
git commit -m "feat(migrations): add addIndexIfNotExists helper for idempotent index creation"
```

---

## Task 2: DB Unique Index Migration

**Files:**
- Create: `migrations/0025_add_event_instance_unique_index.ts`

Establishes the `(event_id, start_time)` uniqueness invariant that the materialize-on-miss path depends on.

- [ ] **Step 1: Write the migration**

Create `migrations/0025_add_event_instance_unique_index.ts`:

```ts
import { Sequelize } from 'sequelize';
import { addIndexIfNotExists } from '../src/server/common/migrations/helpers.js';

/**
 * Add a unique compound index on event_instance(event_id, start_time).
 *
 * Context: public event-instance URLs use a minute-precision UTC timestamp
 * slug (`yyyymmdd-hhmm`) rather than the row UUID. The lookup `(event_id,
 * start_time)` must return at most one row. This index also protects the
 * `findOrMaterializeInstanceWithDetails` race where two concurrent requests
 * for the same uncached occurrence could both attempt to insert — the loser
 * catches the unique-violation and re-fetches.
 *
 * The existing non-unique indexes on event_id and start_time remain in
 * place; they are still useful for range scans and single-column lookups.
 *
 * Reference: docs/superpowers/specs/2026-04-22-instance-timestamp-slug-design.md
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await addIndexIfNotExists(
      queryInterface,
      'event_instance',
      ['event_id', 'start_time'],
      {
        name: 'idx_event_instance_event_id_start_time_unique',
        unique: true,
      },
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.removeIndex(
      'event_instance',
      'idx_event_instance_event_id_start_time_unique',
    );
  },
};
```

- [ ] **Step 2: Run migrations to verify the index applies cleanly**

Run: `npm run dev:backend` in one terminal; confirm backend boots without migration errors. Then kill it.
Expected: backend starts; no "already exists" or constraint-violation errors.

Alternative (if a migration CLI script exists): `npx tsx scripts/run-migrations.ts` or whatever the project's run-migrations script is. Check `package.json` scripts for the canonical name.

If the dev-backend start fails because existing data contains duplicate `(event_id, start_time)` rows (should not — `generateInstances` already deduplicates per schedule — but verify), investigate and dedupe before re-running.

- [ ] **Step 3: Commit**

```bash
git add migrations/0025_add_event_instance_unique_index.ts
git commit -m "feat(db): add unique index on event_instance(event_id, start_time)"
```

---

## Task 2a: Verify Minute-Truncation Invariant

**Files:**
- (investigation only; may result in a follow-up fix)

The slug is minute-precision; the lookup uses exact `start_time` equality. If existing event creation paths produce `start_time` values with non-zero seconds, bookmarked URLs would miss the cache and fall into the materialize path (which would then also fail, because `assertDateMatchesOccurrence` uses a ±1 ms window). Verify before proceeding.

- [ ] **Step 1: Start the dev backend to seed the dev DB**

Run: `npm run dev:backend` in a separate terminal. Wait until it reports ready. Kill it with Ctrl-C once the DB has been re-seeded.

- [ ] **Step 2: Query the dev DB for sub-minute `start_time` values**

Run the following against the dev Postgres DB (the project uses `config/development.yaml` for connection details; `psql` invocation will be project-specific — find the dev DB name/user via `grep -A2 database config/development.yaml`):

```sql
SELECT COUNT(*) AS rows_with_seconds
FROM event_instance
WHERE EXTRACT(SECOND FROM start_time) <> 0
   OR EXTRACT(MILLISECOND FROM start_time) <> 0;
```

Expected: `0`.

- [ ] **Step 3: If non-zero, decide fix path**

If Step 2 returns a non-zero count:

**Option A (preferred)** — Truncate at generation time. In `src/server/calendar/service/event_instance.ts`, find the `generateInstances` method (around line 1102). Each generated `CalendarEventInstance.start` must be truncated to the minute. Add `.startOf('minute')` at the point where the start DateTime is constructed from the RRule output. Add a unit test in `event_instance.test.ts` asserting that generated instances have second=0 and millisecond=0.

**Option B (if RRule output is already minute-aligned but drift comes from elsewhere)** — Audit event creation/edit paths (`events.ts` service methods that call `buildEventInstances`) to confirm the incoming schedule's `start_date` is minute-truncated.

Re-run Step 2 after the fix; expect `0`.

- [ ] **Step 4: Commit (if any fix was made)**

```bash
git add src/server/calendar/service/event_instance.ts \
        src/server/calendar/test/service/event_instance.test.ts
git commit -m "fix(calendar): truncate generated instance start_time to minute precision"
```

If no fix was needed, no commit; proceed to Task 3.

---

## Task 3: Service — `findOrMaterializeInstanceWithDetails`

**Files:**
- Modify: `src/server/calendar/service/event_instance.ts`
- Modify: `src/server/calendar/test/service/event_instance.test.ts`

Adds the core server-side lookup method. Before writing the new method, **extract two shared helpers** so the new method reuses existing logic rather than duplicating it:

1. `hydrateInstanceEntity(entity)` — extracted from the body of `getEventInstanceWithDetails` (lines 456-497). Handles `toModel`, schedule population, `markShownCancellations`, location hydration, category population, and `resolveSourceCalendars`. Called from both `getEventInstanceWithDetails` and the new method.
2. `computeOccurrenceEndTime(event, startTime)` — extracted from the duration-computation inside `generateInstances` (around lines 1105-1114, where a `Duration` is derived from the first non-exclusion schedule's `eventEndTime`). Called from both `generateInstances` and the new method.

After extraction, the existing `generateInstances` and `getEventInstanceWithDetails` tests should still pass unchanged — that's the refactor safety net.

- [ ] **Step 1: Write the failing test**

Append to `src/server/calendar/test/service/event_instance.test.ts` (use the existing `describe('EventInstanceService', ...)` block or add a new one following the file's conventions — re-use the file's existing fixtures/builders for events and schedules):

```ts
describe('findOrMaterializeInstanceWithDetails', () => {
  it('returns the existing row when one already matches (event_id, start_time)', async () => {
    const { event, instance } = await seedEventWithMaterializedInstance({
      start: DateTime.fromISO('2026-05-01T18:00:00Z', { zone: 'utc' }),
    });

    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2026-05-01T18:00:00Z', { zone: 'utc' }),
    );

    expect(result).not.toBeNull();
    expect(result!.id).toBe(instance.id);
    expect(result!.start.toMillis()).toBe(instance.start.toMillis());
  });

  it('short-circuits RRule validation on cache hit even if the RRule would reject the date', async () => {
    // Seed an instance row, then mutate the event's schedule so the same
    // start_time is no longer produced by the RRule. The lookup must return
    // the pre-existing row without invoking assertDateMatchesOccurrence.
    const { event, instance } = await seedEventWithMaterializedInstance({
      start: DateTime.fromISO('2026-05-01T18:00:00Z', { zone: 'utc' }),
    });
    await narrowScheduleToExcludeStart(event, '2026-05-01T18:00:00Z');

    // Stub the RRule check to throw if invoked; pass == never called.
    const assertStub = sandbox.stub(service as any, 'assertDateMatchesOccurrence').throws(new Error('RRule should not be called on cache hit'));

    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2026-05-01T18:00:00Z', { zone: 'utc' }),
    );

    expect(result).not.toBeNull();
    expect(result!.id).toBe(instance.id);
    expect(assertStub.called).toBe(false);
  });

  it('materializes and persists a new row on cache miss when the date matches the RRuleSet', async () => {
    const { event } = await seedRecurringEventWithoutMaterializedHorizon({
      startTime: DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    });

    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    );

    expect(result).not.toBeNull();
    expect(result!.start.toMillis()).toBe(
      DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }).toMillis(),
    );
    const persisted = await EventInstanceEntity.findOne({
      where: { event_id: event.id, start_time: result!.start.toJSDate() },
    });
    expect(persisted).not.toBeNull();
  });

  it('returns null when the start time does not match any occurrence', async () => {
    const { event } = await seedRecurringEventWithoutMaterializedHorizon({
      startTime: DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    });

    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2026-05-08T19:00:00Z', { zone: 'utc' }),
    );
    expect(result).toBeNull();
  });

  it('returns null when the event does not exist', async () => {
    const result = await service.findOrMaterializeInstanceWithDetails(
      '00000000-0000-0000-0000-000000000000',
      DateTime.fromISO('2026-05-01T18:00:00Z', { zone: 'utc' }),
    );
    expect(result).toBeNull();
  });

  it('returns null for a hidden-cancelled occurrence (exclusion with hide_from_public=true)', async () => {
    const { event } = await seedEventWithHiddenExclusion({
      excludedStart: DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    });

    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    );

    expect(result).toBeNull();
    const persisted = await EventInstanceEntity.findOne({
      where: {
        event_id: event.id,
        start_time: DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }).toJSDate(),
      },
    });
    expect(persisted).toBeNull();
  });

  it('returns a cancelled in-memory model for a shown-cancelled occurrence without persisting', async () => {
    const { event } = await seedEventWithShownExclusion({
      excludedStart: DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    });

    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    );

    expect(result).not.toBeNull();
    expect(result!.isCancelled).toBe(true);
    const persisted = await EventInstanceEntity.findOne({
      where: {
        event_id: event.id,
        start_time: DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }).toJSDate(),
      },
    });
    expect(persisted).toBeNull();
  });

  it('rejects an unbounded-recurring schedule probed far beyond the horizon (pre-flight guard)', async () => {
    // A DAILY schedule with no UNTIL/COUNT. Probing a year out, which is
    // within parseInstanceSlug's bounds but beyond the pre-flight horizon,
    // must return null WITHOUT calling rrule.between.
    const { event } = await seedUnboundedDailyEvent({
      dtstart: DateTime.fromISO('2020-01-01T00:00:00Z', { zone: 'utc' }),
    });
    const assertStub = sandbox.stub(service as any, 'assertDateMatchesOccurrence').throws(new Error('rrule.between should not be called when pre-flight guard triggers'));

    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2035-01-01T00:00:00Z', { zone: 'utc' }),
    );

    expect(result).toBeNull();
    expect(assertStub.called).toBe(false);
  });

  it('refuses to materialize when the event already has MATERIALIZATION_CAP rows', async () => {
    const { event } = await seedEventAtMaterializationCap();
    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2027-01-01T00:00:00Z', { zone: 'utc' }),
    );
    expect(result).toBeNull();
  });

  it('returns an instance with end=null when the schedule has no configured event_end_time', async () => {
    const { event } = await seedRecurringEventNoDuration({
      startTime: DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    });

    const result = await service.findOrMaterializeInstanceWithDetails(
      event.id,
      DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
    );

    expect(result).not.toBeNull();
    expect(result!.end).toBeNull();
  });

  // NOTE: the unique-constraint race is tested end-to-end in the public-API
  // integration suite (Task 5) via two concurrent HTTP requests against a
  // real test DB. That's the only way to trigger the actual
  // SequelizeUniqueConstraintError branch — a unit stub would only test the
  // mock, not the constraint.
});
```

**Note on fixtures:** The file likely already has helpers such as `seedEvent`, `seedEventSchedule`, etc. If exact names differ, adapt the seed-helper calls to match the file's existing patterns rather than inventing new ones. The assertions and service-method calls stay the same. New fixture helpers (`narrowScheduleToExcludeStart`, `seedUnboundedDailyEvent`, `seedEventAtMaterializationCap`, `seedRecurringEventNoDuration`) should be added alongside the existing fixture helpers in the same file, named consistently with what's there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/calendar/test/service/event_instance.test.ts -t 'findOrMaterializeInstanceWithDetails'`
Expected: FAIL — method does not exist on the service.

- [ ] **Step 3a: Extract `hydrateInstanceEntity` from `getEventInstanceWithDetails`**

In `src/server/calendar/service/event_instance.ts`, refactor `getEventInstanceWithDetails` (lines 439-497). Move its body that hydrates the already-fetched `EventInstanceEntity` into a new private method:

```ts
  /**
   * Shared hydration: given a fully-eager-loaded EventInstanceEntity, produce
   * a CalendarEventInstance with schedules populated, shown-cancellations
   * marked, location model hydrated, categories populated, and source
   * calendar resolved. Both getEventInstanceWithDetails and
   * findOrMaterializeInstanceWithDetails delegate to this helper so the
   * detail shape is identical on both paths.
   */
  private async hydrateInstanceEntity(
    entity: EventInstanceEntity,
  ): Promise<CalendarEventInstance> {
    const instance = entity.toModel();
    const event = entity.event;

    const scheduleEntities = (event.getDataValue('schedules') ?? []) as EventScheduleEntity[];
    instance.event.schedules = scheduleEntities.map((s: EventScheduleEntity) => s.toModel());

    this.markShownCancellations([instance]);

    if (event.location) {
      instance.event.location = event.location.toModel();
    }

    instance.event.categories = await this.categoryService.getEventCategories(
      instance.event.id,
      entity.calendar_id,
    );

    const repostContext: RepostContext = {
      event: instance.event,
      displayCalendarId: entity.calendar_id,
      eventCalendarId: entity.event?.calendar_id ?? null,
      sourceCalendarUrlName: entity.event?.calendar?.url_name,
    };
    const remoteEventIds = repostContext.eventCalendarId === null ? [instance.event.id] : [];
    const remoteActorUriMap = await this.fetchRemoteActorUriMap(remoteEventIds);
    await resolveSourceCalendars([repostContext], remoteActorUriMap);

    return instance;
  }
```

Replace the body of `getEventInstanceWithDetails` (after the existing `findOne` with full include shape) to call the helper:

```ts
  async getEventInstanceWithDetails(instanceId: string): Promise<CalendarEventInstance | null> {
    const eventInstance = await EventInstanceEntity.findOne({
      where: { id: instanceId },
      include: [{
        model: EventEntity,
        as: 'event',
        include: [
          EventContentEntity,
          { model: LocationEntity, include: [LocationContentEntity] },
          EventScheduleEntity,
          MediaEntity,
          CalendarEntity,
        ],
      }],
    });
    if (!eventInstance) return null;
    return this.hydrateInstanceEntity(eventInstance);
  }
```

- [ ] **Step 3b: Extract `computeOccurrenceEndTime` from `generateInstances`**

Read `generateInstances` (around lines 1102-1280) to locate the duration-derivation block. Extract:

```ts
  /**
   * Derive an occurrence's end time by applying the duration of the event's
   * first non-exclusion schedule with a configured eventEndTime. Returns
   * null if no such schedule exists. Shared by generateInstances and
   * findOrMaterializeInstanceWithDetails so the two paths agree on the
   * computed end time.
   */
  private computeOccurrenceEndTime(
    event: CalendarEvent,
    startTime: DateTime,
  ): DateTime | null {
    const baseSchedule = (event.schedules ?? []).find(
      s => !s.isExclusion && s.startDate && s.eventEndTime,
    );
    if (!baseSchedule || !baseSchedule.startDate || !baseSchedule.eventEndTime) {
      return null;
    }
    const durationMs = baseSchedule.eventEndTime.toMillis() - baseSchedule.startDate.toMillis();
    if (durationMs <= 0) return null;
    return startTime.plus({ milliseconds: durationMs });
  }
```

In `generateInstances`, replace the inline duration computation with a call to `this.computeOccurrenceEndTime(event, occurrenceStart)`. The exact replacement depends on the current structure of that method — read it first, then perform the smallest possible substitution that keeps behavior identical.

- [ ] **Step 3c: Run existing tests to verify the refactor is behavior-preserving**

Run: `npx vitest run src/server/calendar/test/service/event_instance.test.ts`
Expected: PASS. All existing tests for `getEventInstanceWithDetails`, `listEventInstances`, `generateInstances`, `buildEventInstances` must continue to pass with the extracted helpers.

Commit the refactor as its own step:

```bash
git add src/server/calendar/service/event_instance.ts
git commit -m "refactor(calendar): extract hydrateInstanceEntity and computeOccurrenceEndTime"
```

- [ ] **Step 3d: Implement the new service method**

Immediately after `getEventInstanceWithDetails`, add:

```ts
  /**
   * Bound on total persisted instances per event. Prevents anonymous-write
   * amplification through the materialize-on-miss path.
   */
  private static readonly MATERIALIZATION_CAP = 1000;

  /**
   * Additional pre-flight horizon: an unbounded recurring schedule (no
   * UNTIL / COUNT) cannot be probed beyond GENERATION_HORIZON_MONTHS + 12
   * from dtstart without calling into rrule. Bounds the RRuleSet walk.
   */
  private static readonly UNBOUNDED_PREFLIGHT_MONTHS = GENERATION_HORIZON_MONTHS + 12;

  /**
   * Look up an event instance by `(eventId, startTime)` with the same eager
   * loading as {@link getEventInstanceWithDetails}. On cache miss, validate
   * that `startTime` coincides with an occurrence produced by the event's
   * RRuleSet; if valid and not cancelled-hidden, materialize and persist a
   * new `EventInstanceEntity` row. Cancelled-shown occurrences return an
   * in-memory `CalendarEventInstance` with `isCancelled=true` and are not
   * persisted.
   *
   * Defensive bounds:
   *  - Pre-flight horizon check for unbounded recurring schedules (returns
   *    null before invoking rrule)
   *  - Per-event materialization cap (returns null at the cap)
   *
   * Concurrency: protected by the unique index on `(event_id, start_time)`.
   * On unique-violation during the race, the loser re-fetches the row the
   * winner inserted via the same hydration helper used for cache hits.
   */
  async findOrMaterializeInstanceWithDetails(
    eventId: string,
    startTime: DateTime,
  ): Promise<CalendarEventInstance | null> {
    const startMs = startTime.toUTC().toMillis();
    const startDate = new Date(startMs);

    // 1. Cache hit via a single eager-load of the existing row.
    const cached = await EventInstanceEntity.findOne({
      where: { event_id: eventId, start_time: startDate },
      include: [{
        model: EventEntity,
        as: 'event',
        include: [
          EventContentEntity,
          { model: LocationEntity, include: [LocationContentEntity] },
          EventScheduleEntity,
          MediaEntity,
          CalendarEntity,
        ],
      }],
    });
    if (cached) {
      // Short-circuit: do not re-validate against the RRuleSet. Materialized
      // rows are authoritative; a subsequent schedule edit that would now
      // reject this date does not invalidate a pre-existing bookmark.
      return this.hydrateInstanceEntity(cached);
    }

    // 2. Load the event with BOTH schedules and the detail-page associations
    //    in a single query. This eliminates the need for a second fetch on
    //    the cancelled-shown path — every branch from here on works from the
    //    same entity.
    const eventEntity = await EventEntity.findByPk(eventId, {
      include: [
        EventContentEntity,
        { model: LocationEntity, include: [LocationContentEntity] },
        EventScheduleEntity,
        MediaEntity,
        CalendarEntity,
      ],
    });
    if (!eventEntity) {
      return null;
    }
    const event = eventEntity.toModel();
    const scheduleEntities = (eventEntity.getDataValue('schedules') ?? []) as EventScheduleEntity[];
    event.schedules = scheduleEntities.map(s => s.toModel());

    // 3. Pre-flight guard: reject far-future probes on unbounded schedules.
    if (this.exceedsUnboundedHorizon(event, startTime)) {
      return null;
    }

    // 4. Validate occurrence membership via the RRuleSet.
    try {
      this.assertDateMatchesOccurrence(event, startTime);
    }
    catch (err) {
      if (err instanceof InvalidOccurrenceDateError) {
        return null;
      }
      throw err;
    }

    // 5. Exclusion rows.
    const exclusion = (event.schedules ?? []).find(s =>
      s.isExclusion
      && s.startDate
      && s.startDate.toUTC().toMillis() === startMs,
    );
    if (exclusion) {
      if (exclusion.hideFromPublic) {
        return null;
      }
      // Shown cancellation: build a transient in-memory instance directly
      // from the already-loaded eventEntity. No second fetch.
      return this.buildTransientCancelledInstance(eventEntity, startTime);
    }

    // 6. Materialization cap.
    const persistedCount = await EventInstanceEntity.count({
      where: { event_id: eventId },
    });
    if (persistedCount >= EventInstanceService.MATERIALIZATION_CAP) {
      logger.warn(
        { eventId, persistedCount },
        'materialization cap reached; refusing to persist new instance',
      );
      return null;
    }

    // 7. Materialize + persist with unique-constraint catch.
    const endTime = this.computeOccurrenceEndTime(event, startTime);
    const row = EventInstanceEntity.build({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: eventEntity.calendar_id,
      start_time: startDate,
      end_time: endTime ? endTime.toJSDate() : null,
    });
    try {
      await row.save();
    }
    catch (err: any) {
      if (err?.name !== 'SequelizeUniqueConstraintError') {
        throw err;
      }
      // Fall through: winner already inserted; re-fetch via eager-load below.
    }

    const persisted = await EventInstanceEntity.findOne({
      where: { event_id: eventId, start_time: startDate },
      include: [{
        model: EventEntity,
        as: 'event',
        include: [
          EventContentEntity,
          { model: LocationEntity, include: [LocationContentEntity] },
          EventScheduleEntity,
          MediaEntity,
          CalendarEntity,
        ],
      }],
    });
    if (!persisted) return null;
    return this.hydrateInstanceEntity(persisted);
  }

  /**
   * Pre-flight check that bounds how far into the future an unbounded
   * recurring schedule (no UNTIL, no COUNT) can be probed before rrule is
   * called. For bounded schedules, rrule's own bounds already limit work;
   * for unbounded schedules, an attacker probing year-distant timestamps
   * would drive O(occurrences-since-dtstart) work per request.
   */
  private exceedsUnboundedHorizon(event: CalendarEvent, startTime: DateTime): boolean {
    const now = DateTime.utc();
    const horizon = now.plus({ months: EventInstanceService.UNBOUNDED_PREFLIGHT_MONTHS });
    if (startTime <= horizon) return false;

    // Only guard when at least one schedule is recurring-unbounded.
    const hasUnbounded = (event.schedules ?? []).some(s =>
      !s.isExclusion
      && s.frequency
      && !s.count
      && !s.endDate,
    );
    return hasUnbounded;
  }

  /**
   * Synthesize a cancelled in-memory instance from an already-loaded event
   * entity — no extra DB round-trip. Used for the cancelled-shown branch.
   */
  private async buildTransientCancelledInstance(
    eventEntity: EventEntity,
    startTime: DateTime,
  ): Promise<CalendarEventInstance> {
    const eventModel = eventEntity.toModel();
    const scheduleEntities = (eventEntity.getDataValue('schedules') ?? []) as EventScheduleEntity[];
    eventModel.schedules = scheduleEntities.map(s => s.toModel());
    if (eventEntity.location) {
      eventModel.location = eventEntity.location.toModel();
    }
    eventModel.categories = await this.categoryService.getEventCategories(
      eventModel.id,
      eventEntity.calendar_id,
    );

    const endTime = this.computeOccurrenceEndTime(eventModel, startTime);
    const instance = new CalendarEventInstance(
      `transient-${startTime.toUTC().toMillis()}`,
      eventModel,
      startTime.toUTC(),
      endTime,
    );
    instance.isCancelled = true;

    const repostContext: RepostContext = {
      event: instance.event,
      displayCalendarId: eventEntity.calendar_id,
      eventCalendarId: eventEntity.calendar_id ?? null,
      sourceCalendarUrlName: eventEntity.calendar?.url_name,
    };
    const remoteEventIds = repostContext.eventCalendarId === null ? [instance.event.id] : [];
    const remoteActorUriMap = await this.fetchRemoteActorUriMap(remoteEventIds);
    await resolveSourceCalendars([repostContext], remoteActorUriMap);

    return instance;
  }
```

If `logger` and `GENERATION_HORIZON_MONTHS` are already available at the top of the file (they are — confirmed at lines 30 and 53), no new imports needed beyond `DateTime` from Luxon (already imported).

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run src/server/calendar/test/service/event_instance.test.ts -t 'findOrMaterializeInstanceWithDetails'`
Expected: PASS (all 10 new test cases).

- [ ] **Step 5: Run the full file to catch regressions**

Run: `npx vitest run src/server/calendar/test/service/event_instance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/calendar/service/event_instance.ts \
        src/server/calendar/test/service/event_instance.test.ts
git commit -m "feat(calendar): add findOrMaterializeInstanceWithDetails with pre-flight guard"
```

---

## Task 4: Interface Wiring (Calendar + Public)

**Files:**
- Modify: `src/server/calendar/interface/index.ts`
- Modify: `src/server/public/service/calendar.ts`
- Modify: `src/server/public/interface/index.ts`

Exposes the new service method to the public layer via the interface chain, following the existing DDD pattern (DEC-003).

- [ ] **Step 1: Add method on the calendar domain interface**

In `src/server/calendar/interface/index.ts`, immediately after `getEventInstanceWithDetails` (around line 361), add:

```ts
  /**
   * Look up or materialize an instance by (eventId, startTime). See
   * EventInstanceService.findOrMaterializeInstanceWithDetails for the
   * full contract.
   */
  async findOrMaterializeInstanceWithDetails(
    eventId: string,
    startTime: DateTime,
  ): Promise<CalendarEventInstance | null> {
    return this.eventInstanceService.findOrMaterializeInstanceWithDetails(eventId, startTime);
  }
```

If `DateTime` is not already imported at the top of this file, add `import { DateTime } from 'luxon';`.

- [ ] **Step 2: Add method on the public calendar service**

In `src/server/public/service/calendar.ts`, immediately after `getEventInstanceById` (around line 130), add:

```ts
  /**
   * Get an event instance for the public detail page by (eventId, startTime).
   * Materializes the row on demand if the timestamp matches the event's
   * RRuleSet and no cached row exists.
   */
  async getInstanceByStartTime(
    eventId: string,
    startTime: DateTime,
  ): Promise<CalendarEventInstance | null> {
    return this.calendarInterface.findOrMaterializeInstanceWithDetails(eventId, startTime);
  }
```

- [ ] **Step 3: Add method on the public interface**

In `src/server/public/interface/index.ts`, immediately after `getEventInstanceById` (around line 47), add:

```ts
  /**
   * Get an event instance by (eventId, startTime) for the public detail page.
   * See PublicCalendarService.getInstanceByStartTime.
   */
  async getInstanceByStartTime(
    eventId: string,
    startTime: DateTime,
  ): Promise<CalendarEventInstance | null> {
    return this.publicCalendarService.getInstanceByStartTime(eventId, startTime);
  }
```

Add `import { DateTime } from 'luxon';` at the top if missing.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/server/calendar/interface/index.ts \
        src/server/public/service/calendar.ts \
        src/server/public/interface/index.ts
git commit -m "feat(public): expose getInstanceByStartTime through interface chain"
```

---

## Task 4a: Rate-Limiter + Config

**Files:**
- Modify: `src/server/common/middleware/rate-limiters.ts`
- Modify: `config/default.yaml`

Add a new IP-based rate limiter for the public event-instance endpoint, following the established pattern for `publicWidgetByIp`.

- [ ] **Step 1: Add the config entries**

In `config/default.yaml`, under the existing `rateLimit:` tree (alongside `publicWidget`), add:

```yaml
    publicEventInstance:
      byIp:
        max: 120
        windowMs: 900000  # 15 minutes
```

(Verify the indentation matches the existing `publicWidget` entry exactly.)

- [ ] **Step 2: Add the limiter middleware**

In `src/server/common/middleware/rate-limiters.ts`, immediately after the `publicWidgetByIp` export (around line 145), add:

```ts
/**
 * Public event-instance detail endpoint rate limiter by IP.
 * Limits: 120 requests per IP per 15 minutes (default config).
 *
 * Rationale: the endpoint can lazily materialize instance rows on cache
 * miss. The limit bounds anonymous-write throughput while remaining
 * permissive enough for legitimate share-link traffic from social crawlers
 * and search engines.
 */
export const publicEventInstanceByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.publicEventInstance.byIp.max'),
    config.get<number>('rateLimit.publicEventInstance.byIp.windowMs'),
    'public-event-instance',
  )
  : noOpMiddleware;
```

- [ ] **Step 3: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/common/middleware/rate-limiters.ts config/default.yaml
git commit -m "feat(rate-limit): add publicEventInstanceByIp limiter for /instances/:slug"
```

---

## Task 5: Public API Route Swap

**Files:**
- Modify: `src/server/public/api/v1/calendar.ts`
- Modify: (integration test file — identify via grep)

Removes the UUID-keyed route and replaces it with the nested, timestamp-keyed route.

- [ ] **Step 1: Find the integration test file**

Run: `grep -rn "/api/public/v1/instances" src/server --include="*.ts" | grep test`
Expected: one or more file paths. The most likely candidate is `src/server/public/test/*.ts`.

If no dedicated test exists for this endpoint, write the new handler test in a file parallel to the existing calendar public-API integration tests (e.g. alongside `src/server/public/test/schedule-location-api.test.ts`).

- [ ] **Step 2: Write the failing integration test**

Add (or create) tests asserting the new route shape. Skeleton using the project's conventions:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '@/server/public/test/helpers';     // use whatever helper the existing public tests use
import { DateTime } from 'luxon';

describe('GET /api/public/v1/events/:eventId/instances/:startTime', () => {
  it('returns 200 with instance JSON for a valid slug matching an occurrence', async () => {
    const { app, event, expectedStart } = await seedEventFixture({
      startIso: '2026-05-08T18:00:00Z',
    });

    const slug = '20260508-1800';
    const res = await request(app).get(
      `/api/public/v1/events/${event.id}/instances/${slug}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.event.id).toBe(event.id);
    expect(DateTime.fromISO(res.body.start).toMillis()).toBe(expectedStart.toMillis());
  });

  it('returns 404 when the slug is malformed', async () => {
    const { app, event } = await seedEventFixture({ startIso: '2026-05-08T18:00:00Z' });
    const res = await request(app).get(
      `/api/public/v1/events/${event.id}/instances/not-a-slug`,
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when the slug is structurally valid but does not match any occurrence', async () => {
    const { app, event } = await seedEventFixture({ startIso: '2026-05-08T18:00:00Z' });
    const res = await request(app).get(
      `/api/public/v1/events/${event.id}/instances/20260509-1800`, // wrong day
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when the occurrence is hidden-cancelled', async () => {
    const { app, event } = await seedEventFixtureWithHiddenExclusion({
      excludedIso: '2026-05-08T18:00:00Z',
    });
    const res = await request(app).get(
      `/api/public/v1/events/${event.id}/instances/20260508-1800`,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with isCancelled=true for a shown-cancelled occurrence', async () => {
    const { app, event } = await seedEventFixtureWithShownExclusion({
      excludedIso: '2026-05-08T18:00:00Z',
    });
    const res = await request(app).get(
      `/api/public/v1/events/${event.id}/instances/20260508-1800`,
    );
    expect(res.status).toBe(200);
    expect(res.body.isCancelled).toBe(true);
  });

  it('returns 200 with end=null for an event whose schedule has no configured duration', async () => {
    const { app, event } = await seedEventFixtureNoDuration({
      startIso: '2026-05-08T18:00:00Z',
    });
    const res = await request(app).get(
      `/api/public/v1/events/${event.id}/instances/20260508-1800`,
    );
    expect(res.status).toBe(200);
    expect(res.body.end).toBeNull();
  });

  it('materializes a new row on first hit for a valid slug with no cached instance', async () => {
    const { app, event } = await seedRecurringEventNoMaterialization({
      firstOccurrenceIso: '2026-05-08T18:00:00Z',
    });

    const slug = '20260508-1800';
    const res = await request(app).get(
      `/api/public/v1/events/${event.id}/instances/${slug}`,
    );

    expect(res.status).toBe(200);
    const row = await EventInstanceEntity.findOne({
      where: { event_id: event.id, start_time: new Date('2026-05-08T18:00:00Z') },
    });
    expect(row).not.toBeNull();
  });

  it('returns 404 for a valid-UUID eventId that does not exist', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get(
      '/api/public/v1/events/00000000-0000-0000-0000-000000000000/instances/20260508-1800',
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-UUID eventId (path traversal attempt)', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get(
      '/api/public/v1/events/..%2Fsecret/instances/20260508-1800',
    );
    expect(res.status).toBe(404);
  });

  it('returns a response body containing exactly the expected allow-listed fields', async () => {
    const { app, event } = await seedEventFixture({ startIso: '2026-05-08T18:00:00Z' });
    const res = await request(app).get(
      `/api/public/v1/events/${event.id}/instances/20260508-1800`,
    );
    expect(res.status).toBe(200);
    // Top-level keys must be a subset of the allow-list. This is the
    // regression guard for future CalendarEventInstance.toObject() additions.
    const allowed = new Set(['id', 'start', 'end', 'isCancelled', 'event']);
    for (const key of Object.keys(res.body)) {
      expect(allowed.has(key)).toBe(true);
    }
    // And event is public-shaped (no schedules leak)
    expect(res.body.event.schedules).toBeUndefined();
  });

  it('concurrent misses for the same uncached slug produce exactly one DB row', async () => {
    const { app, event } = await seedRecurringEventNoMaterialization({
      firstOccurrenceIso: '2026-05-08T18:00:00Z',
    });
    const slug = '20260508-1800';
    const url = `/api/public/v1/events/${event.id}/instances/${slug}`;

    // Fire both requests in parallel. The unique-constraint catch in the
    // service must ensure exactly one row, both responses 200 with the same id.
    const [resA, resB] = await Promise.all([
      request(app).get(url),
      request(app).get(url),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.id).toBe(resB.body.id);

    const rows = await EventInstanceEntity.findAll({
      where: { event_id: event.id, start_time: new Date('2026-05-08T18:00:00Z') },
    });
    expect(rows).toHaveLength(1);
  });

  it('applies the rate limiter: N+1 requests from the same IP within the window return 429', async () => {
    // Read the configured limit; drive exactly that many 200/404s, then expect 429.
    const limit = config.get<number>('rateLimit.publicEventInstance.byIp.max');
    const { app, event } = await seedEventFixture({ startIso: '2026-05-08T18:00:00Z' });
    const url = `/api/public/v1/events/${event.id}/instances/20260508-1800`;

    // Exhaust the limit
    for (let i = 0; i < limit; i++) {
      const res = await request(app).get(url);
      expect([200, 404]).toContain(res.status);
    }
    const blocked = await request(app).get(url);
    expect(blocked.status).toBe(429);
  });
});
```

Adapt fixture/helper names to what the project's existing public integration tests use. If no `seedEventFixture` style helper exists, build up the test data inline using the same patterns you see in the sibling tests.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run <the new test file>`
Expected: FAIL — route 404s or handler not found.

- [ ] **Step 4: Swap the route and handler**

In `src/server/public/api/v1/calendar.ts`:

Replace line 89 (`router.get('/instances/:id', this.getEventInstance.bind(this));`) with a route that first passes through the rate limiter:
```ts
    router.get(
      '/events/:eventId/instances/:startTime',
      publicEventInstanceByIp,
      this.getEventInstance.bind(this),
    );
```

Add the `toPublicInstanceObject` allow-list helper to this file (near `toPublicEventObject` around line 42):

```ts
/**
 * Shapes an instance object for public consumption via an explicit
 * allow-list. Prevents future additions to CalendarEventInstance.toObject()
 * from silently leaking through the public surface.
 */
function toPublicInstanceObject(instance: CalendarEventInstance): Record<string, any> {
  const obj = instance.toObject();
  return {
    id: obj.id,
    start: obj.start,
    end: obj.end,
    isCancelled: obj.isCancelled,
    event: toPublicEventObject(obj.event),
  };
}
```

Replace the `getEventInstance` method (lines 355-371) with:

```ts
  async getEventInstance(req: Request, res: Response) {
    const { eventId, startTime: slug } = req.params;

    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(404).json({
        error: 'instance not found',
        errorName: 'NotFoundError',
      });
      return;
    }

    const startTime = parseInstanceSlug(slug);
    if (!startTime) {
      res.status(404).json({
        error: 'instance not found',
        errorName: 'NotFoundError',
      });
      return;
    }

    const instance = await this.service.getInstanceByStartTime(eventId, startTime);
    if (!instance) {
      res.status(404).json({
        error: 'instance not found',
        errorName: 'NotFoundError',
      });
      return;
    }

    res.json(toPublicInstanceObject(instance));
  }
```

Add the imports at the top of the file:
```ts
import { parseInstanceSlug } from '@/common/utils/instance-slug';
import { publicEventInstanceByIp } from '@/server/common/middleware/rate-limiters';
import ExpressHelper from '@/server/common/helper/express';
import CalendarEventInstance from '@/common/model/event_instance';
```

(Verify the `ExpressHelper` import path by grepping the existing codebase; `src/server/calendar/api/v1/events.ts` already imports it and is a reliable reference for the canonical path.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run <the new test file>`
Expected: PASS (all 6 test cases).

- [ ] **Step 6: Run all public API tests to catch regressions**

Run: `npx vitest run src/server/public/test/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/public/api/v1/calendar.ts <the test file>
git commit -m "feat(public-api): swap /instances/:id for /events/:id/instances/:startTime"
```

---

## Task 6: Meta-Tags Helper Update

**Files:**
- Modify: `src/server/common/helper/meta-tags.ts`
- Modify: `src/server/common/helper/test/meta-tags.test.ts` (if present — otherwise find the existing location; `grep -rn "parseEventPageParams" src/server --include="*.ts"`)

OG/Twitter meta tags are built server-side from the request path. Both the path regex (which currently accepts arbitrary instance segments) and the lookup method need to switch to the timestamp slug.

- [ ] **Step 1: Write the failing test**

Locate the existing meta-tags test file (or create one adjacent to the helper). Add:

```ts
describe('parseEventPageParams (timestamp slug)', () => {
  it('parses a path with a timestamp slug as instanceStartTime', () => {
    const params = parseEventPageParams('/view/mycal/events/event-uuid/20260508-1800');
    expect(params).toEqual({
      calendarUrlName: 'mycal',
      eventId: 'event-uuid',
      instanceStartTime: '20260508-1800',
    });
  });

  it('parses a locale-prefixed path with a timestamp slug', () => {
    const params = parseEventPageParams('/fr/view/mycal/events/event-uuid/20260508-1800');
    expect(params).toEqual({
      calendarUrlName: 'mycal',
      eventId: 'event-uuid',
      instanceStartTime: '20260508-1800',
    });
  });

  it('still parses paths without an instance segment', () => {
    const params = parseEventPageParams('/view/mycal/events/event-uuid');
    expect(params).toEqual({
      calendarUrlName: 'mycal',
      eventId: 'event-uuid',
    });
  });

  it('returns null for paths whose instance segment is not a valid slug', () => {
    expect(parseEventPageParams('/view/mycal/events/event-uuid/not-a-slug')).toBeNull();
    // Per DEC-006, UUID instance slugs are no longer valid.
    expect(parseEventPageParams('/view/mycal/events/event-uuid/00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('rejects over-long calendarUrlName segments', () => {
    const huge = 'a'.repeat(200);
    expect(parseEventPageParams(`/view/${huge}/events/event-uuid`)).toBeNull();
  });
});

describe('buildMetaTagsInternal canonical URL shape', () => {
  it('constructs the instance canonical URL from the slug', async () => {
    // Use the project's existing mock/fixture pattern for the
    // PublicInterfaceHolder and build a minimal event+instance stub that
    // resolves the slug path.
    const tags = await buildMetaTagsViaFixture({
      path: '/view/mycal/events/evt-uuid/20260508-1800',
      baseUrl: 'https://example.test',
    });
    expect(tags!.url).toBe('https://example.test/view/mycal/events/evt-uuid/20260508-1800');
  });

  it('constructs the non-instance canonical URL when no slug is present', async () => {
    const tags = await buildMetaTagsViaFixture({
      path: '/view/mycal/events/evt-uuid',
      baseUrl: 'https://example.test',
    });
    expect(tags!.url).toBe('https://example.test/view/mycal/events/evt-uuid');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run <the meta-tags test file>`
Expected: FAIL — parser still uses the old regex / returns `instanceId`.

- [ ] **Step 3: Update the parser and builder**

In `src/server/common/helper/meta-tags.ts`:

Replace the `EventPageParams` interface (around line 40-44):
```ts
interface EventPageParams {
  calendarUrlName: string;
  eventId: string;
  instanceStartTime?: string;  // yyyymmdd-hhmm slug (UTC)
}
```

Replace the `EVENT_PAGE_RE` regex (line 47):
```ts
// Regex for public event page paths, with optional locale prefix.
// Segment length caps: calendarUrlName ≤ 64 chars (matches calendar.url_name
// column limit), eventId ≤ 36 chars (UUID length). Instance segment, when
// present, must match the yyyymmdd-hhmm slug shape exactly.
const EVENT_PAGE_RE = /^(?:\/[a-z]{2,8})?\/view\/([^/]{1,64})\/events\/([^/]{1,36})(?:\/(\d{8}-\d{4}))?$/i;
```

Replace the `parseEventPageParams` body (lines 62-78):
```ts
export function parseEventPageParams(path: string): EventPageParams | null {
  const match = path.match(EVENT_PAGE_RE);
  if (!match) {
    return null;
  }
  const result: EventPageParams = {
    calendarUrlName: match[1],
    eventId: match[2],
  };
  if (match[3]) {
    result.instanceStartTime = match[3];
  }
  return result;
}
```

Update the `buildMetaTagsInternal` body (around lines 222-235) to look up via the new path:

```ts
  // Fetch calendar
  const calendar = await iface.getCalendarByName(params.calendarUrlName);
  if (!calendar) {
    return null;
  }

  // Fetch event or instance
  let event;
  if (params.instanceStartTime) {
    const startTime = parseInstanceSlug(params.instanceStartTime);
    if (!startTime) {
      return null;
    }
    const instance = await iface.getInstanceByStartTime(params.eventId, startTime);
    if (!instance) {
      return null;
    }
    event = instance.event;
  }
  else {
    event = await iface.getEventById(params.eventId);
    if (!event) {
      return null;
    }
  }
```

Update the canonical-URL construction (around lines 277-281):
```ts
  const canonicalPath = params.instanceStartTime
    ? `/view/${params.calendarUrlName}/events/${params.eventId}/${params.instanceStartTime}`
    : `/view/${params.calendarUrlName}/events/${params.eventId}`;
  const url = `${baseUrl}${canonicalPath}`;
```

Add the import at the top of the file:
```ts
import { parseInstanceSlug } from '@/common/utils/instance-slug';
```

- [ ] **Step 4: Update `PublicInterfaceHolder` typing if needed**

The `iface.getInstanceByStartTime` call must be present on the interface type imported by this helper. Check the type of `publicInterface.current` near the top of the file — it should reference `PublicCalendarInterface` (which now has `getInstanceByStartTime` from Task 4). No further changes unless this helper uses a narrower structural type; in that case, widen it to include the new method.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run <the meta-tags test file>`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/common/helper/meta-tags.ts <the meta-tags test file>
git commit -m "feat(meta-tags): route instance OG meta through timestamp slug"
```

---

## Task 7: Site Service — `loadEventInstance` Signature Change

**Files:**
- Modify: `src/site/service/calendar.ts`
- Modify: `src/site/test/service/calendar.test.ts` (if exists — `ls src/site/test/service/` or `find src/site/test -name "calendar*"`)

Updates the frontend API-call site to hit the new route with the new signature.

- [ ] **Step 1: Locate or write the service test**

Run: `find src/site/test -name 'calendar*.test.ts'`
If a test exists, modify its `loadEventInstance` cases. Otherwise add one modeled on `src/widget/test/` patterns — mock `ModelService.getModel` and assert the URL.

- [ ] **Step 2: Write the failing test**

Example test (adapt to the project's existing style):

```ts
import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import CalendarService from '@/site/service/calendar';
import ModelService from '@/client/service/models';

describe('CalendarService.loadEventInstance', () => {
  it('fetches the instance via the new nested route with timestamp slug', async () => {
    const getModelSpy = vi.spyOn(ModelService, 'getModel').mockResolvedValue({
      id: 'inst-1',
      event: { id: 'evt-1', calendarId: 'cal-1', content: [] },
      calendarId: 'cal-1',
      start: '2026-05-08T18:00:00.000Z',
      end: null,
      isCancelled: false,
    });

    const service = new CalendarService();
    const startTime = DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' });
    await service.loadEventInstance('evt-1', startTime);

    expect(getModelSpy).toHaveBeenCalledWith(
      '/api/public/v1/events/evt-1/instances/20260508-1800',
    );
    getModelSpy.mockRestore();
  });

  it('returns null when the API returns null (404 upstream)', async () => {
    const getModelSpy = vi.spyOn(ModelService, 'getModel').mockResolvedValue(null);
    const service = new CalendarService();
    const startTime = DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' });
    const result = await service.loadEventInstance('evt-1', startTime);
    expect(result).toBeNull();
    getModelSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run <the test file>`
Expected: FAIL — old signature.

- [ ] **Step 4: Update the service method**

In `src/site/service/calendar.ts`, replace `loadEventInstance` (lines 86-100):

```ts
  async loadEventInstance(
    eventId: string,
    startTime: DateTime,
  ): Promise<CalendarEventInstance | null> {
    try {
      const slug = formatInstanceSlug(startTime);
      const instance = await ModelService.getModel(
        `/api/public/v1/events/${eventId}/instances/${slug}`,
      );
      if (instance) {
        const calendarEvent = CalendarEventInstance.fromObject(instance);
        this.eventStore.addEvent(calendarEvent);
        return calendarEvent;
      }
      return null;
    }
    catch (error) {
      console.error('Error loading instance:', error);
      throw error;
    }
  }
```

Add imports at the top of the file:
```ts
import { DateTime } from 'luxon';
import { formatInstanceSlug } from '@/common/utils/instance-slug';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run <the test file>`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/site/service/calendar.ts <the test file if new or modified>
git commit -m "feat(site-service): update loadEventInstance to (eventId, startTime) signature"
```

---

## Task 8: Site Router Update

**Files:**
- Modify: `src/site/app.ts`
- Modify: `src/site/test/router-locale-guard.test.ts`

Replaces the `:instance` path segment (a UUID match-all) with a constrained `:startTime` segment matching the slug regex.

- [ ] **Step 1: Update the test fixtures**

In `src/site/test/router-locale-guard.test.ts`, replace the two route definitions referencing `:event/:instance`:

Before (around lines 41, 46):
```ts
  { path: '/@:calendar/events/:event/:instance', component: StubComponent, name: 'instance' },
  ...
  { path: '/:locale(es)/@:calendar/events/:event/:instance', component: StubComponent },
```

After:
```ts
  { path: '/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: StubComponent, name: 'instance' },
  ...
  { path: '/:locale(es)/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: StubComponent },
```

(If the test also references `/@:calendar` for the non-instance routes and those were already updated to `/view/` in other passes, align accordingly — the key point is the instance segment must use the constrained regex.)

Also update any assertion that navigates to `/events/:event/:instance` to navigate to `/events/:event/20260101-1200` or similar.

- [ ] **Step 2: Update the production router**

In `src/site/app.ts`, replace line 30:
```ts
    { path: '/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: EventInstanceView, name: 'instance' },
```

And line 45:
```ts
      { path: `/:locale(${pattern})/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})`, component: EventInstanceView },
```

- [ ] **Step 3: Run the router-locale-guard test**

Run: `npx vitest run src/site/test/router-locale-guard.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/site/app.ts src/site/test/router-locale-guard.test.ts
git commit -m "feat(site-router): instance segment uses constrained timestamp slug"
```

---

## Task 9: `event-instance.vue` Consumes Slug

**Files:**
- Modify: `src/site/components/event-instance.vue`
- Modify: `src/site/test/components/event-instance.test.ts`

- [ ] **Step 1: Update the component test**

In `src/site/test/components/event-instance.test.ts`, update the route fixture (around line 173) and the mount assertion:

Before:
```ts
    path: '/view/:calendar/events/:event/:instance',
```

After:
```ts
    path: '/view/:calendar/events/:event/:startTime',
```

Any route-params used in the test setup (e.g. `{ instance: 'some-uuid' }`) become `{ startTime: '20260508-1800' }`. Update the mock for `calendarService.loadEventInstance` to assert it's called with `(eventId, DateTime)` rather than `(instanceUuid)`.

Example mock assertion:
```ts
expect(mockLoadEventInstance).toHaveBeenCalledWith(
  'event-id',
  expect.objectContaining({ toMillis: expect.any(Function) }),
);
// Or deeper:
const [, dt] = mockLoadEventInstance.mock.calls[0];
expect(dt.toISO()).toBe('2026-05-08T18:00:00.000Z');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/site/test/components/event-instance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update the component**

In `src/site/components/event-instance.vue`:

Replace line 24 (`const instanceId = route.params.instance;`) with:
```ts
const startTime = parseInstanceSlug(route.params.startTime as string);
```

Replace line 177:
```ts
    if (!startTime) {
      state.notFound = true;
      return;
    }
    state.instance = await calendarService.loadEventInstance(eventId as string, startTime);
```

Add imports at the top of `<script setup>`:
```ts
import { parseInstanceSlug } from '@/common/utils/instance-slug';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/site/test/components/event-instance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/site/components/event-instance.vue src/site/test/components/event-instance.test.ts
git commit -m "feat(site): event-instance view consumes timestamp slug route param"
```

---

## Task 10: `event-card.vue` Emits Slug URL

**Files:**
- Modify: `src/site/components/event-card.vue`
- Modify: `src/site/test/components/event-card.test.ts`

- [ ] **Step 1: Update the component test**

In `src/site/test/components/event-card.test.ts`, update the route fixture (around line 131) and the detail-path assertion:

Before (route):
```ts
      { path: '/view/:calendar/events/:event/:instance', component: { template: '<div />' }, name: 'instance' },
```

After:
```ts
      { path: '/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: { template: '<div />' }, name: 'instance' },
```

Update the href assertion. Example:
```ts
const instance = CalendarEventInstance.fromObject({
  id: 'inst-1',
  event: { id: 'evt-1', calendarId: 'cal-1', content: [] },
  calendarId: 'cal-1',
  start: '2026-05-08T18:00:00.000Z',
  end: null,
  isCancelled: false,
});

const wrapper = mount(EventCard, { props: { instance, calendarUrlName: 'mycal' }, global: { plugins: [router] } });
expect(wrapper.find('a').attributes('href')).toContain('/view/mycal/events/evt-1/20260508-1800');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/site/test/components/event-card.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `event-card.vue` detailPath computed**

In `src/site/components/event-card.vue`, replace lines 121-127:

```ts
const detailPath = computed(() => {
  const eventId = props.instance.event.id;
  const slug = formatInstanceSlug(props.instance.start);
  return localizedPath(
    `/view/${props.calendarUrlName}/events/${eventId}/${slug}`,
  );
});
```

Add import at the top of `<script setup>`:
```ts
import { formatInstanceSlug } from '@/common/utils/instance-slug';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/site/test/components/event-card.test.ts`
Expected: PASS.

- [ ] **Step 5: Check for any other site-side emitters of instance URLs**

Run: `grep -rn 'events/.*[{$]' src/site --include="*.vue" --include="*.ts" | grep -v /test/`
Expected: no instance-URL builders other than `event-card.vue:125` (already updated) and the router config (already updated in Task 8).

If any other emitters are found (e.g. share buttons, share-to-friend helpers), apply the same `formatInstanceSlug` transformation — keep the change scoped to that emitter and add a one-line test covering the new URL shape.

- [ ] **Step 6: Commit**

```bash
git add src/site/components/event-card.vue src/site/test/components/event-card.test.ts
git commit -m "feat(site): event-card links use timestamp slug"
```

---

## Task 11: Widget Router — Optional Slug Segment

**Files:**
- Modify: `src/widget/router.ts`
- Modify: `src/widget/test/widgetApp.test.ts`, `src/widget/test/event-detail-overlay.test.ts`, `src/widget/components/test/viewComponents.test.ts`

The widget's existing route is unchanged for non-occurrence-aware callers; a new optional segment carries slug when present.

- [ ] **Step 1: Update the three widget test files' route fixtures**

In each of:
- `src/widget/test/widgetApp.test.ts:19`
- `src/widget/test/event-detail-overlay.test.ts:131`
- `src/widget/components/test/viewComponents.test.ts:38`

Replace the route path `'/widget/:urlName/events/:eventId'` with:
```ts
'/widget/:urlName/events/:eventId/:startTime(\\d{8}-\\d{4})?'
```

- [ ] **Step 2: Update the production router**

In `src/widget/router.ts`, replace line 26:
```ts
    path: '/widget/:urlName/events/:eventId/:startTime(\\d{8}-\\d{4})?',
```

- [ ] **Step 3: Run widget router tests**

Run: `npx vitest run src/widget/test/`
Expected: PASS (tests pre-existing behavior; the optional segment should not break non-slug navigation).

- [ ] **Step 4: Commit**

```bash
git add src/widget/router.ts src/widget/test/widgetApp.test.ts \
        src/widget/test/event-detail-overlay.test.ts \
        src/widget/components/test/viewComponents.test.ts
git commit -m "feat(widget-router): add optional startTime segment for occurrence deep links"
```

---

## Task 12: Widget Navigation Emits Slug

**Files:**
- Modify: `src/widget/components/month-view.vue`
- Modify: `src/widget/components/week-view.vue`
- Modify: `src/widget/test/*` (whichever file asserts `openEvent` behavior)

- [ ] **Step 1: Write/update the failing test**

Find an existing test that asserts `openEvent` (most likely `src/widget/test/viewComponents.test.ts` or similar) and update it to expect the `startTime` param. If no such test exists, add one:

```ts
it('openEvent pushes a route with the instance startTime slug', async () => {
  // ... mount month-view with a week/month fixture containing one instance ...
  const router = { push: vi.fn() };
  const instance = CalendarEventInstance.fromObject({
    id: 'inst-1',
    event: { id: 'evt-1', calendarId: 'cal-1', content: [] },
    calendarId: 'cal-1',
    start: '2026-05-08T18:00:00.000Z',
    end: null,
    isCancelled: false,
  });

  // trigger openEvent(instance)
  // ...
  expect(router.push).toHaveBeenCalledWith({
    name: 'widget-event-detail',
    params: {
      urlName: 'mycal',
      eventId: 'evt-1',
      startTime: '20260508-1800',
    },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/widget/test/ src/widget/components/test/`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Update `openEvent` in both views**

In `src/widget/components/month-view.vue` (around lines 138-146):

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

Add import at the top of `<script setup>`:
```ts
import { formatInstanceSlug } from '@/common/utils/instance-slug';
```

In `src/widget/components/week-view.vue` (around lines 81-88), apply the same change. Add the same import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/widget/test/ src/widget/components/test/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widget/components/month-view.vue src/widget/components/week-view.vue \
        src/widget/test/ src/widget/components/test/
git commit -m "feat(widget): navigation carries instance startTime slug"
```

---

## Task 13: Widget Overlay — Branch on Slug Presence

**Files:**
- Modify: `src/widget/components/event-detail-overlay.vue`
- Modify: `src/widget/test/event-detail-overlay.test.ts`

Replaces the brittle "list all events then find by eventId" logic with a direct instance fetch when `startTime` is present. Falls back to the existing event-only fetch when it is not (preserves the route's optional-segment contract).

- [ ] **Step 1: Write the failing test**

In `src/widget/test/event-detail-overlay.test.ts`, add a test that routes to a path containing the slug and asserts the overlay calls `loadEventInstance(eventId, startTime)` directly (no full event list fetch):

```ts
it('fetches the instance directly when startTime is present in the route', async () => {
  const loadEventInstanceSpy = vi.spyOn(CalendarService.prototype, 'loadEventInstance')
    .mockResolvedValue({
      id: 'inst-1',
      event: { id: 'evt-1', content: () => ({ name: 'Test' }) },
      start: DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' }),
      end: null,
      isCancelled: false,
    } as any);

  const loadCalendarEventsSpy = vi.spyOn(CalendarService.prototype, 'loadCalendarEvents');

  // mount overlay at route /widget/mycal/events/evt-1/20260508-1800
  // ...

  await flushPromises();

  expect(loadEventInstanceSpy).toHaveBeenCalledWith(
    'evt-1',
    expect.objectContaining({ toMillis: expect.any(Function) }),
  );
  expect(loadCalendarEventsSpy).not.toHaveBeenCalled();

  loadEventInstanceSpy.mockRestore();
  loadCalendarEventsSpy.mockRestore();
});

it('falls back to the event list scan when startTime is absent', async () => {
  // mount overlay at route /widget/mycal/events/evt-1 (no slug)
  // expect loadCalendarEvents called, loadEventInstance NOT called
});

it('shows not-found when startTime is present but semantically invalid', async () => {
  const loadEventInstanceSpy = vi.spyOn(CalendarService.prototype, 'loadEventInstance');
  const loadCalendarEventsSpy = vi.spyOn(CalendarService.prototype, 'loadCalendarEvents');

  // Mount overlay at route /widget/mycal/events/evt-1/20261301-2500
  // The router regex accepts the structural shape, but parseInstanceSlug
  // rejects the semantics. The overlay must short-circuit to not-found.
  // ...

  await flushPromises();

  // wrapper assertion for not-found state rendering — adapt to the existing
  // not-found test helpers in this file
  // expect(wrapper.find('.not-found').exists()).toBe(true);
  expect(loadEventInstanceSpy).not.toHaveBeenCalled();
  expect(loadCalendarEventsSpy).not.toHaveBeenCalled();

  loadEventInstanceSpy.mockRestore();
  loadCalendarEventsSpy.mockRestore();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/widget/test/event-detail-overlay.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update the overlay component**

In `src/widget/components/event-detail-overlay.vue`:

Replace the route-param reads (lines 24-25):
```ts
const calendarId = route.params.urlName;
const eventId = route.params.eventId;
const startTimeSlug = route.params.startTime as string | undefined;
```

Replace the `onBeforeMount` body (lines 113-147) with:

```ts
onBeforeMount(async () => {
  try {
    state.isLoading = true;

    state.calendar = await calendarService.getCalendarByUrlName(calendarId as string);
    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    if (startTimeSlug) {
      const startTime = parseInstanceSlug(startTimeSlug);
      if (!startTime) {
        state.notFound = true;
        return;
      }
      const instance = await calendarService.loadEventInstance(
        eventId as string,
        startTime,
      );
      if (!instance) {
        state.notFound = true;
        return;
      }
      state.instance = instance;
    }
    else {
      // Fallback path: no occurrence context — load the event list and pick
      // the first instance whose event matches. The list response already
      // contains the fields the overlay needs (event, start/end, cancellation
      // flag), so no second detail fetch is required here. This preserves
      // pre-existing behavior for embeds that link to the event without a
      // specific occurrence.
      const events = await calendarService.loadCalendarEvents(calendarId as string);
      const match = events.find((e: any) => e.event.id === eventId);
      if (!match) {
        state.notFound = true;
        return;
      }
      state.instance = match;
    }
  }
  catch (error) {
    console.error('Error loading event data:', error);
    state.err = t('error_load_event');
  }
  finally {
    state.isLoading = false;
  }
});
```

Add imports at the top of `<script setup>`:
```ts
import { parseInstanceSlug } from '@/common/utils/instance-slug';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/widget/test/event-detail-overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widget/components/event-detail-overlay.vue \
        src/widget/test/event-detail-overlay.test.ts
git commit -m "feat(widget-overlay): fetch instance directly when startTime is present"
```

---

## Task 14: Full Regression Pass + E2E

**Files:**
- (no file changes; validation only)

- [ ] **Step 1: Run the full unit/integration test suite**

Run: `npm test`
Expected: PASS (all unit + integration tests).

If anything fails that you didn't change, investigate — is it a latent regression exposed by the new data path, or a test-only artifact? Fix root-causes; don't silence.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS (no new warnings attributable to this work).

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual browser smoke test via dev server**

```bash
npm run dev
```

Log in at `admin@pavillion.dev / admin`. In a second tab:

1. Open any public calendar view, e.g. `http://localhost:3000/view/<calendar-url-name>`.
2. Click into any occurrence on the listing. Verify the URL becomes `/view/<calendar>/events/<event-id>/20261234-5678` (actual slug). Verify the page renders correctly.
3. Copy the URL into a new tab, reload, verify it still renders.
4. Manually munge the slug to something invalid (e.g. `20269999-2599`); verify the page shows the not-found state rather than throwing.
5. Open the widget at `http://localhost:3000/widget/<calendar-url-name>`. Click an occurrence. Verify the URL includes the slug segment and the overlay shows the occurrence-specific date.

- [ ] **Step 5: Run existing single-instance e2e**

Run: `npm run test:e2e`
Expected: PASS. If a scenario fails because it hard-coded the old instance-URL shape, update the e2e fixture to navigate via listing → click → capture URL rather than constructing the URL.

- [ ] **Step 6: Commit any e2e fixture fixes**

```bash
git add <any e2e files modified in step 5>
git commit -m "test(e2e): update fixtures for instance timestamp slug"
```

---

## Completion Checklist

- [ ] All 14 numbered tasks (plus Task 1a, 2a, 4a) committed
- [ ] Public route `GET /api/public/v1/events/:eventId/instances/:startTime` returns 200 for valid, 404 for invalid/malformed/hidden/nonexistent
- [ ] `GET /api/public/v1/instances/:id` no longer exists (grep confirms no references)
- [ ] Rate limiter `publicEventInstanceByIp` installed on the new route; config entries present
- [ ] `ExpressHelper.isValidUUID` validates `:eventId` before service call
- [ ] `toPublicInstanceObject` allow-list is the sole path to a public instance response body
- [ ] Service has pre-flight horizon guard for unbounded schedules + materialization cap
- [ ] Shared helpers `hydrateInstanceEntity` and `computeOccurrenceEndTime` are referenced by both old and new callers (no parallel implementations)
- [ ] `addIndexIfNotExists` helper in `src/server/common/migrations/helpers.ts`; migration uses it
- [ ] Site URL `/view/:calendar/events/:event/<yyyymmdd-hhmm>` renders the event detail; invalid slug 404s
- [ ] Widget URL `/widget/:urlName/events/:eventId/<slug>` renders; non-slug `/widget/:urlName/events/:eventId` still works (no redundant detail fetch on fallback)
- [ ] Unique DB index on `event_instance(event_id, start_time)` present
- [ ] Lint + tsc clean
- [ ] Full test suite passes, including the real-DB concurrent-miss race test
- [ ] Manual smoke verified in browser
