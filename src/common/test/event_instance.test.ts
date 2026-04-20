import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

import CalendarEventInstance from '@/common/model/event_instance';
import { CalendarEvent } from '@/common/model/events';

describe('CalendarEventInstance', () => {
  const makeEvent = (id = 'evt-1', calendarId: string | null = 'cal-1') =>
    new CalendarEvent(id, calendarId);

  it('defaults isCancelled to false on construction', () => {
    const event = makeEvent();
    const instance = new CalendarEventInstance(
      'inst-1',
      event,
      DateTime.fromISO('2025-05-24T08:00:00.000Z'),
      DateTime.fromISO('2025-05-24T10:00:00.000Z'),
    );

    expect(instance.isCancelled).toBe(false);
  });

  it('includes isCancelled in toObject output', () => {
    const event = makeEvent();
    const instance = new CalendarEventInstance(
      'inst-1',
      event,
      DateTime.fromISO('2025-05-24T08:00:00.000Z'),
      null,
    );
    instance.isCancelled = true;

    const obj = instance.toObject();

    expect(obj.isCancelled).toBe(true);
    expect(obj.id).toBe('inst-1');
    expect(obj.calendarId).toBe('cal-1');
  });

  it('defaults isCancelled to false when omitted from toObject source', () => {
    const event = makeEvent();
    const instance = new CalendarEventInstance(
      'inst-1',
      event,
      DateTime.fromISO('2025-05-24T08:00:00.000Z'),
      null,
    );
    const obj = instance.toObject();
    expect(obj.isCancelled).toBe(false);
  });

  it('reads isCancelled as-is from fromObject (does not recompute)', () => {
    const event = makeEvent();
    const sourceObj = {
      id: 'inst-1',
      event: event.toObject(),
      calendarId: 'cal-1',
      start: '2025-05-24T08:00:00.000Z',
      end: '2025-05-24T10:00:00.000Z',
      isCancelled: true,
    };

    const instance = CalendarEventInstance.fromObject(sourceObj);

    expect(instance.isCancelled).toBe(true);
  });

  it('defaults isCancelled to false when absent from fromObject payload (back-compat)', () => {
    const event = makeEvent();
    const sourceObj = {
      id: 'inst-1',
      event: event.toObject(),
      calendarId: 'cal-1',
      start: '2025-05-24T08:00:00.000Z',
      end: '2025-05-24T10:00:00.000Z',
      // isCancelled intentionally omitted
    };

    const instance = CalendarEventInstance.fromObject(sourceObj);

    expect(instance.isCancelled).toBe(false);
  });

  it('treats non-true values for isCancelled as false', () => {
    const event = makeEvent();
    const sourceObj = {
      id: 'inst-1',
      event: event.toObject(),
      calendarId: 'cal-1',
      start: '2025-05-24T08:00:00.000Z',
      end: null,
      isCancelled: 'yes', // non-boolean
    };

    const instance = CalendarEventInstance.fromObject(sourceObj);

    expect(instance.isCancelled).toBe(false);
  });

  it('round-trips isCancelled=true through toObject -> fromObject', () => {
    const event = makeEvent();
    const original = new CalendarEventInstance(
      'inst-1',
      event,
      DateTime.fromISO('2025-05-24T08:00:00.000Z'),
      DateTime.fromISO('2025-05-24T10:00:00.000Z'),
    );
    original.isCancelled = true;

    const restored = CalendarEventInstance.fromObject(original.toObject());

    expect(restored.id).toBe('inst-1');
    expect(restored.calendarId).toBe('cal-1');
    expect(restored.isCancelled).toBe(true);
    expect(restored.start.toISO()).toBe(original.start.toISO());
    expect(restored.end?.toISO()).toBe(original.end?.toISO());
  });

  it('round-trips isCancelled=false through toObject -> fromObject', () => {
    const event = makeEvent();
    const original = new CalendarEventInstance(
      'inst-1',
      event,
      DateTime.fromISO('2025-05-24T08:00:00.000Z'),
      null,
    );
    original.isCancelled = false;

    const restored = CalendarEventInstance.fromObject(original.toObject());

    expect(restored.isCancelled).toBe(false);
    expect(restored.end).toBeNull();
  });
});
