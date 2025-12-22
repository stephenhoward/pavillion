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
  selectedCategoryNames: string[]; // Changed from IDs to names

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
    selectedCategoryNames: [],
    searchQuery: '',
    startDate: null,
    endDate: null,
    allEvents: [],
    filteredEvents: [],
    isLoadingCategories: false,
    isLoadingEvents: false,
    categoryError: null,
    eventError: null,
  }),

  getters: {
    /**
     * Get events filtered by selected categories
     */
    getFilteredEvents(): CalendarEventInstance[] {
      console.log('filter by ',this.selectedCategoryNames);
      if (this.selectedCategoryNames.length === 0) {
        return this.allEvents;
      }

      return this.allEvents.filter(event => {
        // Check if event has any of the selected categories by name
        console.log(event);
        const eventCategoryNames = event.event.categories?.map(cat => {
          try {
            // Get category name in English, fallback to first available language
            const content = cat.content('en') || cat.content(cat.getLanguages()[0]);
            return content?.name || '';
          }
          catch {
            return '';
          }
        }).filter(name => name.length > 0) || [];

        return this.selectedCategoryNames.some(selectedName =>
          eventCategoryNames.includes(selectedName),
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
        this.selectedCategoryNames.length > 0 ||
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
          `/api/public/v1/calendars/${calendarUrlName}`,
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
          `/api/public/v1/calendars/${calendarUrlName}/categories`,
        );

        this.availableCategories = categoriesData.map(categoryData =>
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
        let url = `/api/public/v1/calendars/${calendarUrlName}/events`;
        const params = new URLSearchParams();

        // Add search parameter if provided (minimum 3 characters)
        if (filters?.search && filters.search.trim().length >= 3) {
          params.append('search', filters.search.trim());
        }

        // Add category filter parameters if provided
        if (filters?.categories && filters.categories.length > 0) {
          filters.categories.forEach(name => params.append('category', name));
          // Add language parameter so backend knows which language to use for category name matching
          params.append('lang', 'en');
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

        this.allEvents = eventsData.map(eventData =>
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
      }
    },

    /**
     * Set selected category names
     */
    setSelectedCategories(categoryNames: string[]) {
      this.selectedCategoryNames = [...categoryNames];
    },

    /**
     * Toggle a category filter
     */
    toggleCategory(categoryName: string) {
      const index = this.selectedCategoryNames.indexOf(categoryName);
      if (index > -1) {
        this.selectedCategoryNames.splice(index, 1);
      }
      else {
        this.selectedCategoryNames.push(categoryName);
      }
    },

    /**
     * Set search query (with trimming)
     */
    setSearchQuery(query: string) {
      this.searchQuery = query.trim();
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
      this.selectedCategoryNames = [];
      this.startDate = null;
      this.endDate = null;
    },

    /**
     * Clear all category filters only
     */
    clearFilters() {
      this.selectedCategoryNames = [];
    },

    /**
     * Clear all state
     */
    clearAll() {
      this.calendarDefaultDateRange = this.serverDefaultDateRange;
      this.isCalendarSettingsLoaded = false;
      this.availableCategories = [];
      this.selectedCategoryNames = [];
      this.searchQuery = '';
      this.startDate = null;
      this.endDate = null;
      this.allEvents = [];
      this.filteredEvents = [];
      this.categoryError = null;
      this.eventError = null;
      this.isLoadingCategories = false;
      this.isLoadingEvents = false;
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
        if (this.selectedCategoryNames.length > 0) {
          filters.categories = this.selectedCategoryNames;
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
