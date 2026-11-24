import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { CalendarEvent, CalendarEventSchedule, EventFrequency, compareEventsByStart } from '@/common/model/events';

function makeEvent(id: string, starts: string[] = [], frequency?: EventFrequency): CalendarEvent {
  const event = new CalendarEvent(id, 'cal-1');
  event.schedules = starts.map((start, i) => {
    const schedule = new CalendarEventSchedule(`${id}-s${i}`, DateTime.fromISO(start, { zone: 'utc' }));
    if (frequency) {
      schedule.frequency = frequency;
    }
    return schedule;
  });
  return event;
}

describe('compareEventsByStart', () => {
  it('orders out-of-order events by base schedule start, earliest first', () => {
    const events = [
      makeEvent('c', ['2026-12-15T10:00:00Z']),
      makeEvent('a', ['2026-09-22T10:00:00Z']),
      makeEvent('b', ['2026-12-11T10:00:00Z']),
    ];
    expect(events.sort(compareEventsByStart).map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks equal starts by id', () => {
    const events = [
      makeEvent('b', ['2026-12-11T10:00:00Z']),
      makeEvent('a', ['2026-12-11T10:00:00Z']),
    ];
    expect(events.sort(compareEventsByStart).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('sorts events with no base schedule last, by id among themselves', () => {
    const events = [
      makeEvent('z'),
      makeEvent('y', ['2026-12-11T10:00:00Z']),
      makeEvent('x'),
    ];
    expect(events.sort(compareEventsByStart).map(e => e.id)).toEqual(['y', 'x', 'z']);
  });

  it('keys a recurring event by its base schedule, not a later schedule', () => {
    const recurring = makeEvent('r', ['2026-12-20T10:00:00Z', '2026-01-05T10:00:00Z'], EventFrequency.WEEKLY);
    const single = makeEvent('s', ['2026-06-01T10:00:00Z']);
    expect([single, recurring].sort(compareEventsByStart).map(e => e.id)).toEqual(['r', 's']);
  });
});
