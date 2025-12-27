import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';

describe('CalendarStore - Selected Calendar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('selectedCalendarId state', () => {
    it('should initialize selectedCalendarId as null', () => {
      const store = useCalendarStore();

      expect(store.selectedCalendarId).toBeNull();
    });
  });

  describe('setSelectedCalendar action', () => {
    it('should set selectedCalendarId when called with calendar ID', () => {
      const store = useCalendarStore();
      const calendarId = 'calendar-123';

      store.setSelectedCalendar(calendarId);

      expect(store.selectedCalendarId).toBe(calendarId);
    });

    it('should update selectedCalendarId when called multiple times', () => {
      const store = useCalendarStore();
      const firstCalendarId = 'calendar-123';
      const secondCalendarId = 'calendar-456';

      store.setSelectedCalendar(firstCalendarId);
      expect(store.selectedCalendarId).toBe(firstCalendarId);

      store.setSelectedCalendar(secondCalendarId);
      expect(store.selectedCalendarId).toBe(secondCalendarId);
    });

    it('should allow clearing selection with null', () => {
      const store = useCalendarStore();

      store.setSelectedCalendar('calendar-123');
      expect(store.selectedCalendarId).toBe('calendar-123');

      store.setSelectedCalendar(null);
      expect(store.selectedCalendarId).toBeNull();
    });
  });

  describe('selectedCalendar getter', () => {
    it('should return null when no calendar is selected', () => {
      const store = useCalendarStore();

      const result = store.selectedCalendar;

      expect(result).toBeNull();
    });

    it('should return the calendar object when selectedCalendarId is set', () => {
      const store = useCalendarStore();
      const calendar = new Calendar('calendar-123', 'test-calendar');
      calendar.addContent({
        language: 'en',
        name: 'Test Calendar',
        description: 'Test Description',
      });

      store.addCalendar(calendar);
      store.setSelectedCalendar('calendar-123');

      const result = store.selectedCalendar;

      expect(result).not.toBeNull();
      expect(result?.id).toBe('calendar-123');
      expect(result?.urlName).toBe('test-calendar');
    });

    it('should return null when selectedCalendarId is set but calendar not in store', () => {
      const store = useCalendarStore();

      store.setSelectedCalendar('non-existent-calendar');

      const result = store.selectedCalendar;

      expect(result).toBeNull();
    });

    it('should return updated calendar after selection changes', () => {
      const store = useCalendarStore();
      const calendar1 = new Calendar('calendar-123', 'calendar-one');
      const calendar2 = new Calendar('calendar-456', 'calendar-two');

      store.addCalendar(calendar1);
      store.addCalendar(calendar2);

      store.setSelectedCalendar('calendar-123');
      expect(store.selectedCalendar?.id).toBe('calendar-123');

      store.setSelectedCalendar('calendar-456');
      expect(store.selectedCalendar?.id).toBe('calendar-456');
    });
  });

  describe('persistence behavior (store-only)', () => {
    it('should not persist across store instances', () => {
      const store1 = useCalendarStore();
      store1.setSelectedCalendar('calendar-123');

      expect(store1.selectedCalendarId).toBe('calendar-123');

      // Create new Pinia instance (simulates page refresh)
      setActivePinia(createPinia());
      const store2 = useCalendarStore();

      expect(store2.selectedCalendarId).toBeNull();
    });
  });
});
