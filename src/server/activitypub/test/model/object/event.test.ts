import { describe, it, expect } from 'vitest';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { EventObject } from '@/server/activitypub/model/object/event';

describe('EventObject', () => {

  describe('categories serialization', () => {

    it('should emit an empty categories array when event has no categories', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');

      const obj = new EventObject(calendar, event);

      expect(obj.categories).toEqual([]);
    });

    it('should populate categories with well-formed URIs when event has categories', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');

      const cat1 = new EventCategory('cat-uuid-1', 'calendar-uuid');
      const cat2 = new EventCategory('cat-uuid-2', 'calendar-uuid');
      event.categories = [cat1, cat2];

      const obj = new EventObject(calendar, event);

      expect(obj.categories).toEqual([
        'https://pavillion.dev/api/public/v1/calendar/mycal/categories/cat-uuid-1',
        'https://pavillion.dev/api/public/v1/calendar/mycal/categories/cat-uuid-2',
      ]);
    });

    it('should use the calendar urlName and category id in the URI', () => {
      const calendar = new Calendar('cal-id', 'testcalendar');
      const event = new CalendarEvent('event-id', 'cal-id');

      const cat = new EventCategory('specific-cat-id', 'cal-id');
      event.categories = [cat];

      const obj = new EventObject(calendar, event);

      expect(obj.categories).toHaveLength(1);
      expect(obj.categories[0]).toContain('/calendar/testcalendar/');
      expect(obj.categories[0]).toContain('/specific-cat-id');
    });

    it('should use the configured domain in category URIs', () => {
      const calendar = new Calendar('cal-id', 'mycal');
      const event = new CalendarEvent('event-id', 'cal-id');

      const cat = new EventCategory('cat-id', 'cal-id');
      event.categories = [cat];

      const obj = new EventObject(calendar, event);

      expect(obj.categories[0]).toMatch(/^https:\/\/pavillion\.dev\//);
    });

  });

  describe('series serialization', () => {

    it('should have series as null when event has no series', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');

      const obj = new EventObject(calendar, event);

      expect(obj.series).toBeNull();
    });

    it('should set series to the AP series Object ID URL when event has a series', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      const series = new EventSeries('series-uuid-1234', 'calendar-uuid', 'myseries');
      const content = new EventSeriesContent('en', 'My Series', 'A description');
      series.addContent(content);
      event.series = series;

      const obj = new EventObject(calendar, event);

      expect(obj.series).toBe('https://pavillion.dev/calendars/mycal/series/series-uuid-1234');
    });

    it('should use the calendar urlName and series UUID in the series URL', () => {
      const calendar = new Calendar('cal-id', 'testcalendar');
      const event = new CalendarEvent('event-id', 'cal-id');
      const series = new EventSeries('specific-series-uuid', 'cal-id', 'myseries');
      series.addContent(new EventSeriesContent('en', 'Series', ''));
      event.series = series;

      const obj = new EventObject(calendar, event);

      expect(obj.series).toContain('/calendars/testcalendar/series/');
      expect(obj.series).toContain('specific-series-uuid');
    });

    it('should use the configured domain in the series URL', () => {
      const calendar = new Calendar('cal-id', 'mycal');
      const event = new CalendarEvent('event-id', 'cal-id');
      const series = new EventSeries('series-id', 'cal-id', 'myseries');
      series.addContent(new EventSeriesContent('en', 'Series', ''));
      event.series = series;

      const obj = new EventObject(calendar, event);

      expect(obj.series).toMatch(/^https:\/\/pavillion\.dev\//);
    });

  });

});
