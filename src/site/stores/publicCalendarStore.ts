import { defineStore } from 'pinia';
import { EventCategory } from '@/common/model/event_category';
import CalendarEventInstance from '@/common/model/event_instance';
import { getDefaultDateRange } from '@/common/utils/datePresets';
import type { DefaultDateRange } from '@/common/model/calendar';
import ModelService from '@/client/service/models';

export interface PublicCalendarState {
  // Calendar data
  currentCalendarUrlName: string | null;
  serverDefaultDateRange: DefaultDateRange;
  calendarDefaultDateRange: DefaultDateRange;
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
  isLoadingEvents: boolean;
  hasLoadedEvents: boolean;
  isSearchPending: boolean;
  categoryError: string | null;
  eventError: string | null;
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
    isCalendarSettingsLoaded: false,
    availableCategories: [],
    selectedCategoryIds: [],
    searchQuery: '',
    startDate: null,
    endDate: null,
    allEvents: [],
    filteredEvents: [],
    isLoadingCategories: false,
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
     * Get filtered events grouped by day
     */
    getFilteredEventsByDay(): Record<string, CalendarEventInstance[]> {
      const eventsByDay: Record<string, CalendarEventInstance[]> = {};

      this.getFilteredEvents.forEach(instance => {
        const dateKey = instance.start.toISODate();
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
     * Get count of events after filtering
     */
    filteredEventCount(): number {
      return this.getFilteredEvents.length;
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
     * Load calendar data to get settings like defaultDateRange
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
      }
      catch (error) {
        console.error('Error loading calendar:', error);
        // Fall back to server default if we can't load the calendar
        this.calendarDefaultDateRange = this.serverDefaultDateRange;
      }
      finally {
        this.isCalendarSettingsLoaded = true;
      }
    },

    /**
     * Load categories for the current calendar
     */
    async loadCategories(calendarUrlName: string) {
      if (this.currentCalendarUrlName !== calendarUrlName) {
        this.setCurrentCalendar(calendarUrlName);
      }

      this.isLoadingCategories = true;
      this.categoryError = null;

      try {
        const categoriesData = await ModelService.listModels(
          `/api/public/v1/calendar/${calendarUrlName}/categories`,
        );

        this.availableCategories = categoriesData.items.map(categoryData =>
          EventCategory.fromObject(categoryData),
        );
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
          filters.categories.forEach(id => params.append('category', id));
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
      this.isLoadingEvents = false;
      this.hasLoadedEvents = false;
      this.isSearchPending = false;
    },

    /**
     * Reload events with current filter settings
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

        await this.loadEvents(this.currentCalendarUrlName, filters);
      }
    },
  },
});
