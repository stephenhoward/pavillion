import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useEventStore } from '@/client/stores/eventStore';
import { DateTime } from 'luxon';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';

function eventStarting(id: string, start: string): CalendarEvent {
  const event = new CalendarEvent(id, 'calendar-123');
  event.schedules = [new CalendarEventSchedule(`${id}-s`, DateTime.fromISO(start, { zone: 'utc' }))];
  return event;
}

describe('EventStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('addEvent', () => {
    it('should add an event to the store', () => {
      const store = useEventStore();
      const event = new CalendarEvent('event-1', 'calendar-123', 'Test Event');

      store.addEvent('calendar-123', event);

      expect(store.events['calendar-123']).toHaveLength(1);
      expect(store.events['calendar-123'][0]).toStrictEqual(event);
    });

    it('should create calendar array if it does not exist', () => {
      const store = useEventStore();
      const event = new CalendarEvent('event-1', 'new-calendar', 'Test Event');

      store.addEvent('new-calendar', event);

      expect(store.events['new-calendar']).toBeDefined();
      expect(store.events['new-calendar']).toHaveLength(1);
    });
  });

  describe('updateEvent', () => {
    it('should update an existing event', () => {
      const store = useEventStore();
      const originalEvent = new CalendarEvent('event-1', 'calendar-123', 'Original Title');

      store.addEvent('calendar-123', originalEvent);

      const updatedEvent = new CalendarEvent('event-1', 'calendar-123', 'Updated Title');

      store.updateEvent('calendar-123', updatedEvent);

      expect(store.events['calendar-123']).toHaveLength(1);
      expect(store.events['calendar-123'][0]).toStrictEqual(updatedEvent);
    });

    it('should add event if it does not exist', () => {
      const store = useEventStore();
      const event = new CalendarEvent('event-1', 'calendar-123', 'New Event');

      store.updateEvent('calendar-123', event);

      expect(store.events['calendar-123']).toHaveLength(1);
      expect(store.events['calendar-123'][0]).toStrictEqual(event);
    });
  });

  describe('setEventsForCalendar', () => {
    it('should set events for a calendar', () => {
      const store = useEventStore();
      const event1 = new CalendarEvent('event-1', 'calendar-123', 'Event 1');
      const event2 = new CalendarEvent('event-2', 'calendar-123', 'Event 2');
      const events = [event1, event2];

      store.setEventsForCalendar('calendar-123', events);

      expect(store.events['calendar-123']).toHaveLength(2);
      expect(store.events['calendar-123']).toStrictEqual(events);
    });

    it('should replace existing events', () => {
      const store = useEventStore();
      const oldEvent = new CalendarEvent('old-event', 'calendar-123', 'Old Event');
      store.addEvent('calendar-123', oldEvent);

      const newEvents = [
        new CalendarEvent('event-1', 'calendar-123', 'Event 1'),
        new CalendarEvent('event-2', 'calendar-123', 'Event 2'),
      ];

      store.setEventsForCalendar('calendar-123', newEvents);

      expect(store.events['calendar-123']).toHaveLength(2);
      expect(store.events['calendar-123']).toStrictEqual(newEvents);
      expect(store.events['calendar-123']).not.toContain(oldEvent);
    });
  });

  describe('removeEvent', () => {
    it('should remove an event by event object', () => {
      const store = useEventStore();
      const event1 = new CalendarEvent('event-1', 'calendar-123', 'Event 1');
      const event2 = new CalendarEvent('event-2', 'calendar-123', 'Event 2');

      store.addEvent('calendar-123', event1);
      store.addEvent('calendar-123', event2);

      expect(store.events['calendar-123']).toHaveLength(2);

      store.removeEvent('calendar-123', event1);

      expect(store.events['calendar-123']).toHaveLength(1);
      expect(store.events['calendar-123'][0]).toStrictEqual(event2);
    });

    it('should handle removing from non-existent calendar', () => {
      const store = useEventStore();
      const event = new CalendarEvent('event-1', 'calendar-123', 'Event 1');

      // Should not throw error
      store.removeEvent('non-existent-calendar', event);

      expect(store.events['non-existent-calendar']).toBeUndefined();
    });

    it('should handle removing non-existent event', () => {
      const store = useEventStore();
      const event1 = new CalendarEvent('event-1', 'calendar-123', 'Event 1');
      const event2 = new CalendarEvent('event-2', 'calendar-123', 'Event 2');
      store.addEvent('calendar-123', event1);

      store.removeEvent('calendar-123', event2);

      expect(store.events['calendar-123']).toHaveLength(1);
      expect(store.events['calendar-123'][0]).toStrictEqual(event1);
    });
  });

  describe('eventsForCalendar', () => {
    it('should return events for a calendar', () => {
      const store = useEventStore();
      const event1 = new CalendarEvent('event-1', 'calendar-123', 'Event 1');
      const event2 = new CalendarEvent('event-2', 'calendar-123', 'Event 2');

      store.addEvent('calendar-123', event1);
      store.addEvent('calendar-123', event2);

      const events = store.eventsForCalendar('calendar-123');

      expect(events).toHaveLength(2);
      expect(events).toStrictEqual([event1, event2]);
    });

    it('should return empty array for non-existent calendar', () => {
      const store = useEventStore();

      const events = store.eventsForCalendar('non-existent-calendar');

      expect(events).toEqual([]);
    });
  });

  describe('eventsForCalendar ordering', () => {
    it('places an added earlier-dated event before later ones', () => {
      const store = useEventStore();
      store.addEvent('calendar-123', eventStarting('dec-11', '2026-12-11T10:00:00Z'));
      store.addEvent('calendar-123', eventStarting('dec-15', '2026-12-15T10:00:00Z'));
      store.addEvent('calendar-123', eventStarting('dec-12', '2026-12-12T10:00:00Z'));

      expect(store.eventsForCalendar('calendar-123').map(e => e.id)).toEqual(['dec-11', 'dec-12', 'dec-15']);
    });

    it('re-sorts an event whose date changed on update', () => {
      const store = useEventStore();
      store.addEvent('calendar-123', eventStarting('a', '2026-12-11T10:00:00Z'));
      store.addEvent('calendar-123', eventStarting('b', '2026-12-15T10:00:00Z'));

      store.updateEvent('calendar-123', eventStarting('b', '2026-12-01T10:00:00Z'));

      expect(store.eventsForCalendar('calendar-123').map(e => e.id)).toEqual(['b', 'a']);
    });

    it('does not reorder the stored array', () => {
      const store = useEventStore();
      store.addEvent('calendar-123', eventStarting('late', '2026-12-15T10:00:00Z'));
      store.addEvent('calendar-123', eventStarting('early', '2026-12-01T10:00:00Z'));

      store.eventsForCalendar('calendar-123');

      expect(store.events['calendar-123'].map(e => e.id)).toEqual(['late', 'early']);
    });
  });
});
