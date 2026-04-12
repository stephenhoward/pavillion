import { describe, it, expect } from 'vitest';
import { CalendarEvent } from '@/common/model/events';

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

  it('isRepost getter should return false when repostStatus is "none"', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'none';
    expect(event.isRepost).toBe(false);
  });

  it('isRepost getter should return true when repostStatus is "manual"', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'manual';
    expect(event.isRepost).toBe(true);
  });

  it('isRepost getter should return true when repostStatus is "auto"', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'auto';
    expect(event.isRepost).toBe(true);
  });

  it('should include repostStatus in toObject() output', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'auto';

    const obj = event.toObject();
    expect(obj.repostStatus).toBe('auto');
  });

  it('should keep isRepost in toObject() for backward compatibility', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'manual';

    const obj = event.toObject();
    expect(obj.isRepost).toBe(true);
  });

  it('should deserialize repostStatus from fromObject()', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
      repostStatus: 'auto',
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.repostStatus).toBe('auto');
    expect(event.isRepost).toBe(true);
  });

  it('should fall back to legacy isRepost=true as "manual" in fromObject()', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
      isRepost: true,
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.repostStatus).toBe('manual');
    expect(event.isRepost).toBe(true);
  });

  it('should default repostStatus to "none" when neither field is present in fromObject()', () => {
    const obj = {
      id: 'evt-1',
      calendarId: 'cal-1',
    };

    const event = CalendarEvent.fromObject(obj);
    expect(event.repostStatus).toBe('none');
    expect(event.isRepost).toBe(false);
  });

  it('should round-trip repostStatus through toObject/fromObject', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.repostStatus = 'auto';

    const restored = CalendarEvent.fromObject(event.toObject());
    expect(restored.repostStatus).toBe('auto');
    expect(restored.isRepost).toBe(true);
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
