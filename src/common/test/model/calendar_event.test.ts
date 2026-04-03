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
