import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { DateTime, Duration } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import sinon from 'sinon';
import { Op, Utils } from 'sequelize';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import EventInstanceService from '@/server/calendar/service/event_instance';
import EventService from '@/server/calendar/service/events';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';

/**
 * Tests for instance generation duration logic in EventInstanceService.
 *
 * generateInstances() is private, so we access it via bracket notation
 * to test the pure computation without requiring database access.
 */
describe('EventInstanceService.generateInstances', () => {
  let service: EventInstanceService;

  function createEvent(schedules: CalendarEventSchedule[]): CalendarEvent {
    const event = new CalendarEvent(uuidv4(), uuidv4());
    event.schedules = schedules;
    return event;
  }

  function createSchedule(opts: {
    startDate: DateTime;
    endDate?: DateTime | null;
    eventEndTime?: DateTime | null;
    frequency?: EventFrequency | null;
    interval?: number;
    count?: number;
    isExclusion?: boolean;
    hideFromPublic?: boolean;
    byDay?: string[];
  }): CalendarEventSchedule {
    const schedule = new CalendarEventSchedule(uuidv4(), opts.startDate, opts.endDate ?? undefined);
    schedule.eventEndTime = opts.eventEndTime ?? null;
    schedule.frequency = opts.frequency ?? null;
    schedule.interval = opts.interval ?? 0;
    schedule.count = opts.count ?? 0;
    schedule.isExclusion = opts.isExclusion ?? false;
    // Preserve prior EXDATE-only semantics: when unspecified, treat exclusions
    // as hidden (true). Tests for shown cancellations pass hideFromPublic: false.
    schedule.hideFromPublic = opts.hideFromPublic ?? true;
    schedule.byDay = opts.byDay ?? [];
    return schedule;
  }

  beforeEach(() => {
    service = new EventInstanceService(new EventEmitter());
  });

  it('should compute correct end time for non-recurring event with eventEndTime', () => {
    const start = DateTime.fromISO('2026-04-10T10:00:00');
    const endTime = DateTime.fromISO('2026-04-10T12:00:00');

    const event = createEvent([
      createSchedule({ startDate: start, eventEndTime: endTime }),
    ]);

    const instances = (service as any).generateInstances(event, new Date('2026-04-01T00:00:00Z'));

    expect(instances).toHaveLength(1);
    expect(instances[0].start.toISO()).toBe(start.toISO());
    expect(instances[0].end).not.toBeNull();
    expect(instances[0].end!.toISO()).toBe(endTime.toISO());
  });

  it('should apply duration to each recurring instance from eventEndTime', () => {
    const start = DateTime.fromISO('2026-04-10T09:00:00');
    const endTime = DateTime.fromISO('2026-04-10T11:30:00');
    // Duration is 2.5 hours
    const recurrenceEnd = DateTime.fromISO('2026-05-10T09:00:00');

    const event = createEvent([
      createSchedule({
        startDate: start,
        endDate: recurrenceEnd,
        eventEndTime: endTime,
        frequency: EventFrequency.WEEKLY,
        interval: 1,
      }),
    ]);

    const instances = (service as any).generateInstances(event, new Date('2026-04-01T00:00:00Z'));

    expect(instances.length).toBeGreaterThanOrEqual(2);

    // Each instance should have a 2.5 hour duration from its start
    for (const instance of instances) {
      expect(instance.end).not.toBeNull();
      const duration = instance.end!.diff(instance.start, 'minutes').minutes;
      expect(duration).toBe(150); // 2.5 hours = 150 minutes
    }

    // Second instance should be one week later
    const secondStart = instances[1].start;
    expect(secondStart.diff(instances[0].start, 'weeks').weeks).toBe(1);
  });

  it('should produce null end times when no eventEndTime exists', () => {
    const start = DateTime.fromISO('2026-04-10T14:00:00');

    const event = createEvent([
      createSchedule({ startDate: start }),
    ]);

    const instances = (service as any).generateInstances(event, new Date('2026-04-01T00:00:00Z'));

    expect(instances).toHaveLength(1);
    expect(instances[0].start.toISO()).toBe(start.toISO());
    expect(instances[0].end).toBeNull();
  });

  it('should produce null end times for recurring events without eventEndTime', () => {
    const start = DateTime.fromISO('2026-04-10T14:00:00');
    const recurrenceEnd = DateTime.fromISO('2026-05-10T14:00:00');

    const event = createEvent([
      createSchedule({
        startDate: start,
        endDate: recurrenceEnd,
        frequency: EventFrequency.DAILY,
        interval: 1,
      }),
    ]);

    const instances = (service as any).generateInstances(event, new Date('2026-04-01T00:00:00Z'));

    expect(instances.length).toBeGreaterThanOrEqual(2);
    for (const instance of instances) {
      expect(instance.end).toBeNull();
    }
  });

  it('should ignore exclusion schedules when computing duration', () => {
    const start = DateTime.fromISO('2026-04-10T10:00:00');
    const endTime = DateTime.fromISO('2026-04-10T12:00:00');
    const exclusionStart = DateTime.fromISO('2026-04-17T10:00:00');

    const event = createEvent([
      createSchedule({
        startDate: start,
        endDate: DateTime.fromISO('2026-05-10T10:00:00'),
        eventEndTime: endTime,
        frequency: EventFrequency.WEEKLY,
        interval: 1,
      }),
      createSchedule({
        startDate: exclusionStart,
        isExclusion: true,
        // Exclusion has eventEndTime too, but should be ignored for duration
        eventEndTime: DateTime.fromISO('2026-04-17T15:00:00'),
      }),
    ]);

    const instances = (service as any).generateInstances(event, new Date('2026-04-01T00:00:00Z'));

    // All instances should use the 2-hour duration from the non-exclusion schedule
    for (const instance of instances) {
      expect(instance.end).not.toBeNull();
      const durationMinutes = instance.end!.diff(instance.start, 'minutes').minutes;
      expect(durationMinutes).toBe(120);
    }

    // The excluded date should not appear
    const excludedISO = exclusionStart.toISO();
    const instanceStarts = instances.map((i: any) => i.start.toISO());
    expect(instanceStarts).not.toContain(excludedISO);
  });

  describe('minute-truncation invariant', () => {
    // The public instance slug (yyyymmdd-hhmm) and the cache-hit lookup in
    // findOrMaterializeInstanceWithDetails both rely on every stored
    // event_instance.start_time being minute-precise. Generation is the
    // single point where instance start timestamps are first materialized,
    // so this is the guard site. See migration 0025 and spec
    // @docs/superpowers/specs/2026-04-22-instance-timestamp-slug-design.md.

    it('truncates generated non-recurring instance start_time to minute precision', () => {
      const start = DateTime.fromISO('2026-04-10T10:00:42.123', { zone: 'utc' });
      const endTime = DateTime.fromISO('2026-04-10T12:00:00', { zone: 'utc' });

      const event = createEvent([
        createSchedule({ startDate: start, eventEndTime: endTime }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2026-04-01T00:00:00Z'));

      expect(instances).toHaveLength(1);
      expect(instances[0].start.second).toBe(0);
      expect(instances[0].start.millisecond).toBe(0);
    });

    it('truncates every generated recurring instance start_time to minute precision', () => {
      // Sub-minute precision on dtstart would normally be inherited by every
      // rrule expansion. Truncation at generation time ensures stored rows
      // always satisfy the (event_id, start_time) equality lookup.
      const start = DateTime.fromISO('2026-04-10T09:00:17.500', { zone: 'utc' });
      const endTime = DateTime.fromISO('2026-04-10T10:00:17.500', { zone: 'utc' });
      const recurrenceEnd = DateTime.fromISO('2026-05-10T09:00:00', { zone: 'utc' });

      const event = createEvent([
        createSchedule({
          startDate: start,
          endDate: recurrenceEnd,
          eventEndTime: endTime,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2026-04-01T00:00:00Z'));

      expect(instances.length).toBeGreaterThanOrEqual(2);
      for (const instance of instances) {
        expect(instance.start.second).toBe(0);
        expect(instance.start.millisecond).toBe(0);
      }
    });
  });

  describe('byDay parsing', () => {
    // Monthly "first Monday of the month" — the canonical bug case.
    // Sept 2025 first Monday is the 1st; Oct is the 6th; Nov is the 3rd.
    it('should generate "first Monday of the month" for monthly 1MO', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.MONTHLY,
          interval: 1,
          byDay: ['1MO'],
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      // With a 6-month window from now=2025-08-15, we expect the first Monday
      // of each month from Sept 2025 through Feb 2026 (window ends 2026-02-15,
      // so Feb 2's first-Monday is included but a hypothetical March entry is not).
      expect(dates).toEqual([
        '2025-09-01',
        '2025-10-06',
        '2025-11-03',
        '2025-12-01',
        '2026-01-05',
        '2026-02-02',
      ]);
    });

    // Regression guard: when start_date happens to fall on Tuesday, the prior
    // parseInt("1MO") bug silently yielded every Tuesday. Verify the day is
    // honored from the by_day code, not inferred from start_date's weekday.
    it('should honor MO day code even when start_date is a Tuesday', () => {
      // 2025-09-02 is a Tuesday
      const start = DateTime.fromISO('2025-09-02T00:30:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.MONTHLY,
          interval: 1,
          byDay: ['1MO'],
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      // Every generated instance must be a Monday (Luxon weekday 1)
      expect(instances.length).toBeGreaterThan(0);
      for (const inst of instances) {
        expect(inst.start.toUTC().weekday).toBe(1);
      }
    });

    it('should support negative ordinals like -1FR (last Friday of the month)', () => {
      const start = DateTime.fromISO('2025-09-01T12:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.MONTHLY,
          interval: 1,
          byDay: ['-1FR'],
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      // Feb 2026's last Friday is the 27th, which is past the 2026-02-15
      // window end, so it is excluded.
      expect(dates).toEqual([
        '2025-09-26',
        '2025-10-31',
        '2025-11-28',
        '2025-12-26',
        '2026-01-30',
      ]);
    });

    it('should support plain weekday codes for weekly rules (MO, WE, FR)', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' }); // Monday
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
          byDay: ['MO', 'WE', 'FR'],
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      // Assert the first 6 expansions (the full 6-month window contains many
      // more; the shape of the expansion is what matters here, not the count).
      expect(dates.slice(0, 6)).toEqual([
        '2025-09-01', // Mon
        '2025-09-03', // Wed
        '2025-09-05', // Fri
        '2025-09-08', // Mon
        '2025-09-10', // Wed
        '2025-09-12', // Fri
      ]);
    });

    it('should skip unparseable byDay entries rather than coerce them', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.MONTHLY,
          interval: 1,
          byDay: ['garbage', '1MO'],
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      // Garbage entry is filtered out; "1MO" yields first-Monday-of-month
      // expansion across the full 6-month window.
      expect(dates).toEqual([
        '2025-09-01',
        '2025-10-06',
        '2025-11-03',
        '2025-12-01',
        '2026-01-05',
        '2026-02-02',
      ]);
    });

    // Regex-passing but semantically invalid weekday code: "1ZZ" matches the
    // (-?\d+)?([A-Z]{2}) shape but "ZZ" is not in ALL_WEEKDAYS. Verify the
    // validation path returns null and the entry is filtered out.
    it('should skip byDay entries whose day code is not a real weekday', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.MONTHLY,
          interval: 1,
          byDay: ['1ZZ', '1MO'],
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      expect(dates).toEqual([
        '2025-09-01',
        '2025-10-06',
        '2025-11-03',
        '2025-12-01',
        '2026-01-05',
        '2026-02-02',
      ]);
    });
  });

  describe('generation window', () => {
    // Canonical demo-server bug: indefinite monthly schedule with a dtstart
    // far in the past previously expanded the first 10 instances starting at
    // dtstart (so all historical), regardless of "now". The new behavior is a
    // rolling [now, now + 6 months] window anchored at now, so past
    // occurrences wash out and only upcoming ones are materialized.
    it('should generate only upcoming instances when dtstart is in the past', () => {
      const start = DateTime.fromISO('2024-01-01T09:00:00', { zone: 'utc' }); // ~18 months before now
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.MONTHLY,
          interval: 1,
        }),
      ]);

      const now = new Date('2025-08-15T00:00:00Z');
      const instances = (service as any).generateInstances(event, now);
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      // None of the historical occurrences (2024-01 through 2025-07) should
      // appear. First expected instance is 2025-09-01 (first monthly anchor
      // on or after now). Horizon covers through 2026-02-15 so we get six.
      expect(dates).toEqual([
        '2025-09-01',
        '2025-10-01',
        '2025-11-01',
        '2025-12-01',
        '2026-01-01',
        '2026-02-01',
      ]);
    });

    it('should cover approximately 6 months of a weekly schedule', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
        }),
      ]);

      // 6 months ≈ 26 weeks; allow a narrow tolerance for month-length drift.
      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      expect(instances.length).toBeGreaterThanOrEqual(24);
      expect(instances.length).toBeLessThanOrEqual(28);
    });

    it('should honor count-bounded schedules within the window', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
          count: 3,
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      // Exactly 3 from the bounded rule; between() intersects with the window
      // but all 3 are well inside [2025-08-15, 2026-02-15].
      expect(instances).toHaveLength(3);
    });

    it('should honor until-bounded schedules within the window', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const end = DateTime.fromISO('2025-09-22T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          endDate: end,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      expect(dates).toEqual(['2025-09-01', '2025-09-08', '2025-09-15', '2025-09-22']);
    });

    it('should include a non-recurring event whose start is in the future window', () => {
      const start = DateTime.fromISO('2025-10-10T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({ startDate: start }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      expect(instances).toHaveLength(1);
      expect(instances[0].start.toUTC().toISODate()).toBe('2025-10-10');
    });

    // Regression guard against silent read-model drift (PR #182 audit):
    // past non-recurring events MUST be preserved across regenerations so
    // that their event_instance row, shareable anonymous URL (DEC-004),
    // per-event ICS download, and OG meta tags remain stable once the
    // event date has passed. This would previously have been dropped by a
    // naive [now, now + 6mo] window.
    it('should preserve a non-recurring event whose start is in the past', () => {
      const start = DateTime.fromISO('2024-05-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({ startDate: start }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      expect(instances).toHaveLength(1);
      expect(instances[0].start.toUTC().toISODate()).toBe('2024-05-01');
    });

    // Past rdates should still be suppressible by an exdate — exclusions
    // apply uniformly regardless of whether the occurrence is past or future.
    it('should still honor exdate suppression for a past non-recurring event', () => {
      const start = DateTime.fromISO('2024-05-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({ startDate: start }),
        createSchedule({ startDate: start, isExclusion: true }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      expect(instances).toHaveLength(0);
    });
  });

  describe('hidden vs shown cancellations (rrules branching)', () => {
    // Hidden branch: is_exclusion=true AND hide_from_public=true should still
    // silently suppress the occurrence as before — this is the EXDATE-style
    // behavior that must be preserved.
    it('should exclude a hidden cancellation (is_exclusion=true, hide_from_public=true)', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const cancelDate = DateTime.fromISO('2025-09-08T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
          count: 4,
        }),
        createSchedule({
          startDate: cancelDate,
          isExclusion: true,
          hideFromPublic: true,
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      // The cancelled 2025-09-08 occurrence is suppressed; only 3 remain.
      expect(dates).toEqual(['2025-09-01', '2025-09-15', '2025-09-22']);
    });

    // Shown branch: is_exclusion=true AND hide_from_public=false should NOT
    // suppress the occurrence. The underlying rrule still produces it, and
    // markShownCancellations flips isCancelled=true on the matching instance.
    it('should materialize a shown cancellation and mark it isCancelled=true via markShownCancellations', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const cancelDate = DateTime.fromISO('2025-09-08T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
          count: 4,
        }),
        createSchedule({
          startDate: cancelDate,
          isExclusion: true,
          hideFromPublic: false,
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      // The cancelled occurrence is still materialized.
      expect(dates).toEqual(['2025-09-01', '2025-09-08', '2025-09-15', '2025-09-22']);

      // Before markShownCancellations runs, none are flagged.
      for (const inst of instances) {
        expect(inst.isCancelled).toBe(false);
      }

      // Simulate the listing flow: schedules are populated on the event from
      // eager-loaded DB associations before markShownCancellations runs. The
      // in-memory serialization path used by generateInstances discards
      // schedule field values through toObject/fromObject, so tests must
      // re-attach the authoritative schedules — mirroring what list* methods
      // do by mapping EventScheduleEntity.toModel() onto instance.event.
      for (const inst of instances) {
        inst.event.schedules = event.schedules;
      }

      // markShownCancellations flips the matching instance.
      (service as any).markShownCancellations(instances);

      const cancelled = instances.filter((i: any) => i.isCancelled);
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].start.toUTC().toISODate()).toBe('2025-09-08');
    });

    // Regression guard: a shown cancellation must not emit an rdate that would
    // add a new occurrence on top of what the parent rrule already produces.
    // A matching rrule occurrence is always already present, so no duplicate.
    it('should not duplicate an occurrence when a shown cancellation matches an rrule date', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
          count: 2,
        }),
        createSchedule({
          startDate: DateTime.fromISO('2025-09-08T09:00:00', { zone: 'utc' }),
          isExclusion: true,
          hideFromPublic: false,
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      const dates = instances.map((i: any) => i.start.toUTC().toISODate());

      expect(dates).toEqual(['2025-09-01', '2025-09-08']);
      // No duplicate entry for 2025-09-08.
      expect(dates.filter((d: string) => d === '2025-09-08')).toHaveLength(1);
    });

    // DST boundary sanity: when a shown-cancellation schedule's startDate and
    // the materialized instance's start refer to the same UTC instant but are
    // expressed in different zones (one before and one after a DST jump), the
    // match must succeed. We compare by UTC millisecond on both sides, so the
    // zone labels should not matter. This guards against a naive string-equal
    // or wall-clock comparison that could desync across DST.
    it('should match a shown cancellation whose schedule and instance use different zones', () => {
      // US DST starts 2026-03-08. 2026-03-15T09:00:00 America/Denver
      // (MDT, UTC-6) == 2026-03-15T15:00:00Z. Put the cancellation schedule
      // in local Denver time and the instance start in UTC to simulate the
      // realistic flow where DB-loaded schedule times and RRule-expanded
      // instance starts land in different zones after DST.
      const denverCancel = DateTime.fromISO('2026-03-15T09:00:00', { zone: 'America/Denver' });
      const utcCancel = DateTime.fromISO('2026-03-15T15:00:00', { zone: 'utc' });
      expect(denverCancel.toUTC().toMillis()).toBe(utcCancel.toUTC().toMillis());

      const dummyEvent = createEvent([
        createSchedule({
          startDate: DateTime.fromISO('2026-03-01T09:00:00', { zone: 'America/Denver' }),
          frequency: EventFrequency.WEEKLY,
          interval: 1,
          count: 1,
        }),
        createSchedule({
          startDate: denverCancel,
          isExclusion: true,
          hideFromPublic: false,
        }),
      ]);

      // Synthesize instances directly so the test stays focused on the
      // matching logic (independent of any RRule + DST expansion quirks).
      const matchingInstance = new CalendarEventInstance(
        uuidv4(),
        dummyEvent,
        utcCancel,
        null,
      );
      const nonMatchingInstance = new CalendarEventInstance(
        uuidv4(),
        dummyEvent,
        DateTime.fromISO('2026-03-22T15:00:00', { zone: 'utc' }),
        null,
      );
      // Re-attach authoritative schedules (see note in preceding test).
      matchingInstance.event.schedules = dummyEvent.schedules;
      nonMatchingInstance.event.schedules = dummyEvent.schedules;

      (service as any).markShownCancellations([matchingInstance, nonMatchingInstance]);

      expect(matchingInstance.isCancelled).toBe(true);
      expect(nonMatchingInstance.isCancelled).toBe(false);
    });

    // markShownCancellations must be a no-op when there are no shown-cancellation
    // schedules (the common case) so it doesn't produce false positives.
    it('should leave instances untouched when there are no shown cancellations', () => {
      const start = DateTime.fromISO('2025-09-01T09:00:00', { zone: 'utc' });
      const event = createEvent([
        createSchedule({
          startDate: start,
          frequency: EventFrequency.WEEKLY,
          interval: 1,
          count: 3,
        }),
      ]);

      const instances = (service as any).generateInstances(event, new Date('2025-08-15T00:00:00Z'));
      (service as any).markShownCancellations(instances);

      for (const inst of instances) {
        expect(inst.isCancelled).toBe(false);
      }
    });
  });
});

/**
 * Tests for the endDate/eventEndTime sync rule inside EventService.createEventSchedule.
 *
 * These tests call through the real service method with EventScheduleEntity.prototype.save
 * stubbed so that no database is required. This verifies the sync logic is actually
 * exercised by the service, not merely re-implemented inline.
 */
describe('EventService.createEventSchedule — endDate/eventEndTime sync', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventService(new EventEmitter());
    sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should set endDate to eventEndTime for non-recurring schedules', async () => {
    const eventId = uuidv4();
    const schedule = await service.createEventSchedule(eventId, {
      start: '2026-04-10T10:00:00',
      eventEndTime: '2026-04-10T12:00:00',
    });

    expect(schedule.endDate).not.toBeNull();
    expect(schedule.endDate!.toISO()).toBe(schedule.eventEndTime!.toISO());
  });

  it('should not override endDate for recurring schedules', async () => {
    const eventId = uuidv4();
    const schedule = await service.createEventSchedule(eventId, {
      start: '2026-04-10T10:00:00',
      end: '2026-06-10T10:00:00',
      eventEndTime: '2026-04-10T12:00:00',
      frequency: 'weekly',
      interval: 1,
    });

    // endDate should remain the recurrence end, not eventEndTime
    expect(schedule.endDate!.toISO()).not.toBe(schedule.eventEndTime!.toISO());
    expect(schedule.endDate!.toISO()).toBe(
      DateTime.fromISO('2026-06-10T10:00:00').toISO(),
    );
  });

  it('should not set endDate when eventEndTime is absent', async () => {
    const eventId = uuidv4();
    const schedule = await service.createEventSchedule(eventId, {
      start: '2026-04-10T10:00:00',
    });

    expect(schedule.endDate).toBeNull();
  });
});


/**
 * Tests for EventInstanceService.listUpcomingOccurrences.
 *
 * The method is pure in the sense that it only reads from the event's
 * in-memory schedules and expands the RRuleSet — no DB access is required.
 * Fixtures are built as CalendarEventSchedule instances attached to a
 * CalendarEvent so the tests stay strictly unit-tier.
 */
describe('EventInstanceService.listUpcomingOccurrences', () => {
  let service: EventInstanceService;

  function makeSchedule(opts: {
    id?: string;
    startDate: DateTime;
    endDate?: DateTime | null;
    frequency?: EventFrequency | null;
    interval?: number;
    count?: number;
    byDay?: string[];
    isExclusion?: boolean;
    hideFromPublic?: boolean;
  }): CalendarEventSchedule {
    const schedule = new CalendarEventSchedule(
      opts.id ?? uuidv4(),
      opts.startDate,
      opts.endDate ?? undefined,
    );
    schedule.frequency = opts.frequency ?? null;
    schedule.interval = opts.interval ?? 0;
    schedule.count = opts.count ?? 0;
    schedule.byDay = opts.byDay ?? [];
    schedule.isExclusion = opts.isExclusion ?? false;
    schedule.hideFromPublic = opts.hideFromPublic ?? true;
    return schedule;
  }

  function buildWeeklyEvent(opts: {
    startIso: string;
    byDay?: string[];
    count?: number;
  }): CalendarEvent {
    const event = new CalendarEvent(uuidv4(), uuidv4());
    event.schedules = [
      makeSchedule({
        startDate: DateTime.fromISO(opts.startIso, { zone: 'utc' }),
        frequency: EventFrequency.WEEKLY,
        interval: 1,
        byDay: opts.byDay ?? [],
        count: opts.count ?? 0,
      }),
    ];
    return event;
  }

  function buildMonthlyEvent(opts: {
    startIso: string;
    count?: number;
  }): CalendarEvent {
    const event = new CalendarEvent(uuidv4(), uuidv4());
    event.schedules = [
      makeSchedule({
        startDate: DateTime.fromISO(opts.startIso, { zone: 'utc' }),
        frequency: EventFrequency.MONTHLY,
        interval: 1,
        count: opts.count ?? 0,
      }),
    ];
    return event;
  }

  function buildYearlyEvent(opts: {
    startIso: string;
    count?: number;
  }): CalendarEvent {
    const event = new CalendarEvent(uuidv4(), uuidv4());
    event.schedules = [
      makeSchedule({
        startDate: DateTime.fromISO(opts.startIso, { zone: 'utc' }),
        frequency: EventFrequency.YEARLY,
        interval: 1,
        count: opts.count ?? 0,
      }),
    ];
    return event;
  }

  beforeEach(() => {
    service = new EventInstanceService(new EventEmitter());
  });

  it('returns the next N occurrences for a weekly event starting at afterDate', async () => {
    const event = buildWeeklyEvent({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });

    const after = DateTime.fromISO('2026-05-04T00:00:00Z', { zone: 'utc' });
    const result = await service.listUpcomingOccurrences(event, after, 5);

    expect(result.occurrences).toHaveLength(5);
    expect(result.occurrences[0].start.toISO()).toBe('2026-05-04T10:00:00.000Z');
    expect(result.occurrences[4].start.toISO()).toBe('2026-06-01T10:00:00.000Z');
    expect(result.occurrences.every(o => o.state === 'active')).toBe(true);
    expect(result.occurrences.every(o => o.scheduleId === null)).toBe(true);
    expect(result.hasMore).toBe(true);
  });

  it('returns the next N occurrences for a monthly event', async () => {
    const event = buildMonthlyEvent({ startIso: '2026-05-15T09:00:00Z' });

    const after = DateTime.fromISO('2026-05-01T00:00:00Z', { zone: 'utc' });
    const result = await service.listUpcomingOccurrences(event, after, 3);

    expect(result.occurrences).toHaveLength(3);
    expect(result.occurrences[0].start.toISO()).toBe('2026-05-15T09:00:00.000Z');
    expect(result.occurrences[1].start.toISO()).toBe('2026-06-15T09:00:00.000Z');
    expect(result.occurrences[2].start.toISO()).toBe('2026-07-15T09:00:00.000Z');
    expect(result.hasMore).toBe(true);
  });

  it('returns the next N occurrences for a yearly event', async () => {
    const event = buildYearlyEvent({ startIso: '2026-07-04T12:00:00Z' });

    const after = DateTime.fromISO('2026-01-01T00:00:00Z', { zone: 'utc' });
    const result = await service.listUpcomingOccurrences(event, after, 3);

    expect(result.occurrences).toHaveLength(3);
    expect(result.occurrences[0].start.toISO()).toBe('2026-07-04T12:00:00.000Z');
    expect(result.occurrences[1].start.toISO()).toBe('2027-07-04T12:00:00.000Z');
    expect(result.occurrences[2].start.toISO()).toBe('2028-07-04T12:00:00.000Z');
    expect(result.hasMore).toBe(true);
  });

  it('honors afterDate cursor by excluding occurrences at or before afterDate', async () => {
    const event = buildWeeklyEvent({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });

    // afterDate = second occurrence's start. Result must start strictly after.
    const after = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
    const result = await service.listUpcomingOccurrences(event, after, 3);

    expect(result.occurrences[0].start.toISO()).toBe('2026-05-18T10:00:00.000Z');
  });

  it('returns hasMore=false for a bounded recurrence whose count < limit', async () => {
    const event = buildWeeklyEvent({
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
    const event = buildWeeklyEvent({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    // Add a shown exclusion for the second occurrence (2026-05-11T10:00Z).
    event.schedules.push(makeSchedule({
      id: 'shown-excl-id-0000',
      startDate: DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' }),
      isExclusion: true,
      hideFromPublic: false,
    }));

    const after = DateTime.fromISO('2026-05-03T00:00:00Z', { zone: 'utc' });
    const result = await service.listUpcomingOccurrences(event, after, 3);

    const target = result.occurrences.find(o => o.start.toISO() === '2026-05-11T10:00:00.000Z');
    expect(target?.state).toBe('cancelled-shown');
    expect(target?.scheduleId).toBe('shown-excl-id-0000');
  });

  it('surfaces a hidden-cancellation date with state=hidden even though rrule suppresses it', async () => {
    const event = buildWeeklyEvent({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
    });
    event.schedules.push(makeSchedule({
      id: 'hidden-excl-id-000',
      startDate: DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' }),
      isExclusion: true,
      hideFromPublic: true,
    }));

    const after = DateTime.fromISO('2026-05-03T00:00:00Z', { zone: 'utc' });
    const result = await service.listUpcomingOccurrences(event, after, 3);

    const target = result.occurrences.find(o => o.start.toISO() === '2026-05-11T10:00:00.000Z');
    expect(target?.state).toBe('hidden');
    expect(target?.scheduleId).toBe('hidden-excl-id-000');
  });

  it('sets hasMore=true when hidden exclusions push returned count below limit but more occurrences exist', async () => {
    // Weekly bounded at count=4. Two of those get hidden exclusions.
    // With limit=2, we expect: 2 active + 2 hidden = 4 merged; hasMore=true
    // because merged.length > limit even though RRule itself exhausted.
    const event = buildWeeklyEvent({
      startIso: '2026-05-04T10:00:00Z',
      byDay: ['MO'],
      count: 4,
    });
    // Hide 3rd (2026-05-18) and 4th (2026-05-25) occurrences.
    event.schedules.push(makeSchedule({
      id: 'hidden-a',
      startDate: DateTime.fromISO('2026-05-18T10:00:00Z', { zone: 'utc' }),
      isExclusion: true,
      hideFromPublic: true,
    }));
    event.schedules.push(makeSchedule({
      id: 'hidden-b',
      startDate: DateTime.fromISO('2026-05-25T10:00:00Z', { zone: 'utc' }),
      isExclusion: true,
      hideFromPublic: true,
    }));

    const after = DateTime.fromISO('2026-05-03T00:00:00Z', { zone: 'utc' });
    const result = await service.listUpcomingOccurrences(event, after, 2);

    // Window of 2 returns the first 2 merged entries (both active).
    expect(result.occurrences).toHaveLength(2);
    expect(result.occurrences[0].state).toBe('active');
    expect(result.occurrences[1].state).toBe('active');
    // hasMore is true because 2 hidden exclusions fell outside the first `limit` slots.
    expect(result.hasMore).toBe(true);
  });
});

/**
 * Tests for EventInstanceService.cancelOccurrenceByDate and
 * .restoreOccurrenceByDate.
 *
 * These tests stub the database-facing surface (EventEntity.findByPk,
 * EventScheduleEntity.findOne, prototype save/destroy) so the service's
 * authorization, idempotency, rrule-match validation, and bus-emit logic
 * can be exercised without a live database connection.
 *
 * Write-side DB-backed integration coverage for these methods is exercised
 * via the existing cancel-instance API integration tests (which ultimately
 * call through to the same writeExclusionRow / deleteExclusionRow helpers).
 */
describe('EventInstanceService.cancelOccurrenceByDate / restoreOccurrenceByDate', () => {
  let service: EventInstanceService;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox;

  const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
  const EVENT_ID = '66666666-6666-4666-8666-666666666666';
  const CALENDAR_ID = '77777777-7777-4777-8777-777777777777';

  // A weekly (Monday) recurring schedule starting 2026-05-04T10:00:00Z.
  const SCHEDULE_START = DateTime.fromISO('2026-05-04T10:00:00Z', { zone: 'utc' });
  // Second Monday — falls on the rrule.
  const MATCHING_START = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
  // Thursday — does NOT fall on the Mondays-only rrule.
  const NON_MATCHING_START = DateTime.fromISO('2026-05-14T10:00:00Z', { zone: 'utc' });

  function makeAccount(): Account {
    return new Account(ACCOUNT_ID, 'editor', 'editor@example.com');
  }

  function makeCalendar(): Calendar {
    return new Calendar(CALENDAR_ID, 'test-calendar');
  }

  /**
   * Builds an EventEntity with a weekly Monday schedule eager-loaded.
   * The schedule entity is attached via setDataValue so the service's
   * `eventEntity.getDataValue('schedules')` call returns it as if it
   * were loaded by Sequelize's `include: [EventScheduleEntity]`.
   */
  function stubEventWithWeeklyMondaySchedule(): EventEntity {
    const eventEntity = EventEntity.build({
      id: EVENT_ID,
      calendar_id: CALENDAR_ID,
    });
    const scheduleEntity = EventScheduleEntity.build({
      id: uuidv4(),
      event_id: EVENT_ID,
      timezone: 'UTC',
      start_date: SCHEDULE_START.toJSDate(),
      end_date: null,
      event_end_time: null,
      frequency: EventFrequency.WEEKLY,
      interval: 1,
      count: 0,
      by_day: 'MO',
      is_exclusion: false,
      hide_from_public: false,
    });
    eventEntity.setDataValue('schedules', [scheduleEntity] as any);
    return eventEntity;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new EventInstanceService(eventBus);

    // Default stubs — individual tests override as needed.
    sandbox.stub(service['calendarService'], 'getCalendar').resolves(makeCalendar());
    sandbox.stub(service['calendarService'], 'editableCalendarsForUser').resolves([makeCalendar()]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('cancelOccurrenceByDate', () => {
    it('creates a new exclusion row when the date matches an rrule occurrence and emits eventInstanceCancelled', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      sandbox.stub(EventScheduleEntity, 'findOne').resolves(null);
      const saveStub = sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.cancelOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START, false);

      expect(saveStub.calledOnce).toBe(true);
      expect(emitSpy.calledWith('eventInstanceCancelled')).toBe(true);
      const payload = emitSpy.getCalls().find(c => c.args[0] === 'eventInstanceCancelled')!.args[1];
      expect(payload.calendar.id).toBe(CALENDAR_ID);
      expect(payload.event.id).toBe(EVENT_ID);
      expect(payload).not.toHaveProperty('instanceId');
      expect(payload.hideFromPublic).toBe(false);
    });

    it('throws InvalidOccurrenceDateError when the date does not match the rrule', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      const findOneStub = sandbox.stub(EventScheduleEntity, 'findOne').resolves(null);
      const saveStub = sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

      await expect(
        service.cancelOccurrenceByDate(makeAccount(), EVENT_ID, NON_MATCHING_START, false),
      ).rejects.toMatchObject({ name: 'InvalidOccurrenceDateError' });

      // Nothing should have been written when validation fails.
      expect(findOneStub.called).toBe(false);
      expect(saveStub.called).toBe(false);
    });

    it('throws EventNotFoundError when the event does not exist', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(null);

      await expect(
        service.cancelOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START, false),
      ).rejects.toMatchObject({ name: 'EventNotFoundError' });
    });

    it('throws InsufficientCalendarPermissionsError for non-editor accounts', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      (service['calendarService'].editableCalendarsForUser as sinon.SinonStub).resolves([]);

      await expect(
        service.cancelOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START, false),
      ).rejects.toMatchObject({ name: 'InsufficientCalendarPermissionsError' });
    });

    it('is idempotent when cancelling the same date with the same mode', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      const existing = EventScheduleEntity.build({
        id: uuidv4(),
        event_id: EVENT_ID,
        start_date: MATCHING_START.toJSDate(),
        is_exclusion: true,
        hide_from_public: false,
      });
      sandbox.stub(EventScheduleEntity, 'findOne').resolves(existing);
      const saveStub = sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.cancelOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START, false);

      // Same row, same mode → no save, no emit.
      expect(saveStub.called).toBe(false);
      expect(emitSpy.calledWith('eventInstanceCancelled')).toBe(false);
    });

    it('flips hide_from_public in place when re-cancelled in a different mode', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      const existing = EventScheduleEntity.build({
        id: uuidv4(),
        event_id: EVENT_ID,
        start_date: MATCHING_START.toJSDate(),
        is_exclusion: true,
        hide_from_public: false,
      });
      sandbox.stub(EventScheduleEntity, 'findOne').resolves(existing);
      const saveStub = sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.cancelOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START, true);

      expect(existing.hide_from_public).toBe(true);
      expect(saveStub.calledOnce).toBe(true);
      const payload = emitSpy.getCalls().find(c => c.args[0] === 'eventInstanceCancelled')!.args[1];
      expect(payload.hideFromPublic).toBe(true);
    });
  });

  describe('restoreOccurrenceByDate', () => {
    it('deletes the exclusion row for the date when one exists and emits eventInstanceRestored', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      const existing = EventScheduleEntity.build({
        id: uuidv4(),
        event_id: EVENT_ID,
        start_date: MATCHING_START.toJSDate(),
        is_exclusion: true,
        hide_from_public: true,
      });
      sandbox.stub(EventScheduleEntity, 'findOne').resolves(existing);
      const destroyStub = sandbox.stub(EventScheduleEntity.prototype, 'destroy').resolves();

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.restoreOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START);

      expect(destroyStub.calledOnce).toBe(true);
      expect(emitSpy.calledWith('eventInstanceRestored')).toBe(true);
      const payload = emitSpy.getCalls().find(c => c.args[0] === 'eventInstanceRestored')!.args[1];
      expect(payload.calendar.id).toBe(CALENDAR_ID);
      expect(payload.event.id).toBe(EVENT_ID);
      expect(payload).not.toHaveProperty('instanceId');
    });

    it('is a silent no-op when no exclusion row exists for the date', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      sandbox.stub(EventScheduleEntity, 'findOne').resolves(null);
      const destroyStub = sandbox.stub(EventScheduleEntity.prototype, 'destroy').resolves();

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await expect(
        service.restoreOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START),
      ).resolves.not.toThrow();

      // No row → no destroy, and no bus emit (documented restore-only-on-change).
      expect(destroyStub.called).toBe(false);
      expect(emitSpy.calledWith('eventInstanceRestored')).toBe(false);
    });

    it('does not validate rrule match for restore (accepts any date — documented asymmetry)', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      sandbox.stub(EventScheduleEntity, 'findOne').resolves(null);
      sandbox.stub(EventScheduleEntity.prototype, 'destroy').resolves();

      // A Thursday start — not produced by the Mondays-only rrule. Cancel
      // would throw InvalidOccurrenceDateError here; restore must not.
      await expect(
        service.restoreOccurrenceByDate(makeAccount(), EVENT_ID, NON_MATCHING_START),
      ).resolves.not.toThrow();
    });

    it('throws InsufficientCalendarPermissionsError for non-editor accounts', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(stubEventWithWeeklyMondaySchedule());
      (service['calendarService'].editableCalendarsForUser as sinon.SinonStub).resolves([]);

      await expect(
        service.restoreOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START),
      ).rejects.toMatchObject({ name: 'InsufficientCalendarPermissionsError' });
    });

    it('throws EventNotFoundError when the event does not exist', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(null);

      await expect(
        service.restoreOccurrenceByDate(makeAccount(), EVENT_ID, MATCHING_START),
      ).rejects.toMatchObject({ name: 'EventNotFoundError' });
    });
  });
});

/**
 * Tests for EventInstanceService.findOrMaterializeInstanceWithDetails.
 *
 * The method composes: a cache-hit fast path on EventInstanceEntity, a slow
 * path that loads the event, validates against the RRuleSet, enforces a
 * pre-flight horizon guard and a per-event materialization cap, handles
 * shown/hidden exclusions, and protects against concurrent-miss races via a
 * unique-constraint catch.
 *
 * These tests stub the Sequelize static calls and the private hydration
 * helper so the branching logic is exercised without a live database. The
 * end-to-end race-loser path is covered by the public-API integration suite
 * (Task 5 in the plan) — a unit stub can only test the mock.
 */
describe('EventInstanceService.findOrMaterializeInstanceWithDetails', () => {
  let service: EventInstanceService;
  let sandbox: sinon.SinonSandbox;

  const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const CALENDAR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const INSTANCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  // Weekly Monday schedule anchored at a Monday.
  const SCHEDULE_START = DateTime.fromISO('2026-05-04T10:00:00Z', { zone: 'utc' });
  // Second Monday — matches the rrule.
  const MATCHING_START = DateTime.fromISO('2026-05-11T10:00:00Z', { zone: 'utc' });
  // Thursday same week — NOT on a Monday, will not match.
  const NON_MATCHING_START = DateTime.fromISO('2026-05-14T10:00:00Z', { zone: 'utc' });

  /**
   * Build an EventEntity with a weekly-Monday schedule eager-loaded.
   * Mirrors stubEventWithWeeklyMondaySchedule above but lives in this describe
   * block so the find-or-materialize suite is self-contained.
   */
  function buildEventWithWeeklyMondaySchedule(): EventEntity {
    const eventEntity = EventEntity.build({
      id: EVENT_ID,
      calendar_id: CALENDAR_ID,
    });
    const scheduleEntity = EventScheduleEntity.build({
      id: uuidv4(),
      event_id: EVENT_ID,
      timezone: 'UTC',
      start_date: SCHEDULE_START.toJSDate(),
      end_date: null,
      event_end_time: null,
      frequency: EventFrequency.WEEKLY,
      interval: 1,
      count: 0,
      by_day: 'MO',
      is_exclusion: false,
      hide_from_public: false,
    });
    eventEntity.setDataValue('schedules', [scheduleEntity] as any);
    return eventEntity;
  }

  /**
   * Build an EventEntity with a weekly-Monday recurring schedule PLUS a
   * matching shown/hidden exclusion schedule for MATCHING_START.
   */
  function buildEventWithExclusion(hideFromPublic: boolean): EventEntity {
    const eventEntity = EventEntity.build({
      id: EVENT_ID,
      calendar_id: CALENDAR_ID,
    });
    const baseSchedule = EventScheduleEntity.build({
      id: uuidv4(),
      event_id: EVENT_ID,
      timezone: 'UTC',
      start_date: SCHEDULE_START.toJSDate(),
      end_date: null,
      event_end_time: null,
      frequency: EventFrequency.WEEKLY,
      interval: 1,
      count: 0,
      by_day: 'MO',
      is_exclusion: false,
      hide_from_public: false,
    });
    const exclusion = EventScheduleEntity.build({
      id: uuidv4(),
      event_id: EVENT_ID,
      timezone: 'UTC',
      start_date: MATCHING_START.toJSDate(),
      end_date: null,
      event_end_time: null,
      frequency: null,
      interval: 0,
      count: 0,
      by_day: null,
      is_exclusion: true,
      hide_from_public: hideFromPublic,
    });
    eventEntity.setDataValue('schedules', [baseSchedule, exclusion] as any);
    return eventEntity;
  }

  /**
   * Build an EventEntity with an unbounded DAILY recurring schedule anchored
   * well in the past. Used by the pre-flight-horizon test to model a schedule
   * that would otherwise produce occurrences decades out.
   */
  function buildUnboundedDailyEvent(dtstart: DateTime): EventEntity {
    const eventEntity = EventEntity.build({
      id: EVENT_ID,
      calendar_id: CALENDAR_ID,
    });
    const schedule = EventScheduleEntity.build({
      id: uuidv4(),
      event_id: EVENT_ID,
      timezone: 'UTC',
      start_date: dtstart.toJSDate(),
      end_date: null,
      event_end_time: null,
      frequency: EventFrequency.DAILY,
      interval: 1,
      count: 0,
      by_day: null,
      is_exclusion: false,
      hide_from_public: false,
    });
    eventEntity.setDataValue('schedules', [schedule] as any);
    return eventEntity;
  }

  /**
   * Build a pre-existing instance entity eager-loaded with the event for use
   * on the cache-hit path.
   */
  function buildCachedInstanceEntity(eventEntity: EventEntity, start: DateTime): EventInstanceEntity {
    const instance = EventInstanceEntity.build({
      id: INSTANCE_ID,
      event_id: EVENT_ID,
      calendar_id: CALENDAR_ID,
      start_time: start.toJSDate(),
      end_time: null,
    });
    (instance as any).event = eventEntity;
    return instance;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventInstanceService(new EventEmitter());

    // Neutralize cross-domain side-effects. These paths are covered by the
    // getEventInstanceWithDetails tests elsewhere; here we want to exercise
    // only the find-or-materialize branching logic.
    sandbox.stub(service['categoryService'], 'getEventCategories').resolves([]);
    sandbox.stub(service as any, 'fetchRemoteActorUriMap').resolves(new Map());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns the hydrated existing row when one already matches (event_id, start_time)', async () => {
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    const cached = buildCachedInstanceEntity(eventEntity, MATCHING_START);
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(cached);

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(INSTANCE_ID);
    expect(result!.start.toMillis()).toBe(MATCHING_START.toMillis());
  });

  it('forwards an explicit displayCalendarId to getEventCategories so reposted events resolve display-calendar mappings', async () => {
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    const cached = buildCachedInstanceEntity(eventEntity, MATCHING_START);
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(cached);

    // Replace the no-arg stub with one we can inspect — the row's calendar_id
    // is the originating calendar but the caller passes a different display
    // calendar id (the repost target). The override must win.
    (service['categoryService'].getEventCategories as sinon.SinonStub).restore();
    const categoryStub = sandbox.stub(service['categoryService'], 'getEventCategories').resolves([]);

    await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START, 'display-cal-id');

    expect(categoryStub.calledOnce).toBe(true);
    const [, calendarIdArg] = categoryStub.firstCall.args;
    expect(calendarIdArg).toBe('display-cal-id');
  });

  it('falls back to the row calendar_id when no displayCalendarId override is provided', async () => {
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    const cached = buildCachedInstanceEntity(eventEntity, MATCHING_START);
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(cached);

    (service['categoryService'].getEventCategories as sinon.SinonStub).restore();
    const categoryStub = sandbox.stub(service['categoryService'], 'getEventCategories').resolves([]);

    await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(categoryStub.calledOnce).toBe(true);
    const [, calendarIdArg] = categoryStub.firstCall.args;
    expect(calendarIdArg).toBe(CALENDAR_ID);
  });

  it('short-circuits RRule validation on cache hit', async () => {
    // Even if the current schedule would reject the date, a pre-existing row
    // is authoritative: the RRule-check must not be invoked on the cache-hit
    // path.
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    const cached = buildCachedInstanceEntity(eventEntity, MATCHING_START);
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(cached);
    const assertStub = sandbox.stub(service as any, 'assertDateMatchesOccurrence')
      .throws(new Error('RRule should not be called on cache hit'));

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(INSTANCE_ID);
    expect(assertStub.called).toBe(false);
  });

  it('materializes and persists a new row on cache miss when the date matches the RRuleSet', async () => {
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    const findOneStub = sandbox.stub(EventInstanceEntity, 'findOne');
    // First call: cache miss. Second call: post-save re-fetch.
    findOneStub.onFirstCall().resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    sandbox.stub(EventInstanceEntity, 'count').resolves(0);
    const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();
    const postSaveRow = buildCachedInstanceEntity(eventEntity, MATCHING_START);
    findOneStub.onSecondCall().resolves(postSaveRow);

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(saveStub.calledOnce).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.start.toMillis()).toBe(MATCHING_START.toMillis());
  });

  it('returns null when the start time does not match any occurrence', async () => {
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    const countStub = sandbox.stub(EventInstanceEntity, 'count').resolves(0);
    const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();

    const result = await service.findOrMaterializeInstanceWithDetails(
      EVENT_ID,
      NON_MATCHING_START,
    );

    expect(result).toBeNull();
    // Nothing should have been persisted for a non-matching date.
    expect(countStub.called).toBe(false);
    expect(saveStub.called).toBe(false);
  });

  it('returns null when the event does not exist', async () => {
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(null);

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);
    expect(result).toBeNull();
  });

  it('returns null for a hidden-cancelled occurrence (exclusion with hide_from_public=true)', async () => {
    const eventEntity = buildEventWithExclusion(true);
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    const countStub = sandbox.stub(EventInstanceEntity, 'count').resolves(0);
    const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(result).toBeNull();
    // Hidden exclusion must NOT materialize — count/save must not be called.
    expect(countStub.called).toBe(false);
    expect(saveStub.called).toBe(false);
  });

  it('returns a cancelled in-memory instance for a shown-cancelled occurrence without persisting', async () => {
    const eventEntity = buildEventWithExclusion(false);
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    const countStub = sandbox.stub(EventInstanceEntity, 'count').resolves(0);
    const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(result).not.toBeNull();
    expect(result!.isCancelled).toBe(true);
    expect(result!.start.toMillis()).toBe(MATCHING_START.toMillis());
    // Shown cancellation must NOT materialize — count/save must not be called.
    expect(countStub.called).toBe(false);
    expect(saveStub.called).toBe(false);
  });

  it('rejects an unbounded-recurring schedule probed far beyond the horizon (pre-flight guard)', async () => {
    // DAILY schedule with no UNTIL/COUNT starting far in the past. Probing
    // many years in the future is within DateTime representable bounds but
    // beyond the unbounded-preflight horizon, so the guard must fire BEFORE
    // assertDateMatchesOccurrence runs.
    const eventEntity = buildUnboundedDailyEvent(
      DateTime.fromISO('2020-01-01T00:00:00Z', { zone: 'utc' }),
    );
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    const assertStub = sandbox.stub(service as any, 'assertDateMatchesOccurrence')
      .throws(new Error('RRule should not be called when pre-flight guard triggers'));
    const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();

    const farFuture = DateTime.utc().plus({ years: 20 });
    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, farFuture);

    expect(result).toBeNull();
    expect(assertStub.called).toBe(false);
    expect(saveStub.called).toBe(false);
  });

  it('lets a probe just outside the unbounded horizon hit the guard, not RRule', async () => {
    // Boundary case: UNBOUNDED_PREFLIGHT_MONTHS = GENERATION_HORIZON_MONTHS + 12.
    // A probe a few months past the horizon must short-circuit at the guard.
    const eventEntity = buildUnboundedDailyEvent(
      DateTime.fromISO('2020-01-01T00:00:00Z', { zone: 'utc' }),
    );
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    const assertStub = sandbox.stub(service as any, 'assertDateMatchesOccurrence')
      .throws(new Error('RRule should not be called past horizon'));

    const justOutside = DateTime.utc().plus({ months: 30 }); // > 18 months
    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, justOutside);

    expect(result).toBeNull();
    expect(assertStub.called).toBe(false);
  });

  it('lets a probe just inside the unbounded horizon reach RRule validation', async () => {
    // Boundary case: a probe inside the 18-month window must NOT be filtered
    // by the pre-flight guard. The RRule-membership step then decides.
    const eventEntity = buildUnboundedDailyEvent(
      DateTime.fromISO('2020-01-01T00:00:00Z', { zone: 'utc' }),
    );
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    // Stub assertDateMatchesOccurrence so we can prove it WAS reached.
    const assertStub = sandbox.stub(service as any, 'assertDateMatchesOccurrence')
      .resolves(undefined);
    sandbox.stub(EventInstanceEntity, 'count').resolves(0);
    const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();
    sandbox.stub(EventInstanceEntity, 'findOne')
      .onFirstCall().resolves(null)
      .onSecondCall().resolves(buildCachedInstanceEntity(eventEntity, MATCHING_START));

    const justInside = DateTime.utc().plus({ months: 6 });
    await service.findOrMaterializeInstanceWithDetails(EVENT_ID, justInside);

    // Guard did NOT fire — the RRule check was reached.
    expect(assertStub.called).toBe(true);
    expect(saveStub.called).toBe(true);
  });

  it('refuses to materialize when the event already has MATERIALIZATION_CAP rows', async () => {
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    // Stub count to exactly the documented default cap (1000). Hardcoded
    // rather than read from getMaterializationCap() so a regression in the
    // default value would surface here.
    sandbox.stub(EventInstanceEntity, 'count').resolves(1000);
    const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(result).toBeNull();
    expect(saveStub.called).toBe(false);
  });

  it('returns an instance with end=null when the schedule has no configured event_end_time', async () => {
    // buildEventWithWeeklyMondaySchedule has event_end_time=null — the happy
    // path produces an instance whose end is null.
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    const findOneStub = sandbox.stub(EventInstanceEntity, 'findOne');
    findOneStub.onFirstCall().resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    sandbox.stub(EventInstanceEntity, 'count').resolves(0);
    sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();
    const postSave = buildCachedInstanceEntity(eventEntity, MATCHING_START);
    findOneStub.onSecondCall().resolves(postSave);

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(result).not.toBeNull();
    expect(result!.end).toBeNull();
  });

  it('recovers from SequelizeUniqueConstraintError on concurrent-miss race by re-fetching the winner', async () => {
    // Simulate the racer-loser path: cache miss, event loads, RRule matches,
    // we attempt to save, but the database raises a unique-violation because
    // the concurrent winner inserted the same (event_id, start_time) row
    // first. The catch must swallow the error and re-fetch the row.
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    const findOneStub = sandbox.stub(EventInstanceEntity, 'findOne');
    findOneStub.onFirstCall().resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    sandbox.stub(EventInstanceEntity, 'count').resolves(0);

    const uniqueErr = new Error('duplicate key value violates unique constraint');
    (uniqueErr as any).name = 'SequelizeUniqueConstraintError';
    sandbox.stub(EventInstanceEntity.prototype, 'save').rejects(uniqueErr);

    const winnerRow = buildCachedInstanceEntity(eventEntity, MATCHING_START);
    findOneStub.onSecondCall().resolves(winnerRow);

    const result = await service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(INSTANCE_ID);
  });

  it('re-throws non-unique-violation save errors rather than swallowing them', async () => {
    // Any error from .save() that is NOT a SequelizeUniqueConstraintError
    // must propagate to the caller — we only want to absorb the known race.
    const eventEntity = buildEventWithWeeklyMondaySchedule();
    sandbox.stub(EventInstanceEntity, 'findOne').resolves(null);
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    sandbox.stub(EventInstanceEntity, 'count').resolves(0);

    const dbErr = new Error('connection refused');
    (dbErr as any).name = 'SequelizeConnectionError';
    sandbox.stub(EventInstanceEntity.prototype, 'save').rejects(dbErr);

    await expect(
      service.findOrMaterializeInstanceWithDetails(EVENT_ID, MATCHING_START),
    ).rejects.toMatchObject({ name: 'SequelizeConnectionError' });
  });
});

/**
 * Tests for the search predicate built by listEventInstancesWithFilters.
 *
 * Guards against regressing the SQL-injection fix from pv-qynz: user input
 * must flow through Sequelize's parameterized where(fn, op) helper, never
 * via Sequelize.literal() with string interpolation. Also asserts the
 * 200-char service-boundary cap that bounds query cost on hostile public
 * input — see security-playbook/database-injection.md and
 * security-playbook/public-api.md.
 */
describe('EventInstanceService.listEventInstancesWithFilters — search predicate safety', () => {
  let service: EventInstanceService;
  let sandbox: sinon.SinonSandbox;
  let testCalendar: Calendar;

  /**
   * Walks the where clause produced for the search filter and returns the
   * LIKE patterns bound to each branch. The branches are Sequelize Where
   * instances created via where(fn(...), { [Op.like]: pattern }), so the
   * bound value lives on `.logic[Op.like]`.
   */
  function extractLikePatterns(whereClause: any): string[] {
    const patterns: string[] = [];
    const orConditions = whereClause?.[Op.or];
    if (!Array.isArray(orConditions)) return patterns;
    for (const condition of orConditions) {
      const pattern = condition?.logic?.[Op.like];
      if (typeof pattern === 'string') {
        patterns.push(pattern);
      }
    }
    return patterns;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventInstanceService(new EventEmitter());
    testCalendar = new Calendar('cal-id', 'testcal');

    // Stub the visibility helper to return a non-empty list so the search
    // branch in listEventInstancesWithFilters is exercised.
    sandbox.stub((service as any).eventService, 'listEventIdsForCalendar')
      .resolves(['event-1']);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('builds a parameterized Op.or predicate, not a Sequelize.literal, for the search filter', async () => {
    const findAllStub = sandbox.stub(EventInstanceEntity, 'findAll').resolves([]);

    // Hostile input: every metacharacter that previously had to be escaped
    // by hand inside a literal() — single quote, semicolon, comment marker,
    // backslash, and a PostgreSQL escape sequence (E'\\' style).
    const hostile = "'; DROP TABLE event_content; --\\E'\\x27";
    await service.listEventInstancesWithFilters(testCalendar, { search: hostile });

    const queryOptions = findAllStub.lastCall.args[0];
    const eventInclude = queryOptions.include[0];
    const contentInclude = eventInclude.include.find(
      (inc: any) => inc.model === EventContentEntity,
    );

    expect(contentInclude).toBeDefined();
    expect(contentInclude.required).toBe(true);

    // The where clause must be a plain object keyed by Op.or (parameterized),
    // never a Sequelize.literal — literal() with user input is the documented
    // injection vector the fix removed.
    expect(contentInclude.where).toBeInstanceOf(Object);
    expect(contentInclude.where).not.toBeInstanceOf(Utils.Literal);
    expect(contentInclude.where[Op.or]).toBeDefined();
    expect(Array.isArray(contentInclude.where[Op.or])).toBe(true);
    expect(contentInclude.where[Op.or]).toHaveLength(2);

    // The hostile input flows through unchanged into the bound LIKE pattern
    // (Sequelize parameterizes it; query semantics are unaffected). Each
    // branch is a Where instance, never a Literal.
    for (const branch of contentInclude.where[Op.or]) {
      expect(branch).toBeInstanceOf(Utils.Where);
      expect(branch).not.toBeInstanceOf(Utils.Literal);
    }
    const patterns = extractLikePatterns(contentInclude.where);
    expect(patterns).toHaveLength(2);
    // Lowercased and sandwiched between % wildcards. Single quotes and other
    // SQL metacharacters survive verbatim because they are bound, not
    // interpolated — they cannot break out of the LIKE pattern.
    expect(patterns[0]).toBe(`%${hostile.toLowerCase()}%`);
    expect(patterns[1]).toBe(`%${hostile.toLowerCase()}%`);
  });

  it('caps the search term at 200 characters at the service boundary', async () => {
    const findAllStub = sandbox.stub(EventInstanceEntity, 'findAll').resolves([]);

    // 250-char payload: simulate a public attacker forcing an unbounded LIKE
    // pattern. The cap protects against pathological input regardless of
    // whether a handler-side cap is in place.
    const longSearch = 'a'.repeat(250);
    await service.listEventInstancesWithFilters(testCalendar, { search: longSearch });

    const queryOptions = findAllStub.lastCall.args[0];
    const eventInclude = queryOptions.include[0];
    const contentInclude = eventInclude.include.find(
      (inc: any) => inc.model === EventContentEntity,
    );

    const patterns = extractLikePatterns(contentInclude.where);
    expect(patterns).toHaveLength(2);
    // Pattern is `%${searchTerm}%` — 200 capped chars + 2 wildcard chars.
    for (const pattern of patterns) {
      expect(pattern).toHaveLength(202);
      expect(pattern.startsWith('%')).toBe(true);
      expect(pattern.endsWith('%')).toBe(true);
      expect(pattern.slice(1, -1)).toBe('a'.repeat(200));
    }
  });
});
