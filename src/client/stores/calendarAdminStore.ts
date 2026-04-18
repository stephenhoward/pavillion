import { defineStore } from 'pinia';

import AdminCalendarService from '@/client/service/admin-calendar';
import type {
  AdminCalendarRow,
  AdminCalendarPagination,
} from '@/client/service/admin-calendar';

/**
 * Filter state for the admin calendar list.
 */
export interface AdminCalendarFilters {
  search: string;
  hasOpenReports: boolean;
  sortBy: 'created' | 'lastActivity' | 'eventCount';
  sortDir: 'asc' | 'desc';
}

/**
 * Keys of the filter object that can be set via setFilter().
 */
export type AdminCalendarFilterKey = keyof AdminCalendarFilters;

/**
 * Value type accepted by setFilter() for a given filter key.
 */
export type AdminCalendarFilterValue<K extends AdminCalendarFilterKey> = AdminCalendarFilters[K];

/**
 * State shape for the admin calendar store.
 */
interface CalendarAdminState {
  items: AdminCalendarRow[];
  pagination: AdminCalendarPagination;
  filters: AdminCalendarFilters;
  page: number;
  loading: boolean;
  error: string | null;
}

/** Shared service instance for all store actions. */
const adminCalendarService = new AdminCalendarService();

/**
 * Default pagination state before any fetch has returned.
 */
function defaultPagination(): AdminCalendarPagination {
  return {
    currentPage: 1,
    totalPages: 0,
    totalCount: 0,
    limit: 20,
  };
}

/**
 * Default filter state.
 */
function defaultFilters(): AdminCalendarFilters {
  return {
    search: '',
    hasOpenReports: false,
    sortBy: 'lastActivity',
    sortDir: 'desc',
  };
}

/**
 * Pinia store for the admin calendars dashboard.
 *
 * Manages paginated listing state backed by AdminCalendarService.
 * Parallels useModerationStore's admin-level report state, but uses the
 * camelCase + Store naming convention that matches the majority of
 * project stores.
 */
export const useCalendarAdminStore = defineStore('calendarAdmin', {
  state: (): CalendarAdminState => ({
    items: [],
    pagination: defaultPagination(),
    filters: defaultFilters(),
    page: 1,
    loading: false,
    error: null,
  }),

  actions: {
    /**
     * Fetches the current page of calendars using the current filter state.
     * Populates items, pagination, and error/loading flags.
     */
    async loadCalendars() {
      this.loading = true;
      this.error = null;

      try {
        const result = await adminCalendarService.listCalendars({
          search: this.filters.search || undefined,
          hasOpenReports: this.filters.hasOpenReports || undefined,
          sortBy: this.filters.sortBy,
          sortDir: this.filters.sortDir,
          page: this.page,
          limit: this.pagination.limit,
        });

        this.items = result.items;
        this.pagination = result.pagination;
      }
      catch (error) {
        this.error = error instanceof Error ? error.message : 'Failed to load calendars';
        throw error;
      }
      finally {
        this.loading = false;
      }
    },

    /**
     * Updates a filter value and re-fetches the calendar list.
     * Any filter change resets the page number to 1.
     *
     * @param key - The filter key to update
     * @param value - The new value for the filter
     */
    async setFilter<K extends AdminCalendarFilterKey>(key: K, value: AdminCalendarFilterValue<K>) {
      this.filters = {
        ...this.filters,
        [key]: value,
      };
      this.page = 1;
      await this.loadCalendars();
    },

    /**
     * Navigates to the given page and re-fetches the calendar list.
     *
     * @param page - The page number (1-based)
     */
    async setPage(page: number) {
      this.page = page;
      await this.loadCalendars();
    },

    /**
     * Resets all store state to initial values.
     */
    reset() {
      this.items = [];
      this.pagination = defaultPagination();
      this.filters = defaultFilters();
      this.page = 1;
      this.loading = false;
      this.error = null;
    },
  },
});
