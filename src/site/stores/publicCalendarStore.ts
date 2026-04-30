import { defineStore } from 'pinia';
import { EventCategory } from '@/common/model/event_category';
import CalendarEventInstance from '@/common/model/event_instance';
import { getDefaultDateRange } from '@/common/utils/datePresets';
import type { DefaultDateRange } from '@/common/model/calendar';
import type { Media } from '@/common/model/media';
import ModelService from '@/client/service/models';

export interface PublicCalendarState {
  // Calendar data
  currentCalendarUrlName: string | null;
  serverDefaultDateRange: DefaultDateRange;
  calendarDefaultDateRange: DefaultDateRange;
  defaultEventImage: Media | null;
  isCalendarSettingsLoaded: boolean;

  // Category filtering
  availableCategories: EventCategory[];
  selectedCategoryIds: string[];

  // Search filtering
  searchQuery: string;

  // Date range filtering
  startDate: string | null;
  endDate: string | null;

  // Event data
  allEvents: CalendarEventInstance[];
  filteredEvents: CalendarEventInstance[];

  // UI state
  isLoadingCategories: boolean;
  hasLoadedCategories: boolean;
  isLoadingEvents: boolean;
  hasLoadedEvents: boolean;
  isSearchPending: boolean;
  categoryError: string | null;
  eventError: string | null;
}

export interface CategoryFilterOptions {
  search?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface FilterOptions {
  search?: string;
  categories?: string[];
  startDate?: string | null;
  endDate?: string | null;
}

export const usePublicCalendarStore = defineStore('publicCalendar', {
  state: (): PublicCalendarState => ({
    currentCalendarUrlName: null,
    serverDefaultDateRange: '2weeks',
    calendarDefaultDateRange: '2weeks',
    defaultEventImage: null,
    isCalendarSettingsLoaded: false,
    availableCategories: [],
    selectedCategoryIds: [],
    searchQuery: '',
    startDate: null,
    endDate: null,
    allEvents: [],
    filteredEvents: [],
    isLoadingCategories: false,
    hasLoadedCategories: false,
    isLoadingEvents: false,
    hasLoadedEvents: false,
    isSearchPending: false,
    categoryError: null,
    eventError: null,
  }),

  getters: {
    /**
     * Get events filtered by selected categories
     */
    getFilteredEvents(): CalendarEventInstance[] {
      if (this.selectedCategoryIds.length === 0) {
        return this.allEvents;
      }

      return this.allEvents.filter(instance => {
        const eventCategoryIds = instance.event.categories?.map(cat => cat.id) || [];
        return this.selectedCategoryIds.some(selectedId =>
          eventCategoryIds.includes(selectedId),
        );
      });
    },

    /**
     * Get filtered events grouped by day using the viewer's local timezone.
     * Using toLocal() ensures day boundaries are determined by the viewer's
     * clock rather than the server's timezone, preventing events from
     * appearing on the wrong day when the server runs in a different timezone.
     */
    getFilteredEventsByDay(): Record<string, CalendarEventInstance[]> {
      const eventsByDay: Record<string, CalendarEventInstance[]> = {};

      this.getFilteredEvents.forEach(instance => {
        const dateKey = instance.start.toLocal().toISODate();
        if (dateKey) {
          if (!eventsByDay[dateKey]) {
            eventsByDay[dateKey] = [];
          }
          eventsByDay[dateKey].push(instance);
        }
      });

      return eventsByDay;
    },

    /**
     * Check if any filters are active (categories, search, or date range)
     */
    hasActiveFilters(): boolean {
      return (
        this.selectedCategoryIds.length > 0 ||
        this.searchQuery.trim().length > 0 ||
        this.startDate !== null ||
        this.endDate !== null
      );
    },

    /**
     * Check if non-date filters (search or category) are active.
     * Used to distinguish "no results due to search/category" from
     * "no results in this date window".
     */
    hasNonDateFilters(): boolean {
      return (
        this.selectedCategoryIds.length > 0 ||
        this.searchQuery.trim().length > 0
      );
    },

    /**
     * Check if only date filters are active (no search or category filters).
     * Used to show "no events in this date range" message.
     */
    hasOnlyDateFilters(): boolean {
      const hasDateFilter = this.startDate !== null || this.endDate !== null;
      const hasNonDate = this.selectedCategoryIds.length > 0 || this.searchQuery.trim().length > 0;
      return hasDateFilter && !hasNonDate;
    },

    /**
     * Get count of events after filtering
     */
    filteredEventCount(): number {
      return this.getFilteredEvents.length;
    },

    /**
     * IDs of categories that have at least one event in the current
     * date/search window.
     *
     * Returns `undefined` when categories are still loading OR before the
     * first successful fetch — callers MUST treat `undefined` as "presence
     * data not yet available" rather than "no categories present".
     * Returning an empty array would falsely flag every pill as absent.
     */
    presentCategoryIds(): string[] | undefined {
      if (this.isLoadingCategories || !this.hasLoadedCategories) {
        return undefined;
      }
      return this.availableCategories
        .filter(c => (c.eventCount ?? 0) > 0)
        .map(c => c.id);
    },
  },

  actions: {
    /**
     * Set the current calendar being viewed
     */
    setCurrentCalendar(urlName: string) {
      if (this.currentCalendarUrlName !== urlName) {
        this.currentCalendarUrlName = urlName;
        // Reset state when switching calendars
        this.clearAll();
      }
    },

    /**
     * Set the server-level default date range (from site config)
     */
    setServerDefaultDateRange(defaultRange: DefaultDateRange) {
      this.serverDefaultDateRange = defaultRange;
      // Also update calendar default if no calendar-specific setting has been loaded yet
      if (!this.isCalendarSettingsLoaded) {
        this.calendarDefaultDateRange = defaultRange;
      }
    },

    /**
     * Load calendar data to get settings like defaultDateRange and defaultEventImage
     */
    async loadCalendar(calendarUrlName: string) {
      try {
        const calendarData = await ModelService.getModel(
          `/api/public/v1/calendar/${calendarUrlName}`,
        );

        if (calendarData && calendarData.defaultDateRange) {
          // Use the calendar's specific setting
          this.calendarDefaultDateRange = calendarData.defaultDateRange;
        }
        else {
          // Fall back to the server-level default
          this.calendarDefaultDateRange = this.serverDefaultDateRange;
        }

        // Extract the default event image (public API returns { id, mimeType } or null)
        this.defaultEventImage = calendarData?.defaultEventImage ?? null;
      }
      catch (error) {
        console.error('Error loading calendar:', error);
        // Fall back to server default if we can't load the calendar
        this.calendarDefaultDateRange = this.serverDefaultDateRange;
        this.defaultEventImage = null;
      }
      finally {
        this.isCalendarSettingsLoaded = true;
      }
    },

    /**
     * Load categories for the current calendar.
     *
     * Optional filters scope which events the server includes when computing
     * each category's eventCount. The filters do NOT include
     * selectedCategoryIds — category-presence must be independent of the
     * user's current category selection (otherwise selecting a category
     * would hide all the others).
     */
    async loadCategories(calendarUrlName: string, filters?: CategoryFilterOptions) {
      if (this.currentCalendarUrlName !== calendarUrlName) {
        this.setCurrentCalendar(calendarUrlName);
      }

      this.isLoadingCategories = true;
      this.categoryError = null;

      try {
        let url = `/api/public/v1/calendar/${calendarUrlName}/categories`;
        const params = new URLSearchParams();

        // Add search parameter if provided (minimum 3 characters; matches loadEvents)
        if (filters?.search && filters.search.trim().length >= 3) {
          params.append('search', filters.search.trim());
        }

        if (filters?.startDate) {
          params.append('startDate', filters.startDate);
        }

        if (filters?.endDate) {
          params.append('endDate', filters.endDate);
        }

        if (params.toString()) {
          url += `?${params.toString()}`;
        }

        const categoriesData = await ModelService.listModels(url);

        this.availableCategories = categoriesData.items.map(categoryData =>
          EventCategory.fromObject(categoryData),
        );
        this.hasLoadedCategories = true;
      }
      catch (error) {
        console.error('Error loading categories:', error);
        this.categoryError = 'Failed to load categories';
        this.availableCategories = [];
      }
      finally {
        this.isLoadingCategories = false;
      }
    },

    /**
     * Load events for the current calendar with optional filters
     */
    async loadEvents(calendarUrlName: string, filters?: FilterOptions) {
      if (this.currentCalendarUrlName !== calendarUrlName) {
        this.setCurrentCalendar(calendarUrlName);
      }

      this.isLoadingEvents = true;
      this.eventError = null;

      try {
        let url = `/api/public/v1/calendar/${calendarUrlName}/events`;
        const params = new URLSearchParams();

        // Add search parameter if provided (minimum 3 characters)
        if (filters?.search && filters.search.trim().length >= 3) {
          params.append('search', filters.search.trim());
        }

        // Add category filter parameters if provided (UUIDs per DEC-005)
        if (filters?.categories && filters.categories.length > 0) {
          filters.categories.forEach(id => params.append('categories', id));
        }

        // Add date range parameters - use calendar's default if none specified
        const defaultRange = getDefaultDateRange(this.calendarDefaultDateRange);
        const effectiveStartDate = filters?.startDate ?? defaultRange.startDate;
        const effectiveEndDate = filters?.endDate ?? defaultRange.endDate;

        params.append('startDate', effectiveStartDate);
        params.append('endDate', effectiveEndDate);

        // Append query parameters if any were added
        if (params.toString()) {
          url += `?${params.toString()}`;
        }

        const eventsData = await ModelService.listModels(url);

        this.allEvents = eventsData.items.map(eventData =>
          CalendarEventInstance.fromObject(eventData),
        );
      }
      catch (error) {
        console.error('Error loading events:', error);
        this.eventError = 'Failed to load events';
        this.allEvents = [];
      }
      finally {
        this.isLoadingEvents = false;
        this.hasLoadedEvents = true;
      }
    },

    /**
     * Set selected category names
     */
    setSelectedCategories(categoryIds: string[]) {
      this.selectedCategoryIds = [...categoryIds];
    },

    /**
     * Toggle a category filter
     */
    toggleCategory(categoryId: string) {
      const index = this.selectedCategoryIds.indexOf(categoryId);
      if (index > -1) {
        this.selectedCategoryIds.splice(index, 1);
      }
      else {
        this.selectedCategoryIds.push(categoryId);
      }
    },

    /**
     * Set search query (with trimming)
     */
    setSearchQuery(query: string) {
      this.searchQuery = query.trim();
    },

    /**
     * Set the search pending state. True when user has typed 1-2 characters
     * in the search input (below the 3-character minimum for search).
     */
    setSearchPending(pending: boolean) {
      this.isSearchPending = pending;
    },

    /**
     * Set date range for filtering
     */
    setDateRange(start: string | null, end: string | null) {
      this.startDate = start;
      this.endDate = end;
    },

    /**
     * Clear all filters (search, categories, and date range)
     */
    clearAllFilters() {
      this.searchQuery = '';
      this.selectedCategoryIds = [];
      this.startDate = null;
      this.endDate = null;
      this.isSearchPending = false;
    },

    /**
     * Clear all category filters only
     */
    clearFilters() {
      this.selectedCategoryIds = [];
    },

    /**
     * Clear all state
     */
    clearAll() {
      this.calendarDefaultDateRange = this.serverDefaultDateRange;
      this.defaultEventImage = null;
      this.isCalendarSettingsLoaded = false;
      this.availableCategories = [];
      this.selectedCategoryIds = [];
      this.searchQuery = '';
      this.startDate = null;
      this.endDate = null;
      this.allEvents = [];
      this.filteredEvents = [];
      this.categoryError = null;
      this.eventError = null;
      this.isLoadingCategories = false;
      this.hasLoadedCategories = false;
      this.isLoadingEvents = false;
      this.hasLoadedEvents = false;
      this.isSearchPending = false;
    },

    /**
     * Reload events AND categories with current filter settings.
     *
     * Categories are reloaded with the SAME date/search context so that
     * eventCount (and thus presentCategoryIds) reflects the current window.
     * Categories are NOT reloaded with selectedCategoryIds — category
     * presence must be independent of the user's category selection.
     */
    async reloadWithFilters() {
      if (this.currentCalendarUrlName) {
        const filters: FilterOptions = {};

        // Only include search filter if it has at least 3 characters
        if (this.searchQuery.trim().length >= 3) {
          filters.search = this.searchQuery;
        }
        if (this.selectedCategoryIds.length > 0) {
          filters.categories = this.selectedCategoryIds;
        }
        if (this.startDate) {
          filters.startDate = this.startDate;
        }
        if (this.endDate) {
          filters.endDate = this.endDate;
        }

        const categoryFilters: CategoryFilterOptions = {};
        if (this.searchQuery.trim().length >= 3) {
          categoryFilters.search = this.searchQuery;
        }
        if (this.startDate) {
          categoryFilters.startDate = this.startDate;
        }
        if (this.endDate) {
          categoryFilters.endDate = this.endDate;
        }

        await Promise.all([
          this.loadEvents(this.currentCalendarUrlName, filters),
          this.loadCategories(this.currentCalendarUrlName, categoryFilters),
        ]);
      }
    },
  },
});
