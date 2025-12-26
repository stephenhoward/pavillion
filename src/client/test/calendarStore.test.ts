import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';

describe('CalendarStore - Last Interacted Calendar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('lastInteractedCalendarId state', () => {
    it('should initialize lastInteractedCalendarId as null', () => {
      const store = useCalendarStore();

      expect(store.lastInteractedCalendarId).toBeNull();
    });
  });

  describe('setLastInteractedCalendar action', () => {
    it('should set lastInteractedCalendarId when called with calendar ID', () => {
      const store = useCalendarStore();
      const calendarId = 'calendar-123';

      store.setLastInteractedCalendar(calendarId);

      expect(store.lastInteractedCalendarId).toBe(calendarId);
    });

    it('should update lastInteractedCalendarId when called multiple times', () => {
      const store = useCalendarStore();
      const firstCalendarId = 'calendar-123';
      const secondCalendarId = 'calendar-456';

      store.setLastInteractedCalendar(firstCalendarId);
      expect(store.lastInteractedCalendarId).toBe(firstCalendarId);

      store.setLastInteractedCalendar(secondCalendarId);
      expect(store.lastInteractedCalendarId).toBe(secondCalendarId);
    });
  });

  describe('getLastInteractedCalendar getter', () => {
    it('should return null when no calendar has been interacted with', () => {
      const store = useCalendarStore();

      const result = store.getLastInteractedCalendar;

      expect(result).toBeNull();
    });

    it('should return the calendar object when lastInteractedCalendarId is set', () => {
      const store = useCalendarStore();
      const calendar = new Calendar('calendar-123', 'test-calendar');
      calendar.addContent({
        language: 'en',
        name: 'Test Calendar',
        description: 'Test Description',
      });

      store.addCalendar(calendar);
      store.setLastInteractedCalendar('calendar-123');

      const result = store.getLastInteractedCalendar;

      expect(result).not.toBeNull();
      expect(result?.id).toBe('calendar-123');
      expect(result?.urlName).toBe('test-calendar');
    });

    it('should return null when lastInteractedCalendarId is set but calendar not in store', () => {
      const store = useCalendarStore();

      store.setLastInteractedCalendar('non-existent-calendar');

      const result = store.getLastInteractedCalendar;

      expect(result).toBeNull();
    });

    it('should return updated calendar after interaction changes', () => {
      const store = useCalendarStore();
      const calendar1 = new Calendar('calendar-123', 'calendar-one');
      const calendar2 = new Calendar('calendar-456', 'calendar-two');

      store.addCalendar(calendar1);
      store.addCalendar(calendar2);

      store.setLastInteractedCalendar('calendar-123');
      expect(store.getLastInteractedCalendar?.id).toBe('calendar-123');

      store.setLastInteractedCalendar('calendar-456');
      expect(store.getLastInteractedCalendar?.id).toBe('calendar-456');
    });
  });

  describe('persistence behavior (store-only)', () => {
    it('should not persist across store instances', () => {
      const store1 = useCalendarStore();
      store1.setLastInteractedCalendar('calendar-123');

      expect(store1.lastInteractedCalendarId).toBe('calendar-123');

      // Create new Pinia instance (simulates page refresh)
      setActivePinia(createPinia());
      const store2 = useCalendarStore();

      expect(store2.lastInteractedCalendarId).toBeNull();
    });
  });
});
