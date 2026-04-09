import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { DateTime, Duration } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import sinon from 'sinon';
import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import EventInstanceService from '@/server/calendar/service/event_instance';
import EventService from '@/server/calendar/service/events';
import { EventScheduleEntity } from '@/server/calendar/entity/event';

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
    byDay?: string[];
  }): CalendarEventSchedule {
    const schedule = new CalendarEventSchedule(uuidv4(), opts.startDate, opts.endDate ?? undefined);
    schedule.eventEndTime = opts.eventEndTime ?? null;
    schedule.frequency = opts.frequency ?? null;
    schedule.interval = opts.interval ?? 0;
    schedule.count = opts.count ?? 0;
    schedule.isExclusion = opts.isExclusion ?? false;
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
