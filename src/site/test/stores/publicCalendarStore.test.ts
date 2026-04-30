import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { DateTime } from 'luxon';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventCategory } from '@/common/model/event_category';
import { CalendarEvent } from '@/common/model/events';

// Mock ModelService
vi.mock('@/client/service/models', () => ({
  default: {
    listModels: vi.fn(),
    getModel: vi.fn(),
  },
}));

describe('publicCalendarStore - Search and Date Filter Extensions', () => {
  let store: ReturnType<typeof usePublicCalendarStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = usePublicCalendarStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setSearchQuery action', () => {
    it('updates searchQuery state when called', () => {
      expect(store.searchQuery).toBe('');

      store.setSearchQuery('yoga');

      expect(store.searchQuery).toBe('yoga');
    });

    it('trims whitespace from search query', () => {
      store.setSearchQuery('  yoga class  ');

      expect(store.searchQuery).toBe('yoga class');
    });

    it('handles empty string correctly', () => {
      store.setSearchQuery('yoga');
      expect(store.searchQuery).toBe('yoga');

      store.setSearchQuery('');
      expect(store.searchQuery).toBe('');
    });
  });

  describe('setDateRange action', () => {
    it('updates startDate and endDate when both provided', () => {
      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();

      store.setDateRange('2025-11-15', '2025-11-21');

      expect(store.startDate).toBe('2025-11-15');
      expect(store.endDate).toBe('2025-11-21');
    });

    it('handles null values for clearing date range', () => {
      store.setDateRange('2025-11-15', '2025-11-21');
      expect(store.startDate).toBe('2025-11-15');
      expect(store.endDate).toBe('2025-11-21');

      store.setDateRange(null, null);

      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();
    });

    it('allows setting only startDate', () => {
      store.setDateRange('2025-11-15', null);

      expect(store.startDate).toBe('2025-11-15');
      expect(store.endDate).toBeNull();
    });

    it('allows setting only endDate', () => {
      store.setDateRange(null, '2025-11-21');

      expect(store.startDate).toBeNull();
      expect(store.endDate).toBe('2025-11-21');
    });
  });

  describe('clearAllFilters action', () => {
    it('resets search query to empty string', () => {
      store.setSearchQuery('yoga');
      expect(store.searchQuery).toBe('yoga');

      store.clearAllFilters();

      expect(store.searchQuery).toBe('');
    });

    it('resets date range to null values', () => {
      store.setDateRange('2025-11-15', '2025-11-21');
      expect(store.startDate).toBe('2025-11-15');
      expect(store.endDate).toBe('2025-11-21');

      store.clearAllFilters();

      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();
    });

    it('resets selected categories to empty array', () => {
      store.setSelectedCategories(['Arts', 'Sports']);
      expect(store.selectedCategoryIds).toEqual(['Arts', 'Sports']);

      store.clearAllFilters();

      expect(store.selectedCategoryIds).toEqual([]);
    });

    it('resets all filters simultaneously', () => {
      store.setSearchQuery('yoga');
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSelectedCategories(['Arts']);

      store.clearAllFilters();

      expect(store.searchQuery).toBe('');
      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();
      expect(store.selectedCategoryIds).toEqual([]);
    });
  });

  describe('hasActiveFilters getter', () => {
    it('returns false when no filters are active', () => {
      expect(store.hasActiveFilters).toBe(false);
    });

    it('returns true when search query is set', () => {
      store.setSearchQuery('yoga');

      expect(store.hasActiveFilters).toBe(true);
    });

    it('returns true when categories are selected', () => {
      store.setSelectedCategories(['Arts']);

      expect(store.hasActiveFilters).toBe(true);
    });

    it('returns true when date range is set', () => {
      store.setDateRange('2025-11-15', '2025-11-21');

      expect(store.hasActiveFilters).toBe(true);
    });

    it('returns true when only startDate is set', () => {
      store.setDateRange('2025-11-15', null);

      expect(store.hasActiveFilters).toBe(true);
    });

    it('returns true when only endDate is set', () => {
      store.setDateRange(null, '2025-11-21');

      expect(store.hasActiveFilters).toBe(true);
    });

    it('returns false after clearing all filters', () => {
      store.setSearchQuery('yoga');
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSelectedCategories(['Arts']);

      store.clearAllFilters();

      expect(store.hasActiveFilters).toBe(false);
    });
  });

  describe('hasNonDateFilters getter', () => {
    it('should return false when no filters are active', () => {
      expect(store.hasNonDateFilters).toBe(false);
    });

    it('should return false when only a start date is set', () => {
      store.setDateRange('2025-11-15', null);

      expect(store.hasNonDateFilters).toBe(false);
    });

    it('should return false when only an end date is set', () => {
      store.setDateRange(null, '2025-11-21');

      expect(store.hasNonDateFilters).toBe(false);
    });

    it('should return false when both start and end dates are set but no other filters', () => {
      store.setDateRange('2025-11-15', '2025-11-21');

      expect(store.hasNonDateFilters).toBe(false);
    });

    it('should return true when a search query is set', () => {
      store.setSearchQuery('yoga');

      expect(store.hasNonDateFilters).toBe(true);
    });

    it('should return true when search query is set alongside a date range', () => {
      store.setSearchQuery('yoga');
      store.setDateRange('2025-11-15', '2025-11-21');

      expect(store.hasNonDateFilters).toBe(true);
    });

    it('should return true when categories are selected', () => {
      store.setSelectedCategories(['cat-1']);

      expect(store.hasNonDateFilters).toBe(true);
    });

    it('should return true when categories are selected alongside a date range', () => {
      store.setSelectedCategories(['cat-1']);
      store.setDateRange('2025-11-15', '2025-11-21');

      expect(store.hasNonDateFilters).toBe(true);
    });

    it('should return true when both search query and categories are set', () => {
      store.setSearchQuery('music');
      store.setSelectedCategories(['cat-1', 'cat-2']);

      expect(store.hasNonDateFilters).toBe(true);
    });

    it('should return false after clearing all filters', () => {
      store.setSearchQuery('yoga');
      store.setSelectedCategories(['cat-1']);

      store.clearAllFilters();

      expect(store.hasNonDateFilters).toBe(false);
    });

    it('should return false when search query is whitespace only', () => {
      // setSearchQuery trims, so setting whitespace results in empty string
      store.setSearchQuery('   ');

      expect(store.hasNonDateFilters).toBe(false);
    });
  });

  describe('hasOnlyDateFilters getter', () => {
    it('should return false when no filters are active', () => {
      expect(store.hasOnlyDateFilters).toBe(false);
    });

    it('should return true when only start date is set', () => {
      store.setDateRange('2025-11-15', null);

      expect(store.hasOnlyDateFilters).toBe(true);
    });

    it('should return true when only end date is set', () => {
      store.setDateRange(null, '2025-11-21');

      expect(store.hasOnlyDateFilters).toBe(true);
    });

    it('should return true when both start and end dates are set and no other filters exist', () => {
      store.setDateRange('2025-11-15', '2025-11-21');

      expect(store.hasOnlyDateFilters).toBe(true);
    });

    it('should return false when only a search query is set (no date range)', () => {
      store.setSearchQuery('yoga');

      expect(store.hasOnlyDateFilters).toBe(false);
    });

    it('should return false when only categories are selected (no date range)', () => {
      store.setSelectedCategories(['cat-1']);

      expect(store.hasOnlyDateFilters).toBe(false);
    });

    it('should return false when date range is set AND search query is also set', () => {
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSearchQuery('yoga');

      expect(store.hasOnlyDateFilters).toBe(false);
    });

    it('should return false when date range is set AND categories are also selected', () => {
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSelectedCategories(['cat-1']);

      expect(store.hasOnlyDateFilters).toBe(false);
    });

    it('should return false when date range, search query, and categories are all set', () => {
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSearchQuery('yoga');
      store.setSelectedCategories(['cat-1']);

      expect(store.hasOnlyDateFilters).toBe(false);
    });

    it('should return false after clearing all filters', () => {
      store.setDateRange('2025-11-15', '2025-11-21');

      store.clearAllFilters();

      expect(store.hasOnlyDateFilters).toBe(false);
    });

    it('should return true when date is set and search is whitespace only', () => {
      // setSearchQuery trims, so whitespace-only input becomes empty string
      store.setSearchQuery('   ');
      store.setDateRange('2025-11-15', null);

      expect(store.hasOnlyDateFilters).toBe(true);
    });
  });

  describe('hasLoadedEvents state', () => {
    it('starts as false', () => {
      expect(store.hasLoadedEvents).toBe(false);
    });

    it('becomes true after loadEvents completes successfully', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({ items: [] });

      store.currentCalendarUrlName = 'test-calendar';
      await store.loadEvents('test-calendar');

      expect(store.hasLoadedEvents).toBe(true);
    });

    it('becomes true after loadEvents fails', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockRejectedValue(new Error('Network error'));

      store.currentCalendarUrlName = 'test-calendar';
      await store.loadEvents('test-calendar');

      expect(store.hasLoadedEvents).toBe(true);
    });

    it('resets to false when clearAll is called', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({ items: [] });

      store.currentCalendarUrlName = 'test-calendar';
      await store.loadEvents('test-calendar');
      expect(store.hasLoadedEvents).toBe(true);

      store.clearAll();

      expect(store.hasLoadedEvents).toBe(false);
    });
  });

  describe('reloadWithFilters action', () => {
    it('calls loadEvents with current filter state', async () => {
      store.currentCalendarUrlName = 'test-calendar';
      store.setSearchQuery('yoga');
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSelectedCategories(['Arts']);

      const loadEventsSpy = vi.spyOn(store, 'loadEvents');
      vi.spyOn(store, 'loadCategories').mockResolvedValue();

      await store.reloadWithFilters();

      expect(loadEventsSpy).toHaveBeenCalledWith('test-calendar', {
        search: 'yoga',
        categories: ['Arts'],
        startDate: '2025-11-15',
        endDate: '2025-11-21',
      });
    });

    it('does not include empty search query in API call', async () => {
      store.currentCalendarUrlName = 'test-calendar';
      store.setDateRange('2025-11-15', '2025-11-21');

      const loadEventsSpy = vi.spyOn(store, 'loadEvents');
      vi.spyOn(store, 'loadCategories').mockResolvedValue();

      await store.reloadWithFilters();

      expect(loadEventsSpy).toHaveBeenCalledWith('test-calendar', {
        startDate: '2025-11-15',
        endDate: '2025-11-21',
      });
    });

    it('does not call loadEvents if no calendar is set', async () => {
      store.currentCalendarUrlName = null;

      const loadEventsSpy = vi.spyOn(store, 'loadEvents');
      const loadCategoriesSpy = vi.spyOn(store, 'loadCategories');

      await store.reloadWithFilters();

      expect(loadEventsSpy).not.toHaveBeenCalled();
      expect(loadCategoriesSpy).not.toHaveBeenCalled();
    });
  });

  describe('getFilteredEventsByDay', () => {
    /**
     * Build a minimal CalendarEventInstance with a Luxon DateTime that carries
     * an explicit UTC offset, so toLocal() may produce a different calendar date
     * than toISODate() would on the raw (UTC) value.
     */
    const makeInstance = (isoWithOffset: string): CalendarEventInstance => {
      const event = new CalendarEvent();
      event.calendarId = 'test-cal';
      const dt = DateTime.fromISO(isoWithOffset);
      return new CalendarEventInstance('evt-' + isoWithOffset, event, dt, null);
    };

    beforeEach(() => {
      setActivePinia(createPinia());
      store = usePublicCalendarStore();
    });

    it('should group events by their local calendar date', () => {
      // An event starting at 2025-11-15T10:00:00Z — verify the key format and
      // that the event is accessible via the grouped result.
      const instance = makeInstance('2025-11-15T10:00:00Z');
      store.allEvents = [instance];

      const byDay = store.getFilteredEventsByDay;
      const keys = Object.keys(byDay);

      expect(keys.length).toBe(1);
      // The key must be a valid ISO date string
      expect(keys[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(byDay[keys[0]]).toHaveLength(1);
      // Use toStrictEqual because Pinia wraps stored objects in reactive proxies,
      // so reference equality (toBe) would fail even though the data is identical.
      expect(byDay[keys[0]][0]).toStrictEqual(instance);
    });

    it('should use toLocal() so the date key reflects the viewer timezone', () => {
      // Create a DateTime at UTC midnight on 2025-11-16.
      // In a timezone behind UTC (e.g. UTC-5) this is still 2025-11-15 locally.
      // We simulate this by constructing a DateTime that, after toLocal(), yields
      // a different date than its raw UTC ISO string.
      //
      // We use a fixed-offset zone so the test is deterministic regardless of
      // where the test runner is executing.

      // 2025-11-15T21:00:00-05:00 is 2025-11-16T02:00:00Z in UTC,
      // but the local date in the -05:00 zone is 2025-11-15.
      const dtUtcMinus5 = DateTime.fromISO('2025-11-15T21:00:00-05:00');
      const event = new CalendarEvent();
      event.calendarId = 'test-cal';
      const instance = new CalendarEventInstance('evt-tz', event, dtUtcMinus5, null);

      store.allEvents = [instance];

      const byDay = store.getFilteredEventsByDay;
      // The date key must be the LOCAL date produced by toLocal()
      const localDate = dtUtcMinus5.toLocal().toISODate();
      expect(Object.keys(byDay)).toContain(localDate);
      expect(byDay[localDate!]).toHaveLength(1);
    });

    it('should group multiple events on the same local date under one key', () => {
      const event = new CalendarEvent();
      event.calendarId = 'test-cal';

      const dt1 = DateTime.fromISO('2025-11-15T09:00:00Z');
      const dt2 = DateTime.fromISO('2025-11-15T17:30:00Z');

      const instance1 = new CalendarEventInstance('evt-1', event, dt1, null);
      const instance2 = new CalendarEventInstance('evt-2', event, dt2, null);

      store.allEvents = [instance1, instance2];

      const byDay = store.getFilteredEventsByDay;
      const keys = Object.keys(byDay);

      expect(keys.length).toBe(1);
      expect(byDay[keys[0]]).toHaveLength(2);
    });

    it('should place events on different local dates under separate keys', () => {
      const event = new CalendarEvent();
      event.calendarId = 'test-cal';

      const dt1 = DateTime.fromISO('2025-11-15T10:00:00Z');
      const dt2 = DateTime.fromISO('2025-11-16T10:00:00Z');

      const instance1 = new CalendarEventInstance('evt-1', event, dt1, null);
      const instance2 = new CalendarEventInstance('evt-2', event, dt2, null);

      store.allEvents = [instance1, instance2];

      const byDay = store.getFilteredEventsByDay;
      const keys = Object.keys(byDay);

      expect(keys.length).toBe(2);
      expect(keys).toContain(dt1.toLocal().toISODate());
      expect(keys).toContain(dt2.toLocal().toISODate());
    });

    it('should return empty object when there are no events', () => {
      store.allEvents = [];

      const byDay = store.getFilteredEventsByDay;

      expect(Object.keys(byDay).length).toBe(0);
    });
  });

  describe('loadCategories action', () => {
    /**
     * Build a minimal category wire payload with optional eventCount.
     */
    const makeCategoryPayload = (id: string, eventCount?: number) => ({
      id,
      calendarId: 'cal-1',
      ...(eventCount !== undefined ? { eventCount } : {}),
      content: {
        en: { language: 'en', name: `Category ${id}` },
      },
    });

    it('appends no query params when called without filters', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({ items: [] });

      await store.loadCategories('test-calendar');

      expect(ModelService.default.listModels).toHaveBeenCalledWith(
        '/api/public/v1/calendar/test-calendar/categories',
      );
    });

    it('appends startDate and endDate query params when provided', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({ items: [] });

      await store.loadCategories('test-calendar', {
        startDate: '2025-11-15',
        endDate: '2025-11-21',
      });

      expect(ModelService.default.listModels).toHaveBeenCalledWith(
        '/api/public/v1/calendar/test-calendar/categories?startDate=2025-11-15&endDate=2025-11-21',
      );
    });

    it('appends search query param when provided (>= 3 chars)', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({ items: [] });

      await store.loadCategories('test-calendar', { search: 'yoga' });

      expect(ModelService.default.listModels).toHaveBeenCalledWith(
        '/api/public/v1/calendar/test-calendar/categories?search=yoga',
      );
    });

    it('does not append search when shorter than 3 chars', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({ items: [] });

      await store.loadCategories('test-calendar', { search: 'yo' });

      expect(ModelService.default.listModels).toHaveBeenCalledWith(
        '/api/public/v1/calendar/test-calendar/categories',
      );
    });

    it('appends all filters together when provided', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({ items: [] });

      await store.loadCategories('test-calendar', {
        search: 'yoga class',
        startDate: '2025-11-15',
        endDate: '2025-11-21',
      });

      const callArg = (ModelService.default.listModels as any).mock.calls[0][0] as string;
      expect(callArg).toContain('/api/public/v1/calendar/test-calendar/categories?');
      expect(callArg).toContain('search=yoga+class');
      expect(callArg).toContain('startDate=2025-11-15');
      expect(callArg).toContain('endDate=2025-11-21');
    });

    it('sets hasLoadedCategories to true after a successful fetch', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({ items: [] });

      expect(store.hasLoadedCategories).toBe(false);
      await store.loadCategories('test-calendar');
      expect(store.hasLoadedCategories).toBe(true);
    });

    it('does NOT set hasLoadedCategories to true when fetch fails', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockRejectedValue(new Error('boom'));

      // Suppress noisy error log
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await store.loadCategories('test-calendar');

      expect(store.hasLoadedCategories).toBe(false);
      expect(store.categoryError).toBe('Failed to load categories');

      errSpy.mockRestore();
    });

    it('parses eventCount from wire payload onto availableCategories', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({
        items: [
          makeCategoryPayload('cat-a', 5),
          makeCategoryPayload('cat-b', 0),
          makeCategoryPayload('cat-c'), // no eventCount field — defaults to 0
        ],
      });

      await store.loadCategories('test-calendar');

      expect(store.availableCategories).toHaveLength(3);
      expect(store.availableCategories[0].eventCount).toBe(5);
      expect(store.availableCategories[1].eventCount).toBe(0);
      expect(store.availableCategories[2].eventCount).toBe(0);
    });
  });

  describe('presentCategoryIds getter', () => {
    it('returns undefined before any fetch has occurred (first-fetch invariant)', () => {
      // Default state: hasLoadedCategories=false, isLoadingCategories=false
      expect(store.hasLoadedCategories).toBe(false);
      expect(store.isLoadingCategories).toBe(false);
      expect(store.presentCategoryIds).toBeUndefined();
    });

    it('returns undefined while categories are loading', () => {
      // Simulate mid-flight: isLoadingCategories=true (regardless of hasLoadedCategories)
      store.isLoadingCategories = true;
      store.hasLoadedCategories = true;
      // Even if some stale categories are sitting in state, the getter must hide them
      const cat = new EventCategory('cat-1', 'cal-1');
      cat.eventCount = 3;
      store.availableCategories = [cat];

      expect(store.presentCategoryIds).toBeUndefined();
    });

    it('returns ids of categories with eventCount > 0 after a successful fetch', () => {
      const present = new EventCategory('cat-present', 'cal-1');
      present.eventCount = 4;
      const absent = new EventCategory('cat-absent', 'cal-1');
      absent.eventCount = 0;
      const alsoPresent = new EventCategory('cat-also', 'cal-1');
      alsoPresent.eventCount = 1;

      store.hasLoadedCategories = true;
      store.isLoadingCategories = false;
      store.availableCategories = [present, absent, alsoPresent];

      expect(store.presentCategoryIds).toEqual(['cat-present', 'cat-also']);
    });

    it('treats missing eventCount as zero (excludes from present list)', () => {
      const cat = new EventCategory('cat-no-count', 'cal-1');
      // eventCount defaults to 0 on the model — explicitly verify
      expect(cat.eventCount).toBe(0);

      store.hasLoadedCategories = true;
      store.isLoadingCategories = false;
      store.availableCategories = [cat];

      expect(store.presentCategoryIds).toEqual([]);
    });

    it('returns empty array (not undefined) when fetch loaded zero categories', () => {
      store.hasLoadedCategories = true;
      store.isLoadingCategories = false;
      store.availableCategories = [];

      // Empty array is correct here: fetch completed and the answer is "no categories present"
      expect(store.presentCategoryIds).toEqual([]);
    });

    it('integrates end-to-end: undefined → ids after loadCategories resolves', async () => {
      const ModelService = await import('@/client/service/models');
      (ModelService.default.listModels as any).mockResolvedValue({
        items: [
          {
            id: 'cat-1',
            calendarId: 'cal-1',
            eventCount: 2,
            content: { en: { language: 'en', name: 'Music' } },
          },
          {
            id: 'cat-2',
            calendarId: 'cal-1',
            eventCount: 0,
            content: { en: { language: 'en', name: 'Sports' } },
          },
        ],
      });

      expect(store.presentCategoryIds).toBeUndefined();

      await store.loadCategories('test-calendar');

      expect(store.presentCategoryIds).toEqual(['cat-1']);
    });
  });

  describe('reloadWithFilters reloads categories', () => {
    it('reloads categories with the same date/search context as events', async () => {
      store.currentCalendarUrlName = 'test-calendar';
      store.setSearchQuery('yoga');
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSelectedCategories(['cat-selected']);

      const loadCategoriesSpy = vi.spyOn(store, 'loadCategories').mockResolvedValue();
      const loadEventsSpy = vi.spyOn(store, 'loadEvents').mockResolvedValue();

      await store.reloadWithFilters();

      expect(loadEventsSpy).toHaveBeenCalledWith('test-calendar', {
        search: 'yoga',
        categories: ['cat-selected'],
        startDate: '2025-11-15',
        endDate: '2025-11-21',
      });
      expect(loadCategoriesSpy).toHaveBeenCalledWith('test-calendar', {
        search: 'yoga',
        startDate: '2025-11-15',
        endDate: '2025-11-21',
      });
    });

    it('does NOT pass selectedCategoryIds to the categories endpoint', async () => {
      store.currentCalendarUrlName = 'test-calendar';
      store.setSelectedCategories(['cat-selected-a', 'cat-selected-b']);

      const loadCategoriesSpy = vi.spyOn(store, 'loadCategories').mockResolvedValue();
      vi.spyOn(store, 'loadEvents').mockResolvedValue();

      await store.reloadWithFilters();

      const passedFilters = loadCategoriesSpy.mock.calls[0][1] as Record<string, unknown> | undefined;
      expect(passedFilters).toBeDefined();
      expect(passedFilters).not.toHaveProperty('categories');
    });

    it('falls back to the calendar default date window when no dates are set', async () => {
      // Regression: without this fallback the categories endpoint counted
      // events across all time on initial load, so every pill rendered as
      // active even when the default window had no events for some categories.
      store.currentCalendarUrlName = 'test-calendar';
      store.calendarDefaultDateRange = '2weeks';

      const loadCategoriesSpy = vi.spyOn(store, 'loadCategories').mockResolvedValue();
      const loadEventsSpy = vi.spyOn(store, 'loadEvents').mockResolvedValue();

      await store.reloadWithFilters();

      const eventsFilters = loadEventsSpy.mock.calls[0][1] as Record<string, unknown>;
      const categoryFilters = loadCategoriesSpy.mock.calls[0][1] as Record<string, unknown>;

      expect(eventsFilters.startDate).toBeDefined();
      expect(eventsFilters.endDate).toBeDefined();
      expect(categoryFilters.startDate).toBe(eventsFilters.startDate);
      expect(categoryFilters.endDate).toBe(eventsFilters.endDate);
    });

    it('omits search from category filters when shorter than 3 chars', async () => {
      store.currentCalendarUrlName = 'test-calendar';
      store.setSearchQuery('yo');
      store.setDateRange('2025-11-15', '2025-11-21');

      const loadCategoriesSpy = vi.spyOn(store, 'loadCategories').mockResolvedValue();
      vi.spyOn(store, 'loadEvents').mockResolvedValue();

      await store.reloadWithFilters();

      expect(loadCategoriesSpy).toHaveBeenCalledWith('test-calendar', {
        startDate: '2025-11-15',
        endDate: '2025-11-21',
      });
    });

    it('does not call loadCategories if no calendar is set', async () => {
      store.currentCalendarUrlName = null;

      const loadCategoriesSpy = vi.spyOn(store, 'loadCategories').mockResolvedValue();

      await store.reloadWithFilters();

      expect(loadCategoriesSpy).not.toHaveBeenCalled();
    });
  });
});
