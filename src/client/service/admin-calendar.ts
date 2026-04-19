import axios from 'axios';

import { handleApiError } from '@/client/service/utils';

/**
 * Filters for listing calendars in the admin dashboard.
 *
 * Mirrors the backend AdminCalendarListFilters interface from
 * server/calendar/service/calendar.ts.
 */
export interface AdminCalendarListFilters {
  search?: string;
  hasOpenReports?: boolean;
  sortBy?: 'created' | 'lastActivity' | 'eventCount';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/**
 * Pagination metadata returned with paginated admin calendar lists.
 */
export interface AdminCalendarPagination {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
}

/**
 * Row DTO for a single calendar in the admin listing.
 *
 * Mirrors the backend AdminCalendarRow interface. Deliberately omits owner
 * email — admins reach contact info through the account-management path.
 */
export interface AdminCalendarRow {
  id: string;
  urlName: string;
  title: string;
  owner: {
    accountId: string;
    displayName: string;
  };
  upcomingEventCount: number;
  lastActivityAt: string | null;
  fundingStatus: 'subscribed' | 'grant' | 'none';
  openReportCount: number;
}

/**
 * Response shape returned by GET /api/v1/admin/calendars.
 */
export interface AdminCalendarListResponse {
  items: AdminCalendarRow[];
  pagination: AdminCalendarPagination;
}

/**
 * Error name mapping for admin calendar API errors.
 *
 * Currently the endpoint only emits ValidationError for bad filter inputs;
 * other failures surface as generic 500s which become UnknownError.
 */
const errorMap: Record<string, new (...args: any[]) => Error> = {
  ValidationError: class ValidationError extends Error {
    constructor() {
      super('Invalid filter parameters');
      this.name = 'ValidationError';
    }
  },
};

/**
 * Builds a query string from admin calendar filters, omitting undefined values.
 *
 * @param filters - The filter parameters to serialize
 * @returns URL query string (including leading '?') or empty string
 */
function buildFilterQuery(filters?: AdminCalendarListFilters): string {
  if (!filters) {
    return '';
  }

  const params = new URLSearchParams();

  if (filters.page !== undefined) {
    params.set('page', String(filters.page));
  }
  if (filters.limit !== undefined) {
    params.set('limit', String(filters.limit));
  }
  if (filters.search) {
    params.set('search', filters.search);
  }
  if (filters.hasOpenReports) {
    params.set('hasOpenReports', 'true');
  }
  if (filters.sortBy) {
    params.set('sortBy', filters.sortBy);
  }
  if (filters.sortDir) {
    params.set('sortDir', filters.sortDir);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Client service for admin calendar listing endpoints.
 *
 * Provides methods for listing all local calendars with filtering,
 * sorting, and pagination. Parallels ModerationService for admin
 * report endpoints.
 */
export default class AdminCalendarService {

  /**
   * Fetches a paginated list of all local calendars for admin display.
   *
   * @param filters - Optional filtering, sorting, and pagination parameters
   * @returns Paginated list of admin calendar rows
   */
  async listCalendars(filters?: AdminCalendarListFilters): Promise<AdminCalendarListResponse> {
    try {
      const query = buildFilterQuery(filters);
      const response = await axios.get(`/api/v1/admin/calendars${query}`);

      return {
        items: response.data.items,
        pagination: response.data.pagination,
      };
    }
    catch (error: unknown) {
      console.error('Error fetching admin calendars:', error);
      handleApiError(error, errorMap);
    }
  }
}
