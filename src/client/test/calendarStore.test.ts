import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { CURRENT_CALENDAR_STORAGE_KEY } from '@/client/service/current-calendar';

describe('CalendarStore - Selected Calendar', () => {
  beforeEach(() => {
    localStorage.clear();
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

  describe('persistence behavior', () => {
    it('should persist the selection across store instances', () => {
      const store1 = useCalendarStore();
      store1.setSelectedCalendar('calendar-123');

      expect(store1.selectedCalendarId).toBe('calendar-123');

      // Create new Pinia instance (simulates page refresh)
      setActivePinia(createPinia());
      const store2 = useCalendarStore();

      expect(store2.selectedCalendarId).toBe('calendar-123');
    });
  });
});

describe('CalendarStore - calendar infos and persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  const owned = new CalendarInfo(new Calendar('o1', 'owned-one'), 'owner');
  const edited = new CalendarInfo(new Calendar('e1', 'edited-one'), 'editor');

  it('should partition owned and edited calendars and expose bare calendars', () => {
    const store = useCalendarStore();
    store.setCalendarInfos([edited, owned]);
    expect(store.loaded).toBe(true);
    expect(store.ownedCalendars.map((i) => i.calendar.id)).toEqual(['o1']);
    expect(store.editedCalendars.map((i) => i.calendar.id)).toEqual(['e1']);
    expect(store.calendars.map((c) => c.id)).toEqual(['e1', 'o1']);
  });

  it('should record the account the list was loaded for', () => {
    const store = useCalendarStore();
    expect(store.accountId).toBeNull();
    store.setCalendarInfos([owned], 'account-1');
    expect(store.accountId).toBe('account-1');
  });

  it('should look up by url name and return null for unknown', () => {
    const store = useCalendarStore();
    store.setCalendarInfos([owned]);
    expect(store.getCalendarByUrlName('owned-one')?.id).toBe('o1');
    expect(store.getCalendarInfoByUrlName('owned-one')?.isOwner).toBe(true);
    expect(store.getCalendarByUrlName('nope')).toBeNull();
    expect(store.getCalendarInfoByUrlName('nope')).toBeNull();
  });

  it('should insert as owned on addCalendar and replace in place on updateCalendar', () => {
    const store = useCalendarStore();
    store.setCalendarInfos([edited]);
    store.addCalendar(new Calendar('o2', 'owned-two'));
    expect(store.ownedCalendars.map((i) => i.calendar.id)).toEqual(['o2']);
    const renamed = new Calendar('o2', 'owned-two-renamed');
    store.updateCalendar(renamed);
    expect(store.getCalendarById('o2')?.urlName).toBe('owned-two-renamed');
    expect(store.calendarInfos.length).toBe(2);
  });

  it('should keep the editor relationship on updateCalendar', () => {
    const store = useCalendarStore();
    store.setCalendarInfos([edited]);
    store.updateCalendar(new Calendar('e1', 'edited-one-renamed'));
    expect(store.getCalendarInfoByUrlName('edited-one-renamed')?.isEditor).toBe(true);
    expect(store.ownedCalendars).toEqual([]);
  });

  it('should persist the selected id and clear it', () => {
    const store = useCalendarStore();
    store.setSelectedCalendar('o1');
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBe('o1');
    store.clearSelectedCalendar();
    expect(store.selectedCalendarId).toBeNull();
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBeNull();
  });

  it('should initialise selectedCalendarId from storage', () => {
    localStorage.setItem(CURRENT_CALENDAR_STORAGE_KEY, 'o1');
    const store = useCalendarStore();
    expect(store.selectedCalendarId).toBe('o1');
  });

  it('should ignore a blank stored entry', () => {
    localStorage.setItem(CURRENT_CALENDAR_STORAGE_KEY, '  ');
    const store = useCalendarStore();
    expect(store.selectedCalendarId).toBeNull();
  });
});

describe('CalendarStore - storage unavailable', () => {
  beforeEach(() => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should construct with no selection and select in memory without throwing', () => {
    const store = useCalendarStore();
    expect(store.selectedCalendarId).toBeNull();

    expect(() => store.setSelectedCalendar('x')).not.toThrow();
    expect(store.selectedCalendarId).toBe('x');
  });
});
