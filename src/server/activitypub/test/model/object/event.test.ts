import { describe, it, expect } from 'vitest';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
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

});
