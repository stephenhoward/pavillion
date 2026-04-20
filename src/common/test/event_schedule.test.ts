import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

import { CalendarEventSchedule } from '@/common/model/events';

describe('CalendarEventSchedule.hideFromPublic', () => {
  it('defaults hideFromPublic to true on new instances', () => {
    const schedule = new CalendarEventSchedule();
    expect(schedule.hideFromPublic).toBe(true);
  });

  it('defaults hideFromPublic to true when constructed with dates', () => {
    const start = DateTime.fromISO('2025-05-24T08:00:00.000', { zone: 'UTC' });
    const end = DateTime.fromISO('2025-05-24T10:00:00.000', { zone: 'UTC' });
    const schedule = new CalendarEventSchedule('sched-1', start, end);
    expect(schedule.hideFromPublic).toBe(true);
  });

  it('includes hideFromPublic in toObject output', () => {
    const schedule = new CalendarEventSchedule('sched-1');
    schedule.isExclusion = true;
    schedule.hideFromPublic = false;

    const obj = schedule.toObject();

    expect(obj.hideFromPublic).toBe(false);
    expect(obj.isException).toBe(true);
  });

  it('defaults hideFromPublic to true when toObject-ed directly after construction', () => {
    const schedule = new CalendarEventSchedule('sched-1');
    const obj = schedule.toObject();
    expect(obj.hideFromPublic).toBe(true);
  });

  it('reads hideFromPublic from fromObject payload', () => {
    const obj = {
      id: 'sched-1',
      start: null,
      end: null,
      frequency: null,
      interval: 0,
      count: 0,
      byDay: [],
      isException: true,
      hideFromPublic: false,
    };

    const schedule = CalendarEventSchedule.fromObject(obj);

    expect(schedule.isExclusion).toBe(true);
    expect(schedule.hideFromPublic).toBe(false);
  });

  it('defaults hideFromPublic to true when absent from fromObject payload (back-compat)', () => {
    const obj = {
      id: 'sched-1',
      start: null,
      end: null,
      frequency: null,
      interval: 0,
      count: 0,
      byDay: [],
      isException: false,
      // hideFromPublic intentionally omitted
    };

    const schedule = CalendarEventSchedule.fromObject(obj);

    expect(schedule.hideFromPublic).toBe(true);
  });

  it('round-trips hideFromPublic=false through toObject -> fromObject', () => {
    const original = new CalendarEventSchedule('sched-1');
    original.isExclusion = true;
    original.hideFromPublic = false;

    const restored = CalendarEventSchedule.fromObject(original.toObject());

    expect(restored.isExclusion).toBe(true);
    expect(restored.hideFromPublic).toBe(false);
  });

  it('round-trips hideFromPublic=true through toObject -> fromObject', () => {
    const original = new CalendarEventSchedule('sched-1');
    original.isExclusion = true;
    original.hideFromPublic = true;

    const restored = CalendarEventSchedule.fromObject(original.toObject());

    expect(restored.isExclusion).toBe(true);
    expect(restored.hideFromPublic).toBe(true);
  });
});
