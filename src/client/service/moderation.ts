import axios from 'axios';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import type { ReporterType } from '@/common/model/report';
import { UnknownError } from '@/common/exceptions/base';
import { validateAndEncodeId } from '@/client/service/utils';

/**
 * Filters for querying reports.
 */
export interface ReportFilters {
  status?: ReportStatus;
  category?: ReportCategory;
  eventId?: string;
  source?: ReporterType;
  sortBy?: 'created_at' | 'updated_at' | 'status' | 'category';
  sortOrder?: 'ASC' | 'DESC';
  page?: number;
  limit?: number;
}

/**
 * Pagination metadata returned with paginated report lists.
 */
export interface ReportPagination {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
}

/**
 * Response shape for paginated report listing.
 */
export interface PaginatedReportsResponse {
  reports: Report[];
  pagination: ReportPagination;
}

/**
 * Escalation history record for a report.
 */
export interface EscalationRecord {
  id: string;
  reportId: string;
  fromStatus: string;
  toStatus: string;
  reviewerId: string | null;
  reviewerRole: string;
  decision: string;
  notes: string | null;
  createdAt: string;
}

/**
 * Response shape for a single report detail with escalation history.
 */
export interface ReportDetailResponse {
  report: Report;
  escalationHistory: EscalationRecord[];
}

/**
 * Error name mapping for moderation API errors.
 */
const errorMap: Record<string, new (...args: any[]) => Error> = {
  ReportNotFoundError: class ReportNotFoundError extends Error {
    constructor() { super('Report not found'); this.name = 'ReportNotFoundError'; }
  },
  ReportAlreadyResolvedError: class ReportAlreadyResolvedError extends Error {
    constructor() { super('Report has already been resolved'); this.name = 'ReportAlreadyResolvedError'; }
  },
  ForbiddenError: class ForbiddenError extends Error {
    constructor() { super('You do not have permission to perform this action'); this.name = 'ForbiddenError'; }
  },
  ValidationError: class ValidationError extends Error {
    constructor() { super('Invalid input'); this.name = 'ValidationError'; }
  },
};

/**
 * Maps backend error responses to domain-specific exceptions.
 *
 * @param error - The error from the API call
 */
function handleModerationError(error: unknown): void {
  if (error && typeof error === 'object' && 'response' in error &&
      error.response && typeof error.response === 'object' && 'data' in error.response) {

    const responseData = error.response.data as Record<string, unknown>;
    const errorName = responseData.errorName as string;

    if (errorName && errorName in errorMap) {
      const ErrorClass = errorMap[errorName];
      throw new ErrorClass();
    }
  }
}

/**
 * Builds a query string from report filters, omitting undefined values.
 *
 * @param filters - The report filter parameters
 * @returns URL query string (including leading '?') or empty string
 */
function buildFilterQuery(filters?: ReportFilters): string {
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
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.category) {
    params.set('category', filters.category);
  }
  if (filters.eventId) {
    params.set('eventId', filters.eventId);
  }
  if (filters.source) {
    params.set('source', filters.source);
  }
  if (filters.sortBy) {
    params.set('sortBy', filters.sortBy);
  }
  if (filters.sortOrder) {
    params.set('sortOrder', filters.sortOrder);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Client service for calendar owner moderation endpoints.
 *
 * Provides methods for listing, viewing, and acting on reports
 * filed against events in a calendar.
 */
export default class ModerationService {

  /**
   * Fetches a paginated list of reports for a calendar with optional filters.
   *
   * @param calendarId - The calendar UUID
   * @param filters - Optional filtering, sorting, and pagination parameters
   * @returns Paginated list of reports
   */
  async getReports(calendarId: string, filters?: ReportFilters): Promise<PaginatedReportsResponse> {
    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const query = buildFilterQuery(filters);
      const response = await axios.get(`/api/v1/calendars/${encodedCalendarId}/reports${query}`);

      return {
        reports: response.data.reports.map((reportData: Record<string, any>) => Report.fromObject(reportData)),
        pagination: response.data.pagination,
      };
    }
    catch (error: unknown) {
      console.error('Error fetching reports:', error);
      handleModerationError(error);
      throw new UnknownError();
    }
  }

  /**
   * Fetches a single report detail with its escalation history.
   *
   * @param calendarId - The calendar UUID
   * @param reportId - The report UUID
   * @returns Report detail with escalation history
   */
  async getReport(calendarId: string, reportId: string): Promise<ReportDetailResponse> {
    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const encodedReportId = validateAndEncodeId(reportId, 'Report ID');
      const response = await axios.get(
        `/api/v1/calendars/${encodedCalendarId}/reports/${encodedReportId}`,
      );

      return {
        report: Report.fromObject(response.data.report),
        escalationHistory: response.data.escalationHistory ?? [],
      };
    }
    catch (error: unknown) {
      console.error('Error fetching report detail:', error);
      handleModerationError(error);
      throw new UnknownError();
    }
  }

  /**
   * Updates the owner notes on a report.
   *
   * @param calendarId - The calendar UUID
   * @param reportId - The report UUID
   * @param ownerNotes - The notes text to set
   * @returns The updated report
   */
  async updateReportNotes(calendarId: string, reportId: string, ownerNotes: string): Promise<Report> {
    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const encodedReportId = validateAndEncodeId(reportId, 'Report ID');
      const response = await axios.put(
        `/api/v1/calendars/${encodedCalendarId}/reports/${encodedReportId}`,
        { ownerNotes },
      );

      return Report.fromObject(response.data.report);
    }
    catch (error: unknown) {
      console.error('Error updating report notes:', error);
      handleModerationError(error);
      throw new UnknownError();
    }
  }

  /**
   * Resolves a report with required notes explaining the resolution.
   *
   * @param calendarId - The calendar UUID
   * @param reportId - The report UUID
   * @param notes - Resolution notes (required)
   * @returns The resolved report
   */
  async resolveReport(calendarId: string, reportId: string, notes: string): Promise<Report> {
    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const encodedReportId = validateAndEncodeId(reportId, 'Report ID');
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarId}/reports/${encodedReportId}/resolve`,
        { notes },
      );

      return Report.fromObject(response.data.report);
    }
    catch (error: unknown) {
      console.error('Error resolving report:', error);
      handleModerationError(error);
      throw new UnknownError();
    }
  }

  /**
   * Dismisses a report. This automatically escalates the report to admin review.
   *
   * @param calendarId - The calendar UUID
   * @param reportId - The report UUID
   * @param notes - Dismissal notes (required)
   * @returns The dismissed/escalated report
   */
  async dismissReport(calendarId: string, reportId: string, notes: string): Promise<Report> {
    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const encodedReportId = validateAndEncodeId(reportId, 'Report ID');
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarId}/reports/${encodedReportId}/dismiss`,
        { notes },
      );

      return Report.fromObject(response.data.report);
    }
    catch (error: unknown) {
      console.error('Error dismissing report:', error);
      handleModerationError(error);
      throw new UnknownError();
    }
  }

  /**
   * Updates an editor's moderation permission for a calendar.
   *
   * @param calendarId - The calendar UUID
   * @param editorId - The editor UUID
   * @param canReviewReports - Whether the editor can review reports
   */
  async updateEditorPermissions(calendarId: string, editorId: string, canReviewReports: boolean): Promise<void> {
    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const encodedEditorId = validateAndEncodeId(editorId, 'Editor ID');
      await axios.put(
        `/api/v1/calendars/${encodedCalendarId}/editors/${encodedEditorId}/permissions`,
        { canReviewReports },
      );
    }
    catch (error: unknown) {
      console.error('Error updating editor permissions:', error);
      handleModerationError(error);
      throw new UnknownError();
    }
  }
}
