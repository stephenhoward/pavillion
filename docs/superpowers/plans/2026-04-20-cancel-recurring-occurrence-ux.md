# Cancel Recurring Occurrence UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the cancellations panel UX from the 6-month materialization horizon so calendar owners can cancel any future occurrence of a recurring event, including yearly/monthly occurrences far beyond the current instance cache.

**Architecture:** Three new server endpoints expose RRuleSet-expanded occurrences and date-based cancel/restore. The client panel is rewritten as a horizontal scroll-snapping card row with trailing "Jump to month" and "Show more" cards that drive additive fetches from the new occurrences endpoint. Old instance-ID-based endpoints, service methods, and client service methods are deleted in a final cleanup pass after the new path is wired end-to-end.

**Tech Stack:** TypeScript, Express.js, Sequelize, Vue 3 `<script setup>`, Pinia, i18next, SCSS, Vitest, Supertest, `@vue/test-utils`, `luxon`, `rrule`.

**Spec reference:** `docs/superpowers/specs/2026-04-20-cancel-recurring-occurrence-ux-design.md`

---

## Phase 1 — Backend: additive new API

Add the new endpoints and service methods alongside the old ones. Everything remains green. Old consumers keep working.

---

### Task 1: Add `InvalidOccurrenceDateError` exception

**Files:**
- Modify: `src/common/exceptions/calendar.ts` (append new class at end of file)

- [ ] **Step 1: Add the exception class**

Append to `src/common/exceptions/calendar.ts`:

```typescript
/**
 * Thrown when a supplied date does not match any occurrence of the event's
 * recurrence rule. Surfaced by the date-based cancel endpoint when the caller
 * passes a date that is not actually produced by the event's schedules.
 */
export class InvalidOccurrenceDateError extends Error {
  constructor(message: string = 'Supplied date does not match any occurrence of this event') {
    super(message);
    this.name = 'InvalidOccurrenceDateError';
    Object.setPrototypeOf(this, InvalidOccurrenceDateError.prototype);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/common/exceptions/calendar.ts
git commit -m "feat(calendar): add InvalidOccurrenceDateError exception"
```

---

### Task 2: `listUpcomingOccurrences` service method — tests first

**Files:**
- Test: `src/server/calendar/test/service/event_instance.test.ts` (append new `describe` block)
- Modify: `src/server/calendar/service/event_instance.ts`

- [ ] **Step 1: Write failing tests for weekly-event happy path**

Locate the final top-level `describe` in `src/server/calendar/test/service/event_instance.test.ts`. After the existing `cancelInstance` / `restoreInstance` describes, add:

```typescript
describe('listUpcomingOccurrences', () => {
  it('returns the next N occurrences for a weekly event starting at afterDate', async () => {
    // Use the same test event factory the file already uses above —
    // refer to existing describes for buildRecurringEvent / fixtures.
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });

    const after = DateTime.fromISO('2026-05-04T00:00:00Z', { zone: 'utc' });
    const result = await service.listUpcomingOccurrences(event, after, 5);

    expect(result.occurrences).toHaveLength(5);
    expect(result.occurrences[0].start.toISO()).toBe('2026-05-04T10:00:00.000Z');
    expect(result.occurrences[4].start.toISO()).toBe('2026-06-01T10:00:00.000Z');
    expect(result.occurrences.every(o => o.state === 'active')).toBe(true);
    expect(result.hasMore).toBe(true);
  });
});
```

> If the existing file has no `buildWeeklyEventFixture` helper, replicate the fixture pattern used by the nearby `cancelInstance` tests. Copy whichever fixture creates an event whose `schedules` array contains one weekly schedule with `is_exclusion=false`. Do not invent a new helper unless one does not exist.

- [ ] **Step 2: Run the test and verify failure**

```bash
npx vitest run src/server/calendar/test/service/event_instance.test.ts -t 'listUpcomingOccurrences'
```

Expected: FAIL with `service.listUpcomingOccurrences is not a function`.

- [ ] **Step 3: Implement `listUpcomingOccurrences`**

Add to `src/server/calendar/service/event_instance.ts` below `generateInstances`:

```typescript
/**
 * DTO returned by listUpcomingOccurrences. Plain data shape — not a model.
 */
export interface UpcomingOccurrence {
  start: DateTime;
  state: 'active' | 'cancelled-shown' | 'hidden';
  scheduleId: string | null;
}

export interface UpcomingOccurrencesResult {
  occurrences: UpcomingOccurrence[];
  hasMore: boolean;
}

/**
 * Expands the event's RRuleSet beyond the materialization horizon to return
 * a window of upcoming occurrences. Differs from buildEventInstances in two
 * ways:
 *   1. Does not persist — results are transient DTOs for UI consumption.
 *   2. Not bound by GENERATION_HORIZON_MONTHS — the caller supplies the
 *      window via (afterDate, limit).
 *
 * Each occurrence is tagged with a state:
 *   - 'active': produced by the rrule, no matching exclusion row
 *   - 'cancelled-shown': produced by the rrule, matching exclusion row with
 *                        hide_from_public=false
 *   - 'hidden': matching exclusion row with hide_from_public=true (absent
 *               from the RRuleSet output but surfaced in results so the
 *               owner can see and restore it)
 *
 * @param event - The recurring event; its schedules must be loaded
 * @param afterDate - Occurrences with start > afterDate are included
 * @param limit - Maximum occurrences to return (1..50)
 * @returns Occurrences with state flags and a hasMore indicator
 */
async listUpcomingOccurrences(
  event: CalendarEvent,
  afterDate: DateTime,
  limit: number,
): Promise<UpcomingOccurrencesResult> {
  const rruleSet = this.rrules(event);

  // Pull limit + 1 to compute hasMore. rrule's `after` takes a JS Date and
  // inc=false (strictly greater than). Walk forward in a bounded loop.
  const produced: Date[] = [];
  let cursor = afterDate.toJSDate();
  for (let i = 0; i <= limit; i++) {
    const next = rruleSet.after(cursor, false);
    if (!next) break;
    produced.push(next);
    cursor = next;
  }
  const hasMoreFromRrule = produced.length > limit;
  const rruleDates = produced.slice(0, limit);

  // Collect hidden-cancellation dates after afterDate; they are not in the
  // RRuleSet output (exrule/exdate suppressed them) but we want the user to
  // see and restore them.
  const afterMs = afterDate.toMillis();
  const hiddenSchedules = (event.schedules ?? []).filter(s =>
    s.isExclusion && s.hideFromPublic && s.startDate
      && s.startDate.toMillis() > afterMs,
  );

  // Build unified set, dedupe by ms timestamp (hidden dates should never
  // appear in rruleDates, but guard defensively).
  const byMs = new Map<number, UpcomingOccurrence>();
  for (const d of rruleDates) {
    const start = DateTime.fromJSDate(d).toUTC();
    byMs.set(start.toMillis(), { start, state: 'active', scheduleId: null });
  }
  // Tag shown cancellations: the underlying rrule-produced date whose start
  // matches a shown-exclusion schedule.
  for (const schedule of event.schedules ?? []) {
    if (!schedule.isExclusion || schedule.hideFromPublic || !schedule.startDate) continue;
    const ms = schedule.startDate.toUTC().toMillis();
    if (byMs.has(ms)) {
      byMs.set(ms, {
        start: schedule.startDate.toUTC(),
        state: 'cancelled-shown',
        scheduleId: schedule.id ?? null,
      });
    }
  }
  for (const schedule of hiddenSchedules) {
    const start = schedule.startDate!.toUTC();
    byMs.set(start.toMillis(), {
      start,
      state: 'hidden',
      scheduleId: schedule.id ?? null,
    });
  }

  // Sort and truncate to `limit`. hasMore is true if the RRule produced more
  // than limit OR any hidden schedule fell outside the first `limit` slots.
  const merged = Array.from(byMs.values()).sort(
    (a, b) => a.start.toMillis() - b.start.toMillis(),
  );
  const occurrences = merged.slice(0, limit);
  const hasMore = hasMoreFromRrule || merged.length > limit;

  return { occurrences, hasMore };
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npx vitest run src/server/calendar/test/service/event_instance.test.ts -t 'listUpcomingOccurrences'
```

Expected: PASS.

- [ ] **Step 5: Add tests for remaining cases**

Append inside the same `describe('listUpcomingOccurrences', ...)` block:

```typescript
it('honors afterDate cursor by excluding occurrences <= afterDate', async () => {
  const event = await buildWeeklyEventFixture({
    startIso: '2026-05-04T10:00:00Z',
    byDay: ['MO'],
  });

  // afterDate = second occurrence's start. Result must start at third.
  const after = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
  const result = await service.listUpcomingOccurrences(event, after, 3);

  expect(result.occurrences[0].start.toISO()).toBe('2026-05-18T10:00:00.000Z');
});

it('returns hasMore=false for a bounded recurrence whose count < limit', async () => {
  const event = await buildWeeklyEventFixture({
    startIso: '2026-05-04T10:00:00Z',
    byDay: ['MO'],
    count: 3,
  });

  const after = DateTime.fromISO('2026-05-03T00:00:00Z', { zone: 'utc' });
  const result = await service.listUpcomingOccurrences(event, after, 10);

  expect(result.occurrences).toHaveLength(3);
  expect(result.hasMore).toBe(false);
});

it('tags a shown-cancellation occurrence with state=cancelled-shown and its scheduleId', async () => {
  const event = await buildWeeklyEventFixture({
    startIso: '2026-05-04T10:00:00Z',
    byDay: ['MO'],
  });
  // Add a shown exclusion for the second occurrence (2026-05-11T10:00Z).
  const shown = await EventScheduleEntity.create({
    id: 'shown-excl-id-0000',
    event_id: event.id,
    timezone: 'UTC',
    start_date: new Date('2026-05-11T10:00:00Z'),
    end_date: null,
    event_end_time: null,
    frequency: null,
    interval: 0,
    count: 0,
    by_day: '',
    is_exclusion: true,
    hide_from_public: false,
  });
  event.schedules.push(shown.toModel());

  const after = DateTime.fromISO('2026-05-03T00:00:00Z', { zone: 'utc' });
  const result = await service.listUpcomingOccurrences(event, after, 3);

  const target = result.occurrences.find(o => o.start.toISO() === '2026-05-11T10:00:00.000Z');
  expect(target?.state).toBe('cancelled-shown');
  expect(target?.scheduleId).toBe('shown-excl-id-0000');
});

it('surfaces a hidden-cancellation date with state=hidden even though rrule suppresses it', async () => {
  const event = await buildWeeklyEventFixture({
    startIso: '2026-05-04T10:00:00Z',
    byDay: ['MO'],
  });
  const hidden = await EventScheduleEntity.create({
    id: 'hidden-excl-id-000',
    event_id: event.id,
    timezone: 'UTC',
    start_date: new Date('2026-05-11T10:00:00Z'),
    end_date: null,
    event_end_time: null,
    frequency: null,
    interval: 0,
    count: 0,
    by_day: '',
    is_exclusion: true,
    hide_from_public: true,
  });
  event.schedules.push(hidden.toModel());

  const after = DateTime.fromISO('2026-05-03T00:00:00Z', { zone: 'utc' });
  const result = await service.listUpcomingOccurrences(event, after, 3);

  const target = result.occurrences.find(o => o.start.toISO() === '2026-05-11T10:00:00.000Z');
  expect(target?.state).toBe('hidden');
  expect(target?.scheduleId).toBe('hidden-excl-id-000');
});
```

- [ ] **Step 6: Run all new tests**

```bash
npx vitest run src/server/calendar/test/service/event_instance.test.ts -t 'listUpcomingOccurrences'
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/calendar/service/event_instance.ts \
        src/server/calendar/test/service/event_instance.test.ts
git commit -m "feat(calendar): add listUpcomingOccurrences service method"
```

---

### Task 3: Date-based cancel/restore helpers + methods — tests first

**Files:**
- Test: `src/server/calendar/test/service/event_instance.test.ts`
- Modify: `src/server/calendar/service/event_instance.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/server/calendar/test/service/event_instance.test.ts`:

```typescript
describe('cancelOccurrenceByDate', () => {
  it('creates an exclusion row when the date matches an rrule occurrence', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const account = await buildEditorAccountFixture(event.calendarId);

    // Second Monday — falls on the rrule.
    const date = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    await service.cancelOccurrenceByDate(account, event.id, date, false);

    const row = await EventScheduleEntity.findOne({
      where: { event_id: event.id, start_date: date.toJSDate(), is_exclusion: true },
    });
    expect(row).not.toBeNull();
    expect(row!.hide_from_public).toBe(false);
  });

  it('throws InvalidOccurrenceDateError when the date does not match the rrule', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',  // Monday
      byDay: ['MO'],
    });
    const account = await buildEditorAccountFixture(event.calendarId);

    // 2026-05-14 is a Thursday — event is Mondays only.
    const date = DateTime.fromISO('2026-05-14T10:00:00Z', { zone: 'utc' });
    await expect(
      service.cancelOccurrenceByDate(account, event.id, date, false),
    ).rejects.toMatchObject({ name: 'InvalidOccurrenceDateError' });
  });

  it('is idempotent when cancelling the same date with the same mode', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const account = await buildEditorAccountFixture(event.calendarId);

    const date = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    await service.cancelOccurrenceByDate(account, event.id, date, false);
    await service.cancelOccurrenceByDate(account, event.id, date, false);

    const rows = await EventScheduleEntity.findAll({
      where: { event_id: event.id, start_date: date.toJSDate(), is_exclusion: true },
    });
    expect(rows).toHaveLength(1);
  });

  it('flips hide_from_public when re-cancelled in a different mode', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const account = await buildEditorAccountFixture(event.calendarId);

    const date = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    await service.cancelOccurrenceByDate(account, event.id, date, false);
    await service.cancelOccurrenceByDate(account, event.id, date, true);

    const row = await EventScheduleEntity.findOne({
      where: { event_id: event.id, start_date: date.toJSDate(), is_exclusion: true },
    });
    expect(row!.hide_from_public).toBe(true);
  });

  it('throws InsufficientCalendarPermissionsError for non-editor accounts', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const strangerAccount = await buildNonEditorAccountFixture();

    const date = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    await expect(
      service.cancelOccurrenceByDate(strangerAccount, event.id, date, false),
    ).rejects.toMatchObject({ name: 'InsufficientCalendarPermissionsError' });
  });

  it('emits eventInstanceCancelled with optional instanceId absent', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const account = await buildEditorAccountFixture(event.calendarId);

    const date = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    await service.cancelOccurrenceByDate(account, event.id, date, false);

    const payload = emitSpy.getCalls().find(c => c.args[0] === 'eventInstanceCancelled')!.args[1];
    expect(payload.instanceId).toBeUndefined();
    expect(payload.event.id).toBe(event.id);
  });
});

describe('restoreOccurrenceByDate', () => {
  it('deletes the exclusion row for the date when one exists', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const account = await buildEditorAccountFixture(event.calendarId);

    const date = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    await service.cancelOccurrenceByDate(account, event.id, date, false);

    await service.restoreOccurrenceByDate(account, event.id, date);

    const row = await EventScheduleEntity.findOne({
      where: { event_id: event.id, start_date: date.toJSDate(), is_exclusion: true },
    });
    expect(row).toBeNull();
  });

  it('is a silent no-op when no exclusion row exists for the date', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const account = await buildEditorAccountFixture(event.calendarId);

    const date = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    await expect(
      service.restoreOccurrenceByDate(account, event.id, date),
    ).resolves.not.toThrow();
  });

  it('does not validate rrule match for restore (accepts any date)', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const account = await buildEditorAccountFixture(event.calendarId);

    // Thursday — not on rrule, but restore should not throw.
    const date = DateTime.fromISO('2026-05-14T10:00:00Z', { zone: 'utc' });
    await expect(
      service.restoreOccurrenceByDate(account, event.id, date),
    ).resolves.not.toThrow();
  });

  it('throws InsufficientCalendarPermissionsError for non-editor accounts', async () => {
    const event = await buildWeeklyEventFixture({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    const strangerAccount = await buildNonEditorAccountFixture();

    const date = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    await expect(
      service.restoreOccurrenceByDate(strangerAccount, event.id, date),
    ).rejects.toMatchObject({ name: 'InsufficientCalendarPermissionsError' });
  });
});
```

> The fixture helpers `buildWeeklyEventFixture`, `buildEditorAccountFixture`, and `buildNonEditorAccountFixture` should already exist in or near the top of the test file used by the `cancelInstance` / `restoreInstance` describes. Reuse them. If `buildNonEditorAccountFixture` does not exist, create an account without editor permission the same way the existing `cancelInstance` non-editor test does — copy that pattern verbatim rather than inventing a new helper.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/server/calendar/test/service/event_instance.test.ts -t 'cancelOccurrenceByDate|restoreOccurrenceByDate'
```

Expected: FAIL with `service.cancelOccurrenceByDate is not a function`.

- [ ] **Step 3: Extract shared helpers and add the new service methods**

In `src/server/calendar/service/event_instance.ts`:

1. Import the new exception at the top:

```typescript
import {
  EventNotFoundError,
  InsufficientCalendarPermissionsError,
  InvalidOccurrenceDateError,
} from '@/common/exceptions/calendar';
```

2. Add three private helpers just above `cancelInstance`:

```typescript
/**
 * Loads the event and confirms the caller has editor permission on the
 * owning calendar. Returns the resolved { event, calendar } pair; throws
 * EventNotFoundError / InsufficientCalendarPermissionsError otherwise.
 */
private async loadEventForEditor(account: Account, eventId: string): Promise<{ event: CalendarEvent; calendar: Calendar }> {
  const eventEntity = await EventEntity.findByPk(eventId, {
    include: [EventScheduleEntity],
  });
  if (!eventEntity || !eventEntity.calendar_id) {
    throw new EventNotFoundError('Event not found');
  }

  const calendar = await this.calendarService.getCalendar(eventEntity.calendar_id);
  if (!calendar) {
    throw new EventNotFoundError('Event not found');
  }

  const calendars = await this.calendarService.editableCalendarsForUser(account);
  if (!calendars.some(c => c.id === calendar.id)) {
    throw new InsufficientCalendarPermissionsError(
      'Insufficient permissions to modify events in this calendar',
    );
  }

  const event = eventEntity.toModel();
  const scheduleEntities = (eventEntity.getDataValue('schedules') ?? []) as EventScheduleEntity[];
  event.schedules = scheduleEntities.map(s => s.toModel());
  return { event, calendar };
}

/**
 * Core idempotent write: find-or-create / flip-in-place an exclusion
 * schedule row anchored on startDate. Returns true if a change was made,
 * false if the row already matched and nothing was written.
 */
private async writeExclusionRow(
  eventId: string,
  startDate: Date,
  hideFromPublic: boolean,
): Promise<boolean> {
  const existing = await EventScheduleEntity.findOne({
    where: { event_id: eventId, start_date: startDate, is_exclusion: true },
  });
  if (existing) {
    if (existing.hide_from_public === hideFromPublic) {
      return false;
    }
    existing.hide_from_public = hideFromPublic;
    await existing.save();
    return true;
  }
  const row = EventScheduleEntity.build({
    id: uuidv4(),
    event_id: eventId,
    timezone: 'UTC',
    start_date: startDate,
    end_date: null,
    event_end_time: null,
    frequency: null,
    interval: 0,
    count: 0,
    by_day: '',
    is_exclusion: true,
    hide_from_public: hideFromPublic,
  });
  await row.save();
  return true;
}

/**
 * Core delete: remove an exclusion schedule row anchored on startDate.
 * Returns true if a row was removed, false if nothing matched.
 */
private async deleteExclusionRow(eventId: string, startDate: Date): Promise<boolean> {
  const existing = await EventScheduleEntity.findOne({
    where: { event_id: eventId, start_date: startDate, is_exclusion: true },
  });
  if (!existing) return false;
  await existing.destroy();
  return true;
}

/**
 * Validates that startDate coincides with an actual occurrence produced by
 * the event's RRuleSet. Exclusion schedules that are themselves the shown
 * cancellation for this date do NOT count — we need to confirm the
 * underlying rule produces the date. Throws InvalidOccurrenceDateError
 * otherwise.
 */
private assertDateMatchesOccurrence(event: CalendarEvent, startDate: DateTime): void {
  const rruleSet = this.rrules(event);
  const ms = startDate.toUTC().toMillis();
  // Check a ±1ms window to accommodate tiny fp/ms rounding from DateTime <-> Date.
  const hits = rruleSet.between(
    new Date(ms - 1),
    new Date(ms + 1),
    true,
  );
  if (hits.length === 0) {
    throw new InvalidOccurrenceDateError();
  }
}
```

3. Add the two public methods just above `cancelInstance`:

```typescript
/**
 * Date-based cancellation. Same semantics as cancelInstance but keyed by
 * an ISO occurrence start rather than a materialized instance ID —
 * decouples the UI from the materialization horizon.
 *
 * @param account - Authenticated account (must be calendar editor)
 * @param eventId - The owning event ID
 * @param startDate - Occurrence start datetime; must match the rrule
 * @param hideFromPublic - true for EXDATE-style hidden, false for shown
 */
async cancelOccurrenceByDate(
  account: Account,
  eventId: string,
  startDate: DateTime,
  hideFromPublic: boolean,
): Promise<void> {
  const { event, calendar } = await this.loadEventForEditor(account, eventId);
  this.assertDateMatchesOccurrence(event, startDate);

  const changed = await this.writeExclusionRow(
    eventId,
    startDate.toUTC().toJSDate(),
    hideFromPublic,
  );
  if (!changed) {
    logger.info(
      { calendarId: calendar.id, eventId, startDate: startDate.toISO(), hideFromPublic },
      'cancelOccurrenceByDate no-op: existing cancellation matches requested mode',
    );
    return;
  }

  logger.info(
    { calendarId: calendar.id, eventId, startDate: startDate.toISO(), hideFromPublic },
    'Cancelled event occurrence by date',
  );

  this.eventBus.emit('eventInstanceCancelled', {
    calendar,
    event,
    hideFromPublic,
  });
}

/**
 * Date-based restore. Deletes the exclusion row for the given start date
 * if one exists; silent no-op otherwise. Does not validate that the date
 * matches an occurrence — restoring a non-existent row is harmless.
 */
async restoreOccurrenceByDate(
  account: Account,
  eventId: string,
  startDate: DateTime,
): Promise<void> {
  const { event, calendar } = await this.loadEventForEditor(account, eventId);

  const removed = await this.deleteExclusionRow(eventId, startDate.toUTC().toJSDate());

  logger.info(
    { calendarId: calendar.id, eventId, startDate: startDate.toISO(), removed },
    'Restored event occurrence by date',
  );

  if (removed) {
    this.eventBus.emit('eventInstanceRestored', {
      calendar,
      event,
    });
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx vitest run src/server/calendar/test/service/event_instance.test.ts -t 'cancelOccurrenceByDate|restoreOccurrenceByDate'
```

Expected: all PASS.

- [ ] **Step 5: Run the full service test file to confirm no regressions**

```bash
npx vitest run src/server/calendar/test/service/event_instance.test.ts
```

Expected: all PASS (existing `cancelInstance` / `restoreInstance` tests still green — we did not touch those methods).

- [ ] **Step 6: Commit**

```bash
git add src/server/calendar/service/event_instance.ts \
        src/server/calendar/test/service/event_instance.test.ts
git commit -m "feat(calendar): add date-based cancel/restore occurrence service methods"
```

---

### Task 4: Expose new service methods + DTO on the calendar interface

**Files:**
- Modify: `src/server/calendar/interface/index.ts`

- [ ] **Step 1: Re-export the new DTO types**

Near the top of `src/server/calendar/interface/index.ts` add:

```typescript
export type { UpcomingOccurrence, UpcomingOccurrencesResult } from '@/server/calendar/service/event_instance';
```

- [ ] **Step 2: Add the three new interface methods**

Below the existing `restoreEventInstance` method in the same file, add:

```typescript
/**
 * Expand the event's RRuleSet beyond the materialization horizon.
 *
 * @param event - The recurring event with schedules loaded
 * @param afterDate - Occurrences strictly after this datetime are returned
 * @param limit - Maximum occurrences to return (caller clamps to 1..50)
 */
async listUpcomingOccurrences(
  event: CalendarEvent,
  afterDate: DateTime,
  limit: number,
) {
  return this.eventInstanceService.listUpcomingOccurrences(event, afterDate, limit);
}

/**
 * Date-based occurrence cancellation. Writes/updates an exclusion schedule
 * row keyed on the supplied start date; validates the date matches the
 * event's RRuleSet before writing.
 */
async cancelOccurrenceByDate(
  account: Account,
  eventId: string,
  startDate: DateTime,
  hideFromPublic: boolean,
): Promise<void> {
  return this.eventInstanceService.cancelOccurrenceByDate(account, eventId, startDate, hideFromPublic);
}

/**
 * Date-based occurrence restore. Removes the exclusion schedule row
 * matching the supplied start date if one exists; silent no-op otherwise.
 */
async restoreOccurrenceByDate(
  account: Account,
  eventId: string,
  startDate: DateTime,
): Promise<void> {
  return this.eventInstanceService.restoreOccurrenceByDate(account, eventId, startDate);
}
```

Add the required imports at the top of the file if not already present:

```typescript
import { DateTime } from 'luxon';
```

- [ ] **Step 3: Confirm the file compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. (If there are unrelated pre-existing errors, confirm they are not introduced by this change — otherwise fix.)

- [ ] **Step 4: Commit**

```bash
git add src/server/calendar/interface/index.ts
git commit -m "feat(calendar): expose occurrence methods via CalendarInterface"
```

---

### Task 5: Add the three new API routes and handlers

**Files:**
- Modify: `src/server/calendar/api/v1/events.ts`

- [ ] **Step 1: Register the routes**

In the `installHandlers` method, after the existing `/events/:eventId/instances/:instanceId/cancel` routes, add:

```typescript
router.get(
  '/events/:eventId/upcoming-occurrences',
  ExpressHelper.loggedInOnly,
  this.listUpcomingOccurrences.bind(this),
);
router.post(
  '/events/:eventId/occurrences/cancel',
  ExpressHelper.loggedInOnly,
  this.cancelEventOccurrence.bind(this),
);
router.delete(
  '/events/:eventId/occurrences/cancel',
  ExpressHelper.loggedInOnly,
  this.restoreEventOccurrence.bind(this),
);
```

- [ ] **Step 2: Add handler imports**

Near the top of `src/server/calendar/api/v1/events.ts`, extend the existing exceptions import:

```typescript
import {
  EventNotFoundError,
  InsufficientCalendarPermissionsError,
  CalendarNotFoundError,
  BulkEventsNotFoundError,
  MixedCalendarEventsError,
  CategoriesNotFoundError,
  LocationValidationError,
  InvalidOccurrenceDateError,
} from '@/common/exceptions/calendar';
```

Also add:

```typescript
import { DateTime } from 'luxon';
```

- [ ] **Step 3: Add the `listUpcomingOccurrences` handler**

Append to the `EventRoutes` class:

```typescript
/**
 * GET /events/:eventId/upcoming-occurrences?limit=10&after=<iso-date>
 *
 * Returns a window of upcoming occurrences computed from the event's
 * RRuleSet, independent of the materialization horizon. Each occurrence
 * carries a state tag (active / cancelled-shown / hidden) and — for
 * non-active states — the owning exclusion schedule's id.
 */
async listUpcomingOccurrences(req: Request, res: Response) {
  const account = req.user as Account;
  if (!account) {
    res.status(401).json({ error: 'not authenticated', errorName: 'AuthenticationError' });
    return;
  }

  const eventId = req.params.eventId;
  if (!ExpressHelper.isValidUUID(eventId)) {
    res.status(400).json({ error: 'invalid UUID format in event ID', errorName: 'ValidationError' });
    return;
  }

  // Parse limit (default 10, clamp to 1..50).
  let limit = 10;
  if (typeof req.query.limit === 'string') {
    const parsed = parseInt(req.query.limit, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      res.status(400).json({ error: 'limit must be a positive integer', errorName: 'ValidationError' });
      return;
    }
    limit = Math.min(parsed, 50);
  }

  // Parse after (default "now").
  let afterDate = DateTime.now().toUTC();
  if (typeof req.query.after === 'string') {
    const parsed = DateTime.fromISO(req.query.after, { zone: 'utc' });
    if (!parsed.isValid) {
      res.status(400).json({ error: 'after must be an ISO-8601 datetime', errorName: 'ValidationError' });
      return;
    }
    afterDate = parsed;
  }

  try {
    const event = await this.service.getEventById(eventId);

    const editableCalendars = await this.service.editableCalendarsForUser(account);
    if (!editableCalendars.some(c => c.id === event.calendarId)) {
      throw new InsufficientCalendarPermissionsError(event.calendarId);
    }

    const result = await this.service.listUpcomingOccurrences(event, afterDate, limit);

    res.json({
      occurrences: result.occurrences.map(o => ({
        start: o.start.toISO(),
        state: o.state,
        scheduleId: o.scheduleId,
      })),
      hasMore: result.hasMore,
    });
  }
  catch (error) {
    if (error instanceof EventNotFoundError) {
      res.status(404).json({ error: error.message, errorName: error.name });
    }
    else if (error instanceof InsufficientCalendarPermissionsError) {
      res.status(403).json({ error: error.message, errorName: error.name });
    }
    else {
      logError(error, 'Error listing upcoming occurrences');
      res.status(500).json({ error: 'An error occurred while listing upcoming occurrences' });
    }
  }
}
```

- [ ] **Step 4: Add the `cancelEventOccurrence` handler**

```typescript
/**
 * POST /events/:eventId/occurrences/cancel
 * Body: { start: ISO8601, hideFromPublic: boolean }
 *
 * Strict-date: the server returns 422 if `start` is not on the event's
 * RRuleSet. The new UI never submits mismatched dates (it picks from the
 * occurrences endpoint) but the API remains honest for direct callers.
 */
async cancelEventOccurrence(req: Request, res: Response) {
  const account = req.user as Account;
  if (!account) {
    res.status(401).json({ error: 'not authenticated', errorName: 'AuthenticationError' });
    return;
  }

  const eventId = req.params.eventId;
  if (!ExpressHelper.isValidUUID(eventId)) {
    res.status(400).json({ error: 'invalid UUID format in event ID', errorName: 'ValidationError' });
    return;
  }

  const { start, hideFromPublic } = req.body ?? {};
  if (typeof start !== 'string' || !DateTime.fromISO(start, { zone: 'utc' }).isValid) {
    res.status(400).json({ error: 'start must be an ISO-8601 datetime string', errorName: 'ValidationError' });
    return;
  }
  if (typeof hideFromPublic !== 'boolean') {
    res.status(400).json({ error: 'hideFromPublic must be a boolean', errorName: 'ValidationError' });
    return;
  }

  const startDate = DateTime.fromISO(start, { zone: 'utc' });

  try {
    await this.service.cancelOccurrenceByDate(account, eventId, startDate, hideFromPublic);
    res.status(204).send();
  }
  catch (error) {
    if (error instanceof InvalidOccurrenceDateError) {
      res.status(422).json({ error: error.message, errorName: error.name });
    }
    else if (error instanceof EventNotFoundError) {
      res.status(404).json({ error: error.message, errorName: error.name });
    }
    else if (error instanceof InsufficientCalendarPermissionsError) {
      res.status(403).json({ error: error.message, errorName: error.name });
    }
    else {
      logError(error, 'Error cancelling event occurrence');
      res.status(500).json({ error: 'An error occurred while cancelling the event occurrence' });
    }
  }
}
```

- [ ] **Step 5: Add the `restoreEventOccurrence` handler**

```typescript
/**
 * DELETE /events/:eventId/occurrences/cancel
 * Body: { start: ISO8601 }
 *
 * Removes the exclusion schedule row for the given occurrence start if it
 * exists. Silent no-op (still 204) otherwise.
 */
async restoreEventOccurrence(req: Request, res: Response) {
  const account = req.user as Account;
  if (!account) {
    res.status(401).json({ error: 'not authenticated', errorName: 'AuthenticationError' });
    return;
  }

  const eventId = req.params.eventId;
  if (!ExpressHelper.isValidUUID(eventId)) {
    res.status(400).json({ error: 'invalid UUID format in event ID', errorName: 'ValidationError' });
    return;
  }

  const { start } = req.body ?? {};
  if (typeof start !== 'string' || !DateTime.fromISO(start, { zone: 'utc' }).isValid) {
    res.status(400).json({ error: 'start must be an ISO-8601 datetime string', errorName: 'ValidationError' });
    return;
  }

  const startDate = DateTime.fromISO(start, { zone: 'utc' });

  try {
    await this.service.restoreOccurrenceByDate(account, eventId, startDate);
    res.status(204).send();
  }
  catch (error) {
    if (error instanceof EventNotFoundError) {
      res.status(404).json({ error: error.message, errorName: error.name });
    }
    else if (error instanceof InsufficientCalendarPermissionsError) {
      res.status(403).json({ error: error.message, errorName: error.name });
    }
    else {
      logError(error, 'Error restoring event occurrence');
      res.status(500).json({ error: 'An error occurred while restoring the event occurrence' });
    }
  }
}
```

- [ ] **Step 6: Compile and lint**

```bash
npx tsc --noEmit && npx eslint --ext .ts src/server/calendar/api/v1/events.ts
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/calendar/api/v1/events.ts
git commit -m "feat(calendar): add occurrence-based cancel/restore/list API routes"
```

---

### Task 6: Integration tests for the new endpoints

**Files:**
- Create: `src/server/calendar/test/integration/cancel_event_occurrence.test.ts`

- [ ] **Step 1: Create the integration test file**

Model the file on `src/server/calendar/test/integration/cancel_event_instance.test.ts`. The preamble (TestEnvironment setup, account/calendar helpers) is the same — copy those verbatim. Then replace the `describe` bodies as follows:

```typescript
describe('GET /events/:eventId/upcoming-occurrences', () => {
  it('returns occurrences with default limit 10 after now', async () => {
    const response = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.occurrences)).toBe(true);
    expect(response.body.occurrences.length).toBeGreaterThan(0);
    expect(response.body.occurrences.length).toBeLessThanOrEqual(10);
    expect(typeof response.body.hasMore).toBe('boolean');
  });

  it('honors the limit query parameter (clamped to 50)', async () => {
    const response = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=3`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.occurrences.length).toBeLessThanOrEqual(3);
  });

  it('rejects non-UUID event ids (400)', async () => {
    const response = await request(env.app)
      .get(`/api/v1/events/not-a-uuid/upcoming-occurrences`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(400);
  });

  it('rejects negative limits (400)', async () => {
    const response = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=-1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(400);
  });

  it('returns 403 for non-editors', async () => {
    const response = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences`)
      .set('Authorization', `Bearer ${attackerToken}`);
    expect(response.status).toBe(403);
  });

  it('returns 404 for unknown event ids', async () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const response = await request(env.app)
      .get(`/api/v1/events/${unknownId}/upcoming-occurrences`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(404);
  });
});

describe('POST /events/:eventId/occurrences/cancel', () => {
  it('cancels a matching occurrence and returns 204', async () => {
    // Seed: pick the first occurrence from the endpoint to guarantee the
    // date matches the rrule.
    const list = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(list.status).toBe(200);
    const first = list.body.occurrences[0];
    expect(first).toBeDefined();

    const response = await request(env.app)
      .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ start: first.start, hideFromPublic: false });

    expect(response.status).toBe(204);
  });

  it('returns 422 when start does not match the rrule', async () => {
    // Event is weekly; shift an hour to construct a non-matching start.
    const list = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const first = DateTime.fromISO(list.body.occurrences[0].start);
    const mismatch = first.plus({ hours: 1 }).toISO();

    const response = await request(env.app)
      .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ start: mismatch, hideFromPublic: false });

    expect(response.status).toBe(422);
    expect(response.body.errorName).toBe('InvalidOccurrenceDateError');
  });

  it('rejects missing start (400)', async () => {
    const response = await request(env.app)
      .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ hideFromPublic: false });
    expect(response.status).toBe(400);
  });

  it('rejects non-boolean hideFromPublic (400)', async () => {
    const list = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const first = list.body.occurrences[0];

    const response = await request(env.app)
      .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ start: first.start, hideFromPublic: 'yes' });
    expect(response.status).toBe(400);
  });

  it('returns 403 for non-editors', async () => {
    const list = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const first = list.body.occurrences[0];

    const response = await request(env.app)
      .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ start: first.start, hideFromPublic: false });
    expect(response.status).toBe(403);
  });
});

describe('DELETE /events/:eventId/occurrences/cancel', () => {
  it('restores a previously cancelled occurrence and returns 204', async () => {
    const list = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const first = list.body.occurrences[0];

    const cancelResp = await request(env.app)
      .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ start: first.start, hideFromPublic: false });
    expect(cancelResp.status).toBe(204);

    const restoreResp = await request(env.app)
      .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ start: first.start });
    expect(restoreResp.status).toBe(204);
  });

  it('is a silent 204 no-op when no cancellation exists', async () => {
    const list = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const first = list.body.occurrences[0];

    const response = await request(env.app)
      .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ start: first.start });
    expect(response.status).toBe(204);
  });

  it('returns 403 for non-editors', async () => {
    const list = await request(env.app)
      .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const first = list.body.occurrences[0];

    const response = await request(env.app)
      .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ start: first.start });
    expect(response.status).toBe(403);
  });
});
```

Make sure to import `DateTime` at the top of the file along with everything copied from the template file.

- [ ] **Step 2: Run the integration tests**

```bash
npx vitest run --config vitest.integration.config.ts src/server/calendar/test/integration/cancel_event_occurrence.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/calendar/test/integration/cancel_event_occurrence.test.ts
git commit -m "test(calendar): integration coverage for occurrence-based cancel API"
```

---

## Phase 2 — Frontend: swap to new path

The old instance-ID-based service and the old panel keep working until this phase completes. No UI breakage in between commits.

---

### Task 7: Add new `EventService` methods

**Files:**
- Modify: `src/client/service/event.ts`

- [ ] **Step 1: Add the DTO type at the top of the file**

Near the top of `src/client/service/event.ts`, after the imports, add:

```typescript
export interface UpcomingOccurrence {
  start: string;          // ISO-8601 datetime
  state: 'active' | 'cancelled-shown' | 'hidden';
  scheduleId: string | null;
}

export interface UpcomingOccurrencesResult {
  occurrences: UpcomingOccurrence[];
  hasMore: boolean;
}
```

- [ ] **Step 2: Append the three new service methods**

Inside the `EventService` class, add these methods alongside the existing `cancelEventInstance` / `restoreEventInstance`:

```typescript
/**
 * Fetch upcoming occurrences for a recurring event computed from its
 * RRuleSet on the server. Independent of the materialization horizon —
 * the caller controls the window via (after, limit).
 *
 * @param eventId The recurring event id
 * @param after ISO-8601 datetime; defaults to server "now" when omitted
 * @param limit Max occurrences to return (default server-side: 10)
 */
async listUpcomingOccurrences(
  eventId: string,
  after?: string,
  limit?: number,
): Promise<UpcomingOccurrencesResult> {
  const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
  const params = new URLSearchParams();
  if (after) params.append('after', after);
  if (limit) params.append('limit', String(limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';

  try {
    const response = await axios.get(
      `/api/v1/events/${encodedEventId}/upcoming-occurrences${suffix}`,
    );
    return response.data as UpcomingOccurrencesResult;
  }
  catch (error) {
    console.error('Error listing upcoming occurrences:', error);
    throw error;
  }
}

/**
 * Cancel a specific occurrence of a recurring event by its start date.
 * Server validates the date matches the RRuleSet; mismatched dates throw
 * a 422.
 */
async cancelOccurrence(
  eventId: string,
  start: string,
  hideFromPublic: boolean,
): Promise<void> {
  const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
  try {
    await axios.post(
      `/api/v1/events/${encodedEventId}/occurrences/cancel`,
      { start, hideFromPublic },
    );
  }
  catch (error) {
    console.error('Error cancelling event occurrence:', error);
    throw error;
  }
}

/**
 * Restore a previously cancelled occurrence by its start date. Silent no-op
 * server-side if the occurrence was never cancelled.
 */
async restoreOccurrence(eventId: string, start: string): Promise<void> {
  const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
  try {
    await axios.delete(
      `/api/v1/events/${encodedEventId}/occurrences/cancel`,
      { data: { start } },
    );
  }
  catch (error) {
    console.error('Error restoring event occurrence:', error);
    throw error;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/client/service/event.ts
git commit -m "feat(client): add occurrence-based EventService methods"
```

---

### Task 8: Add i18n keys for the scroller UX

**Files:**
- Modify: `src/client/locales/en/event_editor.json`
- Modify: `src/client/locales/es/event_editor.json`
- Modify: `src/client/locales/fr/event_editor.json`

- [ ] **Step 1: Add keys to English locale**

In `src/client/locales/en/event_editor.json`, locate the existing `"cancellations"` object and replace it with:

```json
"cancellations": {
  "panel_title": "Cancellations",
  "toggle_button": "Manage cancellations",
  "cancel_button": "Cancel",
  "restore_button": "Restore",
  "hide_toggle_label": "Hide from public",
  "hide_toggle_description": "When enabled, this cancelled instance will not be shown on public calendars or federated out.",
  "cancelled_badge": "Cancelled",
  "hidden_badge": "Hidden",
  "confirm_title": "Cancel this instance?",
  "confirm_message": "This will mark the selected occurrence as cancelled. You can restore it later.",
  "confirm_submit": "Cancel instance",
  "scroller_label": "Upcoming occurrences",
  "show_more_label": "Show more",
  "show_more_description": "Load the next 10 occurrences",
  "jump_label": "Jump to month",
  "jump_submit": "Go",
  "jump_placeholder": "YYYY-MM",
  "no_further_occurrences": "No further occurrences",
  "no_occurrences_after": "No occurrences after {{month}}",
  "start_from_today": "Start from today",
  "loading": "Loading…"
}
```

- [ ] **Step 2: Mirror the keys to Spanish and French with stub values**

In `src/client/locales/es/event_editor.json` and `src/client/locales/fr/event_editor.json`, add the same new keys (`scroller_label`, `show_more_label`, `show_more_description`, `jump_label`, `jump_submit`, `jump_placeholder`, `no_further_occurrences`, `no_occurrences_after`, `start_from_today`, `loading`) as copy-of-English strings. Translation polish is out of scope for this plan.

- [ ] **Step 3: Commit**

```bash
git add src/client/locales
git commit -m "chore(client): add i18n keys for cancellations scroller UX"
```

---

### Task 9: Rewrite `EventCancellationsPanel` component — tests first

**Files:**
- Rewrite: `src/client/test/components/calendar/event-cancellations-panel.test.ts`
- Rewrite: `src/client/components/logged_in/calendar/EventCancellationsPanel.vue`

- [ ] **Step 1: Replace the test file**

Overwrite `src/client/test/components/calendar/event-cancellations-panel.test.ts` with:

```typescript
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';

import { CalendarEvent } from '@/common/model/events';
import EventCancellationsPanel from '@/client/components/logged_in/calendar/EventCancellationsPanel.vue';
import EventCancelConfirmModal from '@/client/components/logged_in/calendar/EventCancelConfirmModal.vue';
import { mountComponent } from '@/client/test/lib/vue';

const { listUpcomingOccurrencesMock, cancelOccurrenceMock, restoreOccurrenceMock } = vi.hoisted(() => ({
  listUpcomingOccurrencesMock: vi.fn(),
  cancelOccurrenceMock: vi.fn(),
  restoreOccurrenceMock: vi.fn(),
}));

vi.mock('@/client/service/event', () => {
  class MockEventService {
    listUpcomingOccurrences = (...args: unknown[]) => listUpcomingOccurrencesMock(...args);
    cancelOccurrence = (...args: unknown[]) => cancelOccurrenceMock(...args);
    restoreOccurrence = (...args: unknown[]) => restoreOccurrenceMock(...args);
  }
  return { default: MockEventService };
});

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

const SheetStub = {
  template: '<div class="sheet-stub"><header><h2>{{ title }}</h2></header><slot /></div>',
  props: ['title'],
  emits: ['close'],
};

const EVENT_ID = 'event-1';

function makeRecurringEvent(): CalendarEvent {
  // The panel itself does not check hasRecurringSchedule — that gating lives
  // in edit_event.vue — so an empty schedules array is sufficient for these
  // tests. The panel fetches its data through the mocked service.
  const event = new CalendarEvent();
  event.id = EVENT_ID;
  event.calendarId = 'cal-1';
  event.schedules = [];
  return event;
}

function makeOccurrences(count: number, startIso = '2030-01-01T12:00:00.000Z'): any[] {
  const out = [];
  let current = new Date(startIso).getTime();
  const weekMs = 7 * 24 * 3600 * 1000;
  for (let i = 0; i < count; i++) {
    out.push({
      start: new Date(current).toISOString(),
      state: 'active',
      scheduleId: null,
    });
    current += weekMs;
  }
  return out;
}

async function mountPanel(props: { event: CalendarEvent }) {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/');
  await router.isReady();

  return mountComponent(EventCancellationsPanel, router, {
    stubs: { Sheet: SheetStub },
    props,
  });
}

describe('EventCancellationsPanel (horizontal scroller)', () => {
  let currentWrapper: any = null;

  beforeEach(() => {
    listUpcomingOccurrencesMock.mockReset();
    cancelOccurrenceMock.mockReset();
    restoreOccurrenceMock.mockReset();
    cancelOccurrenceMock.mockResolvedValue(undefined);
    restoreOccurrenceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  it('fetches 10 occurrences on mount with after=now', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({
      occurrences: makeOccurrences(10),
      hasMore: true,
    });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(1);
    const [eventId, after, limit] = listUpcomingOccurrencesMock.mock.calls[0];
    expect(eventId).toBe(EVENT_ID);
    expect(typeof after).toBe('string');
    expect(limit).toBe(10);

    const cards = wrapper.findAll('[data-testid="occurrence-card"]');
    expect(cards).toHaveLength(10);
    // Trailing control cards exist alongside.
    expect(wrapper.find('[data-testid="scroller-jump-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="scroller-show-more-card"]').exists()).toBe(true);
  });

  it('"Show more" appends the next 10 occurrences keyed off the last card', async () => {
    const firstBatch = makeOccurrences(10);
    const secondBatch = makeOccurrences(10, '2030-03-12T12:00:00.000Z');
    listUpcomingOccurrencesMock
      .mockResolvedValueOnce({ occurrences: firstBatch, hasMore: true })
      .mockResolvedValueOnce({ occurrences: secondBatch, hasMore: false });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="scroller-show-more-card"]').trigger('click');
    await flushPromises();

    const call = listUpcomingOccurrencesMock.mock.calls[1];
    expect(call[0]).toBe(EVENT_ID);
    expect(call[1]).toBe(firstBatch[firstBatch.length - 1].start);
    expect(call[2]).toBe(10);

    expect(wrapper.findAll('[data-testid="occurrence-card"]')).toHaveLength(20);

    // hasMore=false replaces the Show More card with the terminal card.
    expect(wrapper.find('[data-testid="scroller-show-more-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="scroller-terminal-card"]').exists()).toBe(true);
  });

  it('"Jump to month" replaces the list and resets scroll', async () => {
    const firstBatch = makeOccurrences(10);
    const jumped = makeOccurrences(10, '2027-06-07T12:00:00.000Z');
    listUpcomingOccurrencesMock
      .mockResolvedValueOnce({ occurrences: firstBatch, hasMore: true })
      .mockResolvedValueOnce({ occurrences: jumped, hasMore: true });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="scroller-jump-input"]').setValue('2027-06');
    await wrapper.find('[data-testid="scroller-jump-submit"]').trigger('click');
    await flushPromises();

    const call = listUpcomingOccurrencesMock.mock.calls[1];
    expect(call[1]).toBe('2027-06-01T00:00:00.000Z');

    expect(wrapper.findAll('[data-testid="occurrence-card"]')).toHaveLength(10);
  });

  it('renders a "no occurrences after" card when jump returns empty', async () => {
    listUpcomingOccurrencesMock
      .mockResolvedValueOnce({ occurrences: makeOccurrences(10), hasMore: true })
      .mockResolvedValueOnce({ occurrences: [], hasMore: false });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="scroller-jump-input"]').setValue('2099-01');
    await wrapper.find('[data-testid="scroller-jump-submit"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="scroller-empty-card"]').exists()).toBe(true);
    await wrapper.find('[data-testid="scroller-start-from-today"]').trigger('click');
    await flushPromises();

    // A third call restores the "start from today" view.
    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(3);
  });

  it('opens the confirm modal and cancels via cancelOccurrence on confirm', async () => {
    const occ = makeOccurrences(1)[0];
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [occ], hasMore: false });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="occurrence-card-cancel"]').trigger('click');
    await flushPromises();

    const modal = wrapper.findComponent(EventCancelConfirmModal);
    expect(modal.exists()).toBe(true);
    modal.vm.$emit('confirm', { hideFromPublic: true });
    await flushPromises();

    expect(cancelOccurrenceMock).toHaveBeenCalledWith(EVENT_ID, occ.start, true);
    // Card state flips in place — still one card, but now shows restore action.
    const cards = wrapper.findAll('[data-testid="occurrence-card"]');
    expect(cards).toHaveLength(1);
    expect(wrapper.find('[data-testid="occurrence-card-restore"]').exists()).toBe(true);
  });

  it('restores via restoreOccurrence and flips state to active in place', async () => {
    const occ = { start: '2030-01-01T12:00:00.000Z', state: 'cancelled-shown', scheduleId: 'sch-1' };
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [occ], hasMore: false });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="occurrence-card-restore"]').trigger('click');
    await flushPromises();

    expect(restoreOccurrenceMock).toHaveBeenCalledWith(EVENT_ID, occ.start);
    expect(wrapper.find('[data-testid="occurrence-card-cancel"]').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new test file to verify it fails against the old panel**

```bash
npx vitest run src/client/test/components/calendar/event-cancellations-panel.test.ts
```

Expected: FAIL — the old panel still uses the `instances` prop and the `cancelEventInstance` mock, which the new test does not set up.

- [ ] **Step 3: Rewrite the component**

Overwrite `src/client/components/logged_in/calendar/EventCancellationsPanel.vue` with the following. The component is long; paste the whole file verbatim:

```vue
<script setup lang="ts">
/**
 * EventCancellationsPanel
 *
 * Horizontal scroll-snapping row of occurrence cards for managing
 * cancellations on a recurring event. Occurrences are fetched from the
 * server's /upcoming-occurrences endpoint, independent of the
 * materialization horizon — so a monthly or yearly event is navigable
 * arbitrarily far into the future.
 *
 * The scroller ends with two trailing cards:
 *   - "Jump to month…": input a YYYY-MM month to reposition the list
 *   - "Show more": append the next 10 occurrences
 *
 * When the server reports hasMore=false, "Show more" is replaced by a
 * terminal "No further occurrences" card.
 *
 * Props:
 * @prop {CalendarEvent} event - The recurring event being managed
 */

import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { DateTime } from 'luxon';
import { useTranslation } from 'i18next-vue';

import PillButton from '@/client/components/common/pill-button.vue';
import EventCancelConfirmModal from '@/client/components/logged_in/calendar/EventCancelConfirmModal.vue';
import EventService, {
  type UpcomingOccurrence,
} from '@/client/service/event';
import type { CalendarEvent } from '@/common/model/events';

const props = defineProps<{
  event: CalendarEvent;
}>();

const { t } = useTranslation('event_editor', {
  keyPrefix: 'cancellations',
});

const eventService = new EventService();

const occurrences = ref<UpcomingOccurrence[]>([]);
const hasMore = ref(true);
const loading = ref(false);
const jumpMonth = ref<string>('');
const showEmpty = ref(false);
const emptyMonthLabel = ref<string>('');
const pendingCancelStart = ref<string | null>(null);

const scrollerEl = useTemplateRef<HTMLElement>('scroller');

const cursor = computed<string | null>(() =>
  occurrences.value.length > 0
    ? occurrences.value[occurrences.value.length - 1].start
    : null,
);

async function fetchBatch(after: string): Promise<{ items: UpcomingOccurrence[]; more: boolean }> {
  loading.value = true;
  try {
    const result = await eventService.listUpcomingOccurrences(props.event.id, after, 10);
    return { items: result.occurrences, more: result.hasMore };
  }
  finally {
    loading.value = false;
  }
}

async function loadFromAnchor(anchorIso: string, monthLabel: string | null) {
  const { items, more } = await fetchBatch(anchorIso);
  occurrences.value = items;
  hasMore.value = more;
  showEmpty.value = items.length === 0;
  emptyMonthLabel.value = monthLabel ?? '';
  // Reset scroll to start so the user sees the jump target.
  scrollerEl.value?.scrollTo({ left: 0, behavior: 'auto' });
}

async function loadInitial() {
  const nowIso = DateTime.utc().toISO();
  await loadFromAnchor(nowIso!, null);
}

async function onShowMore() {
  const anchor = cursor.value;
  if (!anchor) return;
  const { items, more } = await fetchBatch(anchor);
  if (items.length === 0) {
    hasMore.value = false;
    return;
  }
  const priorCount = occurrences.value.length;
  occurrences.value = occurrences.value.concat(items);
  hasMore.value = more;

  // Scroll the first newly-appended card into view on next tick.
  requestAnimationFrame(() => {
    const cards = scrollerEl.value?.querySelectorAll<HTMLElement>('[data-testid="occurrence-card"]');
    const target = cards?.[priorCount];
    target?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  });
}

async function onJumpSubmit() {
  const value = jumpMonth.value.trim();
  if (!value) return;
  const parsed = DateTime.fromFormat(value, 'yyyy-MM', { zone: 'utc' });
  if (!parsed.isValid) return;
  const anchor = parsed.startOf('month');
  await loadFromAnchor(anchor.toISO()!, parsed.toFormat('MMMM yyyy'));
}

async function onStartFromToday() {
  showEmpty.value = false;
  await loadInitial();
}

function onCancelClick(start: string) {
  pendingCancelStart.value = start;
}

async function onConfirmCancel(payload: { hideFromPublic: boolean }) {
  const start = pendingCancelStart.value;
  pendingCancelStart.value = null;
  if (!start) return;
  try {
    await eventService.cancelOccurrence(props.event.id, start, payload.hideFromPublic);
    const idx = occurrences.value.findIndex(o => o.start === start);
    if (idx >= 0) {
      occurrences.value[idx] = {
        ...occurrences.value[idx],
        state: payload.hideFromPublic ? 'hidden' : 'cancelled-shown',
      };
    }
  }
  catch (error) {
    console.error('EventCancellationsPanel: cancelOccurrence failed', error);
  }
}

function onCloseConfirm() {
  pendingCancelStart.value = null;
}

async function onRestoreClick(start: string) {
  try {
    await eventService.restoreOccurrence(props.event.id, start);
    const idx = occurrences.value.findIndex(o => o.start === start);
    if (idx >= 0) {
      occurrences.value[idx] = {
        ...occurrences.value[idx],
        state: 'active',
        scheduleId: null,
      };
    }
  }
  catch (error) {
    console.error('EventCancellationsPanel: restoreOccurrence failed', error);
  }
}

function formatStart(iso: string): string {
  return DateTime.fromISO(iso).toLocaleString(DateTime.DATETIME_MED);
}

onMounted(() => {
  loadInitial();
});
</script>

<template>
  <section class="cancellations-panel" aria-labelledby="cancellations-panel-title">
    <h3 id="cancellations-panel-title" class="panel-title">{{ t('panel_title') }}</h3>

    <div
      ref="scroller"
      class="scroller"
      role="region"
      :aria-label="t('scroller_label')"
      :aria-busy="loading"
    >
      <template v-if="showEmpty">
        <div class="card card--terminal" data-testid="scroller-empty-card">
          <p class="card-text">
            {{ t('no_occurrences_after', { month: emptyMonthLabel }) }}
          </p>
          <PillButton
            size="sm"
            variant="secondary"
            data-testid="scroller-start-from-today"
            @click="onStartFromToday"
          >
            {{ t('start_from_today') }}
          </PillButton>
        </div>
      </template>

      <template v-else>
        <article
          v-for="o in occurrences"
          :key="o.start"
          class="card card--occurrence"
          :class="`card--${o.state}`"
          data-testid="occurrence-card"
        >
          <time class="card-start" :datetime="o.start">{{ formatStart(o.start) }}</time>

          <span
            v-if="o.state === 'cancelled-shown'"
            class="badge badge--warning"
            data-testid="badge-cancelled"
          >
            {{ t('cancelled_badge') }}
          </span>
          <span
            v-else-if="o.state === 'hidden'"
            class="badge badge--subtle"
            data-testid="badge-hidden"
          >
            {{ t('hidden_badge') }}
          </span>

          <div class="card-actions">
            <PillButton
              v-if="o.state === 'active'"
              size="sm"
              variant="secondary"
              data-testid="occurrence-card-cancel"
              @click="onCancelClick(o.start)"
            >
              {{ t('cancel_button') }}
            </PillButton>
            <PillButton
              v-else
              size="sm"
              variant="ghost"
              data-testid="occurrence-card-restore"
              @click="onRestoreClick(o.start)"
            >
              {{ t('restore_button') }}
            </PillButton>
          </div>
        </article>

        <div class="card card--control" data-testid="scroller-jump-card">
          <label class="card-label" :for="`${event.id}-jump`">
            {{ t('jump_label') }}
          </label>
          <input
            :id="`${event.id}-jump`"
            v-model="jumpMonth"
            type="month"
            class="jump-input"
            :placeholder="t('jump_placeholder')"
            data-testid="scroller-jump-input"
          />
          <PillButton
            size="sm"
            variant="secondary"
            data-testid="scroller-jump-submit"
            @click="onJumpSubmit"
          >
            {{ t('jump_submit') }}
          </PillButton>
        </div>

        <button
          v-if="hasMore"
          type="button"
          class="card card--control card--clickable"
          data-testid="scroller-show-more-card"
          :aria-label="t('show_more_description')"
          @click="onShowMore"
        >
          <span class="card-label">{{ t('show_more_label') }}</span>
        </button>
        <div
          v-else
          class="card card--terminal"
          data-testid="scroller-terminal-card"
        >
          <p class="card-text">{{ t('no_further_occurrences') }}</p>
        </div>
      </template>
    </div>

    <EventCancelConfirmModal
      v-if="pendingCancelStart"
      @confirm="onConfirmCancel"
      @close="onCloseConfirm"
    />
  </section>
</template>

<style scoped lang="scss">
.cancellations-panel {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-md);
}

.panel-title {
  margin: 0;
  font-size: var(--pav-font-size-h6);
  font-weight: var(--pav-font-weight-semibold);
  color: var(--pav-text-primary);
}

.scroller {
  display: flex;
  gap: var(--pav-space-sm);
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding-block: var(--pav-space-xs);
  padding-inline: var(--pav-space-xs);

  @media (prefers-reduced-motion: reduce) {
    scroll-behavior: auto;
  }
}

.card {
  flex: 0 0 auto;
  width: clamp(160px, 42vw, 220px);
  min-height: 150px;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-xs);
  padding: var(--pav-space-md);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  border-radius: var(--pav-border-radius-md);
  background: var(--pav-surface-secondary);
  scroll-snap-align: start;

  &--cancelled-shown,
  &--hidden {
    opacity: 0.85;
  }

  &--control,
  &--terminal {
    align-items: flex-start;
    justify-content: center;
  }

  &--clickable {
    cursor: pointer;
    font: inherit;
    text-align: start;
  }
}

.card-start {
  font-weight: var(--pav-font-weight-medium);
  color: var(--pav-text-primary);
}

.card-actions {
  margin-top: auto;
}

.card-label {
  font-weight: var(--pav-font-weight-semibold);
  color: var(--pav-text-primary);
}

.card-text {
  margin: 0;
  color: var(--pav-text-secondary);
}

.jump-input {
  width: 100%;
  padding: var(--pav-space-xs) var(--pav-space-sm);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  border-radius: var(--pav-border-radius-sm);
  background: var(--pav-surface-primary);
  color: var(--pav-text-primary);
}
</style>
```

- [ ] **Step 4: Run the new test file to verify it passes**

```bash
npx vitest run src/client/test/components/calendar/event-cancellations-panel.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/logged_in/calendar/EventCancellationsPanel.vue \
        src/client/test/components/calendar/event-cancellations-panel.test.ts
git commit -m "feat(client): horizontal scroller cancellations panel with on-demand occurrences"
```

---

### Task 10: Update `edit_event.vue` to drop the `instances` prop

**Files:**
- Modify: `src/client/components/logged_in/calendar/edit_event.vue`
- Modify: `src/client/test/components/calendar/edit-event-cancellations-trigger.test.ts` (if it asserts on the instances prop)

- [ ] **Step 1: Remove the `instances` prop binding**

Locate the `EventCancellationsPanel` usage in `src/client/components/logged_in/calendar/edit_event.vue` (currently around line 1120):

```vue
<EventCancellationsPanel
  :event="editorState.event"
  :instances="eventInstances"
/>
```

Replace with:

```vue
<EventCancellationsPanel :event="editorState.event" />
```

- [ ] **Step 2: Remove the now-unused `eventInstances` computed and its store import (if exclusively used here)**

Search `edit_event.vue` for `eventInstances` and `useEventStore` usage. If `eventInstances` is only referenced by the panel, delete its definition and any imports it brought in. If the store import is used elsewhere in the file (e.g. for loading, invalidation), leave it alone; only the computed should go.

- [ ] **Step 3: Update `edit-event-cancellations-trigger.test.ts` if required**

Run the existing test:

```bash
npx vitest run src/client/test/components/calendar/edit-event-cancellations-trigger.test.ts
```

If it fails because a test asserts on the `:instances` prop or stubs `EventCancellationsPanel` with `instances` in its prop list, update those assertions to omit the `instances` prop. Preserve all other behavior.

- [ ] **Step 4: Run both tests**

```bash
npx vitest run \
  src/client/test/components/calendar/edit-event-cancellations-trigger.test.ts \
  src/client/test/components/calendar/event-cancellations-panel.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/logged_in/calendar/edit_event.vue \
        src/client/test/components/calendar/edit-event-cancellations-trigger.test.ts
git commit -m "refactor(client): drop instances prop from cancellations panel wiring"
```

---

## Phase 3 — Cleanup: delete the old instance-ID path

With the new path live, remove the old methods and endpoints.

---

### Task 11: Delete old `cancelEventInstance` / `restoreEventInstance` from the client service

**Files:**
- Modify: `src/client/service/event.ts`

- [ ] **Step 1: Delete the old methods**

In `src/client/service/event.ts`, delete the entire bodies of `cancelEventInstance` and `restoreEventInstance` (currently ~lines 170–248). Leave `listUpcomingOccurrences`, `cancelOccurrence`, `restoreOccurrence` from Task 7 in place.

Also remove these now-unused imports if they are only used by the deleted methods:

```typescript
import CalendarEventInstance from '@/common/model/event_instance';
```

Check for other usages in the file before removing; leave the import if it is referenced elsewhere.

- [ ] **Step 2: Confirm compile**

```bash
npx tsc --noEmit && npx eslint --ext .ts src/client/service/event.ts
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/service/event.ts
git commit -m "chore(client): remove obsolete cancelEventInstance/restoreEventInstance"
```

---

### Task 12: Delete old server-side instance-ID cancel/restore

**Files:**
- Modify: `src/server/calendar/api/v1/events.ts`
- Modify: `src/server/calendar/interface/index.ts`
- Modify: `src/server/calendar/service/event_instance.ts`
- Delete: `src/server/calendar/test/integration/cancel_event_instance.test.ts`

- [ ] **Step 1: Remove route registration**

In `src/server/calendar/api/v1/events.ts` `installHandlers`, delete the two router lines for the old endpoint (`router.post('/events/:eventId/instances/:instanceId/cancel'...)` and `router.delete('/events/:eventId/instances/:instanceId/cancel'...)`).

- [ ] **Step 2: Remove route handlers**

In the same file, delete the `cancelEventInstance` and `restoreEventInstance` methods on `EventRoutes` (the two methods at the bottom of the class, currently ~lines 448–581).

- [ ] **Step 3: Remove interface methods**

In `src/server/calendar/interface/index.ts`, delete the `cancelEventInstance` and `restoreEventInstance` methods (around lines 374–397).

- [ ] **Step 4: Remove service methods**

In `src/server/calendar/service/event_instance.ts`, delete the public `cancelInstance` and `restoreInstance` methods (currently ~lines 548–728). The private helpers `loadEventForEditor`, `writeExclusionRow`, `deleteExclusionRow`, and `assertDateMatchesOccurrence` that the new date-based methods depend on MUST stay.

- [ ] **Step 5: Update the service tests**

In `src/server/calendar/test/service/event_instance.test.ts`, delete the two `describe` blocks titled `cancelInstance` and `restoreInstance`. Keep the new `cancelOccurrenceByDate` / `restoreOccurrenceByDate` describes from Task 3 and the `listUpcomingOccurrences` describe from Task 2.

- [ ] **Step 6: Delete the old integration test**

```bash
git rm src/server/calendar/test/integration/cancel_event_instance.test.ts
```

The new `cancel_event_occurrence.test.ts` from Task 6 replaces it.

- [ ] **Step 7: Update `event-handlers.test.ts` payload expectations if needed**

```bash
npx vitest run src/server/calendar/test/EventInstanceService/event-handlers.test.ts
```

If the eventInstanceCancelled / eventInstanceRestored handler tests previously asserted `payload.instanceId === 'instance-1'`, update them to simply verify `payload.event` and `payload.calendar` — `instanceId` is no longer always emitted. Keep the rebuild + re-emit assertions intact.

- [ ] **Step 8: Run affected test suites**

```bash
npx vitest run src/server/calendar/test/service/event_instance.test.ts \
               src/server/calendar/test/EventInstanceService/event-handlers.test.ts \
               --config vitest.integration.config.ts \
               src/server/calendar/test/integration/cancel_event_occurrence.test.ts
```

(Or run them as two separate commands if the unit and integration configs conflict — the integration config is required for the `integration/` folder.)

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/server/calendar/api/v1/events.ts \
        src/server/calendar/interface/index.ts \
        src/server/calendar/service/event_instance.ts \
        src/server/calendar/test/service/event_instance.test.ts \
        src/server/calendar/test/integration/cancel_event_instance.test.ts \
        src/server/calendar/test/EventInstanceService/event-handlers.test.ts
git commit -m "chore(calendar): remove obsolete instance-ID cancel/restore path"
```

---

### Task 13: Final verification — full test suite, lint, build

**Files:** (none — verification only)

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: no errors. (Project has a known ~267 warnings baseline — new warnings introduced by this work must be fixed or justified.)

- [ ] **Step 2: Unit tests**

```bash
npm run test:unit
```

Expected: all PASS (pre-existing failures in funding/AP series tests are acceptable — see `project_lint_known_issues.md`).

- [ ] **Step 3: Integration tests**

```bash
npm run test:integration
```

Expected: all PASS for the cancel-event-occurrence integration suite.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Manual browser verification**

Start the dev server and exercise the flow in a browser. Log in as `admin@pavillion.dev` / `admin`. Create (or reuse) a recurring event on a calendar you can edit. Open the event editor and toggle the "Manage cancellations" panel.

Verify:

- Panel shows the next 10 occurrences as horizontally scrolling cards.
- Clicking "Show more" appends 10 more; the new batch scrolls into view.
- Entering a month in "Jump to month" and clicking Go replaces the list.
- Cancelling an occurrence opens the confirm modal; after confirm the card flips to show the "Restore" action inline without the whole panel reloading.
- Restoring flips the card back to active in place.
- Submitting "Jump to month" with a far-future month where no occurrences remain shows the "No occurrences after…" terminal card with a "Start from today" action that resets the list.
- The events tab's cancelled pill on this event's row still reflects whether any shown-cancellation exists (it reads from `event.schedules` and is independent of this panel's state).

- [ ] **Step 6: Commit any fixes found during verification, then final commit**

If verification surfaced bugs, fix them with targeted commits. Once the above verifications all pass cleanly, push the branch:

```bash
git push
```

---

## Self-review notes (for the author)

- Spec section "Interaction model" → covered by Task 9 component rewrite.
- Spec section "Card layout" (clamp widths, scroll-snap, `prefers-reduced-motion`) → covered by SCSS in Task 9.
- Spec section "Backend: new occurrences endpoint" → Tasks 2 (service), 5 (handler), 6 (integration).
- Spec section "Backend: cancel/restore by date" → Tasks 3 (service + helpers), 5 (handler), 6 (integration).
- Spec section "Backend: delete instance-ID endpoints" → Task 12.
- Spec section "Frontend: rewrite panel" → Tasks 7 (service), 8 (i18n), 9 (component + tests), 10 (edit_event wiring).
- Spec section "What goes away" → Tasks 10, 11, 12.
- Spec section "Testing" → Tasks 2, 3, 6, 9 cover all listed cases.
- Desktop chevron overlay buttons are mentioned in the spec but intentionally deferred in the implementation; touch-scroll + keyboard arrow nav cover the MVP. If reviewer agents flag this as a regression, add a follow-up bead rather than growing this plan.
- Keyboard arrow-key navigation between cards is implicit via native focus + scroll-snap; the spec's description of Home/End semantics is nice-to-have — if this plan finishes and keyboard ergonomics feel weak during Step 5 verification, add a bead for explicit keyboard handling.
