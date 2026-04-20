import { describe, it, expect, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { createPinia, setActivePinia } from 'pinia';
import { useEventStore } from '@/client/stores/eventStore';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';

function makeInstance(
  instanceId: string,
  eventId: string,
  calendarId: string,
  options: { isCancelled?: boolean } = {},
): CalendarEventInstance {
  const event = new CalendarEvent(eventId, calendarId, 'Recurring Event');
  const instance = new CalendarEventInstance(
    instanceId,
    event,
    DateTime.fromISO('2026-06-01T10:00:00'),
    DateTime.fromISO('2026-06-01T11:00:00'),
  );
  instance.isCancelled = options.isCancelled ?? false;
  return instance;
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

  describe('setInstancesForEvent', () => {
    it('should set instances for an event', () => {
      const store = useEventStore();
      const instances = [
        makeInstance('inst-1', 'event-1', 'calendar-123'),
        makeInstance('inst-2', 'event-1', 'calendar-123'),
      ];

      store.setInstancesForEvent('event-1', instances);

      expect(store.instancesForEvent('event-1')).toHaveLength(2);
      expect(store.instancesForEvent('event-1')).toStrictEqual(instances);
    });

    it('should replace existing instances', () => {
      const store = useEventStore();
      const oldInstances = [makeInstance('old-inst', 'event-1', 'calendar-123')];
      store.setInstancesForEvent('event-1', oldInstances);

      const newInstances = [
        makeInstance('inst-1', 'event-1', 'calendar-123'),
        makeInstance('inst-2', 'event-1', 'calendar-123'),
      ];
      store.setInstancesForEvent('event-1', newInstances);

      expect(store.instancesForEvent('event-1')).toStrictEqual(newInstances);
    });
  });

  describe('updateInstance', () => {
    it('should update the cached instance in-place by id', () => {
      const store = useEventStore();
      const original = makeInstance('inst-1', 'event-1', 'calendar-123');
      const other = makeInstance('inst-2', 'event-1', 'calendar-123');
      store.setInstancesForEvent('event-1', [original, other]);

      const updated = makeInstance('inst-1', 'event-1', 'calendar-123', { isCancelled: true });
      store.updateInstance('event-1', updated);

      const cached = store.instancesForEvent('event-1');
      expect(cached).toHaveLength(2);
      expect(cached[0]).toStrictEqual(updated);
      expect(cached[0].isCancelled).toBe(true);
      expect(cached[1]).toStrictEqual(other);
    });

    it('should do nothing when the event has no cached instances', () => {
      const store = useEventStore();
      const updated = makeInstance('inst-1', 'event-1', 'calendar-123', { isCancelled: true });

      store.updateInstance('event-1', updated);

      expect(store.instancesForEvent('event-1')).toEqual([]);
    });

    it('should do nothing when the instance id is not present', () => {
      const store = useEventStore();
      const existing = makeInstance('inst-1', 'event-1', 'calendar-123');
      store.setInstancesForEvent('event-1', [existing]);

      const stranger = makeInstance('inst-999', 'event-1', 'calendar-123', { isCancelled: true });
      store.updateInstance('event-1', stranger);

      const cached = store.instancesForEvent('event-1');
      expect(cached).toHaveLength(1);
      expect(cached[0]).toStrictEqual(existing);
    });
  });

  describe('removeInstance', () => {
    it('should remove an instance by id', () => {
      const store = useEventStore();
      const keep = makeInstance('inst-1', 'event-1', 'calendar-123');
      const drop = makeInstance('inst-2', 'event-1', 'calendar-123');
      store.setInstancesForEvent('event-1', [keep, drop]);

      store.removeInstance('event-1', 'inst-2');

      const cached = store.instancesForEvent('event-1');
      expect(cached).toHaveLength(1);
      expect(cached[0]).toStrictEqual(keep);
    });

    it('should handle removing from an event with no cached instances', () => {
      const store = useEventStore();
      // Should not throw
      store.removeInstance('event-unknown', 'inst-x');

      expect(store.instancesForEvent('event-unknown')).toEqual([]);
    });
  });

  describe('instancesForEvent', () => {
    it('should return an empty array for an unknown event', () => {
      const store = useEventStore();

      expect(store.instancesForEvent('unknown-event')).toEqual([]);
    });
  });
});
