import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { CalendarEventSchedule } from '@/common/model/events';

describe('CalendarEventSchedule.eventEndTime', () => {

  it('should default to null on new instance', () => {
    const schedule = new CalendarEventSchedule();
    expect(schedule.eventEndTime).toBeNull();
  });

  it('should serialize eventEndTime as ISO string in toObject()', () => {
    const schedule = new CalendarEventSchedule('s1');
    const endTime = DateTime.fromISO('2026-04-03T17:00:00.000Z');
    schedule.eventEndTime = endTime;

    const obj = schedule.toObject();
    expect(obj.eventEndTime).toBe(endTime.toISO());
  });

  it('should serialize null eventEndTime as null in toObject()', () => {
    const schedule = new CalendarEventSchedule('s1');
    schedule.eventEndTime = null;

    const obj = schedule.toObject();
    expect(obj.eventEndTime).toBeNull();
  });

  it('should deserialize eventEndTime from ISO string in fromObject()', () => {
    const iso = '2026-04-03T17:00:00.000Z';
    const obj = {
      id: 's1',
      start: '2026-04-03T10:00:00.000Z',
      eventEndTime: iso,
      interval: 0,
      count: 0,
      byDay: [],
      isException: false,
    };

    const schedule = CalendarEventSchedule.fromObject(obj);
    expect(schedule.eventEndTime).toBeDefined();
    expect(schedule.eventEndTime!.toISO()).toBe(DateTime.fromISO(iso).toISO());
  });

  it('should leave eventEndTime null when key is absent in fromObject()', () => {
    const obj = {
      id: 's1',
      start: '2026-04-03T10:00:00.000Z',
      interval: 0,
      count: 0,
      byDay: [],
      isException: false,
    };

    const schedule = CalendarEventSchedule.fromObject(obj);
    expect(schedule.eventEndTime).toBeNull();
  });

  it('should round-trip eventEndTime through toObject and fromObject', () => {
    const schedule = new CalendarEventSchedule('s1');
    schedule.startDate = DateTime.fromISO('2026-04-03T10:00:00.000Z');
    schedule.eventEndTime = DateTime.fromISO('2026-04-03T17:30:00.000Z');
    schedule.interval = 1;
    schedule.count = 0;
    schedule.byDay = [];
    schedule.isExclusion = false;

    const obj = schedule.toObject();
    const restored = CalendarEventSchedule.fromObject(obj);

    expect(restored.eventEndTime).toBeDefined();
    expect(restored.eventEndTime!.toISO()).toBe(schedule.eventEndTime.toISO());
  });
});
