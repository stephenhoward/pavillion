import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';

describe('CalendarEvent.sourceCalendar', () => {

  it('should default to null', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    expect(event.sourceCalendar).toBeNull();
  });

  it('should be included in toObject() output', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.sourceCalendar = { urlName: 'community', host: 'other.example.com', url: 'https://other.example.com/view/community' };

    const obj = event.toObject();
    expect(obj.sourceCalendar).toEqual({
      urlName: 'community',
      host: 'other.example.com',
      url: 'https://other.example.com/view/community',
    });
  });

  it('should serialize null sourceCalendar in toObject()', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    const obj = event.toObject();
    expect(obj.sourceCalendar).toBeNull();
  });

  it('should deserialize sourceCalendar from fromObject()', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
      sourceCalendar: { urlName: 'community', host: 'other.example.com', url: 'https://other.example.com/view/community' },
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.sourceCalendar).toEqual({
      urlName: 'community',
      host: 'other.example.com',
      url: 'https://other.example.com/view/community',
    });
  });

  it('should default sourceCalendar to null when absent in fromObject()', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.sourceCalendar).toBeNull();
  });

  it('should round-trip sourceCalendar through toObject/fromObject', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.sourceCalendar = { urlName: 'arts', host: 'arts.example.org', url: 'https://arts.example.org/view/arts' };

    const restored = CalendarEvent.fromObject(event.toObject());
    expect(restored.sourceCalendar).toEqual(event.sourceCalendar);
  });
});

describe('CalendarEvent.repostStatus', () => {

  it('should default repostStatus to "none"', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    expect(event.repostStatus).toBe('none');
  });

  it('should include repostStatus in toObject() output', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'auto';

    const obj = event.toObject();
    expect(obj.repostStatus).toBe('auto');
  });

  it('should not include the removed legacy isRepost field in toObject()', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'manual';

    const obj = event.toObject();
    expect('isRepost' in obj).toBe(false);
  });

  it('should deserialize repostStatus from fromObject()', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
      repostStatus: 'auto',
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.repostStatus).toBe('auto');
  });

  it('should ignore the removed legacy isRepost boolean in fromObject()', () => {
    // The legacy isRepost -> 'manual' fallback is gone: a payload carrying
    // only the boolean deserializes as 'none'. Every producer now emits
    // repostStatus.
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
      isRepost: true,
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.repostStatus).toBe('none');
  });

  it('should default repostStatus to "none" when absent in fromObject()', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.repostStatus).toBe('none');
  });

  it('should round-trip repostStatus through toObject/fromObject', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'auto';

    const restored = CalendarEvent.fromObject(event.toObject());
    expect(restored.repostStatus).toBe('auto');
  });
});

describe('CalendarEvent.mediaFocalPoint', () => {

  it('should default mediaFocalPointX to 0.5', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    expect(event.mediaFocalPointX).toBe(0.5);
  });

  it('should default mediaFocalPointY to 0.5', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    expect(event.mediaFocalPointY).toBe(0.5);
  });

  it('should default mediaZoom to 1.0', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    expect(event.mediaZoom).toBe(1.0);
  });

  it('should include focal point fields in toObject()', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.mediaFocalPointX = 0.3;
    event.mediaFocalPointY = 0.7;
    event.mediaZoom = 1.5;

    const obj = event.toObject();
    expect(obj.mediaFocalPointX).toBe(0.3);
    expect(obj.mediaFocalPointY).toBe(0.7);
    expect(obj.mediaZoom).toBe(1.5);
  });

  it('should include default focal point fields in toObject()', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    const obj = event.toObject();

    expect(obj.mediaFocalPointX).toBe(0.5);
    expect(obj.mediaFocalPointY).toBe(0.5);
    expect(obj.mediaZoom).toBe(1.0);
  });

  it('should deserialize focal point fields from fromObject()', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
      mediaFocalPointX: 0.2,
      mediaFocalPointY: 0.8,
      mediaZoom: 2.0,
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.mediaFocalPointX).toBe(0.2);
    expect(event.mediaFocalPointY).toBe(0.8);
    expect(event.mediaZoom).toBe(2.0);
  });

  it('should use default focal point values when absent in fromObject() (backward compat)', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.mediaFocalPointX).toBe(0.5);
    expect(event.mediaFocalPointY).toBe(0.5);
    expect(event.mediaZoom).toBe(1.0);
  });

  it('should round-trip focal point fields through toObject/fromObject', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.mediaFocalPointX = 0.1;
    event.mediaFocalPointY = 0.9;
    event.mediaZoom = 1.5;

    const restored = CalendarEvent.fromObject(event.toObject());
    expect(restored.mediaFocalPointX).toBe(0.1);
    expect(restored.mediaFocalPointY).toBe(0.9);
    expect(restored.mediaZoom).toBe(1.5);
  });
});

describe('CalendarEvent.baseSchedule', () => {
  const LA = 'America/Los_Angeles';

  function schedule(id: string, iso: string, zone: string, isExclusion = false): CalendarEventSchedule {
    const s = new CalendarEventSchedule(id, DateTime.fromISO(iso, { zone }));
    s.isExclusion = isExclusion;
    return s;
  }

  function eventWith(schedules: CalendarEventSchedule[]): CalendarEvent {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.schedules = schedules;
    return event;
  }

  it('returns the earliest-starting schedule whichever loads first', () => {
    const losAngeles = schedule('sched-la', '2026-10-27T10:15:00', LA);
    const berlin = schedule('sched-berlin', '2026-11-05T19:00:00', 'Europe/Berlin');

    for (const schedules of [[losAngeles, berlin], [berlin, losAngeles]]) {
      expect(eventWith(schedules).baseSchedule()).toBe(losAngeles);
    }
  });

  it('never returns an exclusion row, even when it loads first and starts earliest', () => {
    const cancellation = schedule('sched-x', '2026-10-01T00:00:00Z', 'utc', true);
    const base = schedule('sched-la', '2026-10-27T10:15:00', LA);

    expect(eventWith([cancellation, base]).baseSchedule()).toBe(base);
  });

  it('breaks a tie on start by the lower id in either load order', () => {
    // Same instant, written in two zones.
    const lower = schedule('00000000-0000-4000-8000-000000000001', '2026-10-27T10:15:00', LA);
    const higher = schedule('00000000-0000-4000-8000-000000000002', '2026-10-27T18:15:00', 'Europe/Berlin');

    for (const schedules of [[lower, higher], [higher, lower]]) {
      expect(eventWith(schedules).baseSchedule()).toBe(lower);
    }
  });

  it('skips a schedule with no start date', () => {
    const undated = new CalendarEventSchedule('sched-0');
    const dated = schedule('sched-la', '2026-10-27T10:15:00', LA);

    expect(eventWith([undated, dated]).baseSchedule()).toBe(dated);
  });

  it('is null when the event has no schedules', () => {
    expect(eventWith([]).baseSchedule()).toBeNull();
  });

  it('is null when every schedule is an exclusion', () => {
    const cancellation = schedule('sched-x', '2026-11-10T18:15:00Z', 'utc', true);

    expect(eventWith([cancellation]).baseSchedule()).toBeNull();
  });
});
