import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventCategory } from '@/common/model/event_category';

// Mock ModelService
vi.mock('@/client/service/models', () => ({
  default: {
    listModels: vi.fn(),
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
      expect(store.selectedCategoryNames).toEqual(['Arts', 'Sports']);

      store.clearAllFilters();

      expect(store.selectedCategoryNames).toEqual([]);
    });

    it('resets all filters simultaneously', () => {
      store.setSearchQuery('yoga');
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSelectedCategories(['Arts']);

      store.clearAllFilters();

      expect(store.searchQuery).toBe('');
      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();
      expect(store.selectedCategoryNames).toEqual([]);
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

  describe('reloadWithFilters action', () => {
    it('calls loadEvents with current filter state', async () => {
      store.currentCalendarUrlName = 'test-calendar';
      store.setSearchQuery('yoga');
      store.setDateRange('2025-11-15', '2025-11-21');
      store.setSelectedCategories(['Arts']);

      const loadEventsSpy = vi.spyOn(store, 'loadEvents');

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

      await store.reloadWithFilters();

      expect(loadEventsSpy).toHaveBeenCalledWith('test-calendar', {
        startDate: '2025-11-15',
        endDate: '2025-11-21',
      });
    });

    it('does not call loadEvents if no calendar is set', async () => {
      store.currentCalendarUrlName = null;

      const loadEventsSpy = vi.spyOn(store, 'loadEvents');

      await store.reloadWithFilters();

      expect(loadEventsSpy).not.toHaveBeenCalled();
    });
  });
});
