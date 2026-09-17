import { defineStore } from 'pinia';
import { EventCategory } from '@/common/model/event_category';
import CalendarEventInstance from '@/common/model/event_instance';
import { getDefaultDateRange } from '@/common/utils/datePresets';
import type { Calendar, DefaultDateRange } from '@/common/model/calendar';
import type { Media } from '@/common/model/media';
import ModelService from '@/client/service/models';
import CalendarService from '@/site/service/calendar';

export interface PublicCalendarState {
  // Calendar data
  currentCalendarUrlName: string | null;
  /**
   * The loaded calendar, kept as a hydrated model rather than discarded after
   * its settings are extracted. Its translated content is what resolves the
   * default event image's alt text, and that resolution is per-visitor-locale,
   * so it cannot be flattened to a string at load time. Both the site and the
   * widget read the default image from this store and so both need the model.
   *
   * It is hydrated from the PUBLIC projection, so only `id`, `urlName`,
   * `publicUrl`, `description`, `languages`, `defaultDateRange`,
   * `defaultEventImage` and `content` carry real values. Every other field is a
   * fabricated default — notably `listed`, which the "absent means true"
   * back-compat rule in `src/common/model/calendar.ts` invents as `true`. It
   * type-checks and it is wrong; do not read it here.
   */
  currentCalendar: Calendar | null;
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
    currentCalendar: null,
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
    hasLoadedCategories: false,
    isLoadingEvents: false,
    hasLoadedEvents: false,
    isSearchPending: false,
    categoryError: null,
    eventError: null,
  }),

  getters: {
    /**
     * The calendar's default event image, read off the loaded calendar rather
     * than stored beside it. Holding it separately meant one value lived in the
     * store twice in two shapes — the raw public projection alongside the
     * hydrated `Media` on `currentCalendar` — and the raw copy was typed as a
     * `Media` it was not. Reading through the model keeps a single
     * representation, and keeps the image and its alt text (resolved from the
     * same calendar's translated content) from ever describing each other
     * wrongly.
     */
    defaultEventImage(): Media | null {
      return this.currentCalendar?.defaultEventImage ?? null;
    },

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
     * Load the calendar whose settings drive the public views (defaultDateRange,
     * defaultEventImage) and retain it hydrated on `currentCalendar`, because its
     * translated content carries the default event image's alt text and that has
     * to be resolved per visitor locale at render time.
     *
     * The fetch and the hydration both go through CalendarService so the model
     * layer has exactly one place that turns this endpoint's payload into a
     * Calendar. The service caches by urlName, and both callers
     * (`src/site/components/calendar.vue`, `src/widget/components/widget-container.vue`)
     * have already asked it for this calendar before reaching here — so this is
     * normally a cache read, not a second request, and `currentCalendar` is the
     * very instance the page is already rendering from rather than an
     * independent copy of it that could drift.
     */
    async loadCalendar(calendarUrlName: string) {
      try {
        const calendarService = new CalendarService();
        const calendar = await calendarService.getCalendarByUrlName(calendarUrlName);

        this.currentCalendar = calendar;

        // Use the calendar's own setting when it has one, else the server-level default
        this.calendarDefaultDateRange = calendar?.defaultDateRange ?? this.serverDefaultDateRange;
      }
      catch (error) {
        console.error('Error loading calendar:', error);
        // Fall back to server default if we can't load the calendar
        this.calendarDefaultDateRange = this.serverDefaultDateRange;
        this.currentCalendar = null;
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
      // Nulls the default event image too — it is a getter over this calendar.
      this.currentCalendar = null;
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
     *
     * When the user has not picked an explicit date filter, both branches
     * fall back to the calendar's default date window. Without this, the
     * categories endpoint would count events across all time on initial
     * load and every pill would render as "active" even when the default
     * window contains no events for some categories.
     */
    async reloadWithFilters() {
      if (this.currentCalendarUrlName) {
        const defaultRange = getDefaultDateRange(this.calendarDefaultDateRange);
        const effectiveStartDate = this.startDate ?? defaultRange.startDate;
        const effectiveEndDate = this.endDate ?? defaultRange.endDate;

        const filters: FilterOptions = {
          startDate: effectiveStartDate,
          endDate: effectiveEndDate,
        };

        // Only include search filter if it has at least 3 characters
        if (this.searchQuery.trim().length >= 3) {
          filters.search = this.searchQuery;
        }
        if (this.selectedCategoryIds.length > 0) {
          filters.categories = this.selectedCategoryIds;
        }

        const categoryFilters: CategoryFilterOptions = {
          startDate: effectiveStartDate,
          endDate: effectiveEndDate,
        };
        if (this.searchQuery.trim().length >= 3) {
          categoryFilters.search = this.searchQuery;
        }

        await Promise.all([
          this.loadEvents(this.currentCalendarUrlName, filters),
          this.loadCategories(this.currentCalendarUrlName, categoryFilters),
        ]);
      }
    },
  },
});
