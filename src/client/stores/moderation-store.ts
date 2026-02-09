import { defineStore } from 'pinia';

import { Report } from '@/common/model/report';
import ModerationService from '@/client/service/moderation';
import type {
  ReportFilters,
  ReportPagination,
  EscalationRecord,
} from '@/client/service/moderation';

/**
 * Detail view for a single report including its escalation history.
 */
interface ReportDetail {
  report: Report;
  escalationHistory: EscalationRecord[];
}

/**
 * State interface for the moderation store.
 */
interface ModerationState {
  reports: Report[];
  currentReport: ReportDetail | null;
  pagination: ReportPagination;
  filters: ReportFilters;
  loading: boolean;
  loadingReport: boolean;
  error: string | null;
}

/** Shared service instance for all store actions. */
const moderationService = new ModerationService();

/**
 * Pinia store for managing moderation report state.
 *
 * Provides actions for listing, viewing, and acting on reports
 * filed against events in a calendar. Delegates all API
 * communication to ModerationService.
 */
export const useModerationStore = defineStore('moderation', {
  state: (): ModerationState => {
    return {
      reports: [],
      currentReport: null,
      pagination: {
        currentPage: 1,
        totalPages: 0,
        totalCount: 0,
        limit: 20,
      },
      filters: {},
      loading: false,
      loadingReport: false,
      error: null,
    };
  },

  getters: {
    /**
     * Whether the reports array contains any reports.
     */
    hasReports: (state) => state.reports.length > 0,

    /**
     * Count of active (non-empty) filter values.
     */
    activeFilters: (state) => {
      let count = 0;
      if (state.filters.status) count++;
      if (state.filters.category) count++;
      if (state.filters.eventId) count++;
      if (state.filters.source) count++;
      if (state.filters.sortBy) count++;
      if (state.filters.sortOrder) count++;
      return count;
    },
  },

  actions: {
    /**
     * Fetches a paginated list of reports for a calendar.
     * Merges the current store filters with any additional filters provided.
     *
     * @param calendarId - The calendar UUID
     * @param filters - Optional additional filter overrides
     */
    async fetchReports(calendarId: string, filters?: ReportFilters) {
      this.loading = true;
      this.error = null;

      try {
        const mergedFilters: ReportFilters = {
          ...this.filters,
          ...filters,
        };

        const result = await moderationService.getReports(calendarId, mergedFilters);
        this.reports = result.reports;
        this.pagination = result.pagination;
      }
      catch (error) {
        this.error = error instanceof Error ? error.message : 'Failed to load reports';
        throw error;
      }
      finally {
        this.loading = false;
      }
    },

    /**
     * Fetches a single report with its escalation history.
     *
     * @param calendarId - The calendar UUID
     * @param reportId - The report UUID
     */
    async fetchReport(calendarId: string, reportId: string) {
      this.loadingReport = true;
      this.error = null;

      try {
        const result = await moderationService.getReport(calendarId, reportId);
        this.currentReport = {
          report: result.report,
          escalationHistory: result.escalationHistory,
        };
      }
      catch (error) {
        this.error = error instanceof Error ? error.message : 'Failed to load report';
        throw error;
      }
      finally {
        this.loadingReport = false;
      }
    },

    /**
     * Resolves a report and refreshes the report list.
     *
     * @param calendarId - The calendar UUID
     * @param reportId - The report UUID
     * @param notes - Resolution notes
     */
    async resolveReport(calendarId: string, reportId: string, notes: string) {
      this.error = null;

      try {
        const updatedReport = await moderationService.resolveReport(calendarId, reportId, notes);

        // Update the report in the local list
        const index = this.reports.findIndex((r: Report) => r.id === reportId);
        if (index >= 0) {
          this.reports[index] = updatedReport;
        }

        // Update current report if viewing this one
        if (this.currentReport && this.currentReport.report.id === reportId) {
          this.currentReport.report = updatedReport;
        }
      }
      catch (error) {
        this.error = error instanceof Error ? error.message : 'Failed to resolve report';
        throw error;
      }
    },

    /**
     * Dismisses a report (auto-escalates to admin) and refreshes the local state.
     *
     * @param calendarId - The calendar UUID
     * @param reportId - The report UUID
     * @param notes - Dismissal notes
     */
    async dismissReport(calendarId: string, reportId: string, notes: string) {
      this.error = null;

      try {
        const updatedReport = await moderationService.dismissReport(calendarId, reportId, notes);

        // Update the report in the local list
        const index = this.reports.findIndex((r: Report) => r.id === reportId);
        if (index >= 0) {
          this.reports[index] = updatedReport;
        }

        // Update current report if viewing this one
        if (this.currentReport && this.currentReport.report.id === reportId) {
          this.currentReport.report = updatedReport;
        }
      }
      catch (error) {
        this.error = error instanceof Error ? error.message : 'Failed to dismiss report';
        throw error;
      }
    },

    /**
     * Updates the owner notes on a report.
     *
     * @param calendarId - The calendar UUID
     * @param reportId - The report UUID
     * @param notes - The owner notes text
     */
    async updateNotes(calendarId: string, reportId: string, notes: string) {
      this.error = null;

      try {
        const updatedReport = await moderationService.updateReportNotes(calendarId, reportId, notes);

        // Update the report in the local list
        const index = this.reports.findIndex((r: Report) => r.id === reportId);
        if (index >= 0) {
          this.reports[index] = updatedReport;
        }

        // Update current report if viewing this one
        if (this.currentReport && this.currentReport.report.id === reportId) {
          this.currentReport.report = updatedReport;
        }
      }
      catch (error) {
        this.error = error instanceof Error ? error.message : 'Failed to update notes';
        throw error;
      }
    },

    /**
     * Updates an editor's moderation permissions for a calendar.
     *
     * @param calendarId - The calendar UUID
     * @param editorId - The editor UUID
     * @param canReviewReports - Whether the editor can review reports
     */
    async updateEditorPermissions(calendarId: string, editorId: string, canReviewReports: boolean) {
      this.error = null;

      try {
        await moderationService.updateEditorPermissions(calendarId, editorId, canReviewReports);
      }
      catch (error) {
        this.error = error instanceof Error ? error.message : 'Failed to update permissions';
        throw error;
      }
    },

    /**
     * Updates the filter state and triggers a refetch of reports.
     * The calendarId must be provided to perform the refetch.
     *
     * @param filters - New filter values to apply
     * @param calendarId - The calendar UUID for refetching
     */
    async setFilters(filters: ReportFilters, calendarId?: string) {
      this.filters = { ...filters };

      if (calendarId) {
        await this.fetchReports(calendarId);
      }
    },

    /**
     * Changes the current page and triggers a refetch of reports.
     *
     * @param page - The page number to navigate to
     * @param calendarId - The calendar UUID for refetching
     */
    async setPage(page: number, calendarId?: string) {
      this.filters = {
        ...this.filters,
        page,
      };

      if (calendarId) {
        await this.fetchReports(calendarId);
      }
    },

    /**
     * Resets all moderation state to initial values.
     */
    reset() {
      this.reports = [];
      this.currentReport = null;
      this.pagination = {
        currentPage: 1,
        totalPages: 0,
        totalCount: 0,
        limit: 20,
      };
      this.filters = {};
      this.loading = false;
      this.loadingReport = false;
      this.error = null;
    },
  },
});
