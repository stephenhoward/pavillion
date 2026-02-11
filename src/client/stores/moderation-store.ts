import { defineStore } from 'pinia';

import { Report } from '@/common/model/report';
import { BlockedInstance } from '@/common/model/blocked_instance';
import ModerationService from '@/client/service/moderation';
import type {
  ReportFilters,
  ReportPagination,
  EscalationRecord,
  AdminReportFilters,
  CreateAdminReportData,
  ModerationSettings,
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
  // Owner-level state
  reports: Report[];
  currentReport: ReportDetail | null;
  pagination: ReportPagination;
  filters: ReportFilters;
  loading: boolean;
  loadingReport: boolean;
  error: string | null;

  // Admin-level state
  adminReports: Report[];
  currentAdminReport: ReportDetail | null;
  adminPagination: ReportPagination;
  adminFilters: AdminReportFilters;
  adminLoading: boolean;
  loadingAdminReport: boolean;
  moderationSettings: ModerationSettings | null;
  loadingSettings: boolean;
  adminError: string | null;

  // Blocked instances state
  blockedInstances: BlockedInstance[];
  loadingBlockedInstances: boolean;
  blockingError: string | null;
}

/** Shared service instance for all store actions. */
const moderationService = new ModerationService();

/**
 * Pinia store for managing moderation report state.
 *
 * Provides actions for listing, viewing, and acting on reports
 * filed against events in a calendar. Delegates all API
 * communication to ModerationService. Also provides admin-level
 * actions for instance-wide report management and moderation settings.
 */
export const useModerationStore = defineStore('moderation', {
  state: (): ModerationState => {
    return {
      // Owner-level state
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

      // Admin-level state
      adminReports: [],
      currentAdminReport: null,
      adminPagination: {
        currentPage: 1,
        totalPages: 0,
        totalCount: 0,
        limit: 20,
      },
      adminFilters: {},
      adminLoading: false,
      loadingAdminReport: false,
      moderationSettings: null,
      loadingSettings: false,
      adminError: null,

      // Blocked instances state
      blockedInstances: [],
      loadingBlockedInstances: false,
      blockingError: null,
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

    /**
     * Whether the admin reports array contains any reports.
     */
    hasAdminReports: (state) => state.adminReports.length > 0,

    /**
     * Count of active admin filter values.
     */
    activeAdminFilters: (state) => {
      let count = 0;
      if (state.adminFilters.status) count++;
      if (state.adminFilters.category) count++;
      if (state.adminFilters.calendarId) count++;
      if (state.adminFilters.source) count++;
      if (state.adminFilters.escalationType) count++;
      if (state.adminFilters.sortBy) count++;
      if (state.adminFilters.sortOrder) count++;
      return count;
    },

    /**
     * Whether the blocked instances array contains any instances.
     */
    hasBlockedInstances: (state) => state.blockedInstances.length > 0,
  },

  actions: {
    // ──────────────────────────────────────────────────────────────
    // Owner-level actions
    // ──────────────────────────────────────────────────────────────

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

    // ──────────────────────────────────────────────────────────────
    // Admin-level actions
    // ──────────────────────────────────────────────────────────────

    /**
     * Fetches a paginated list of admin-relevant reports.
     * Merges the current admin filters with any additional filters provided.
     *
     * @param filters - Optional additional filter overrides
     */
    async fetchAdminReports(filters?: AdminReportFilters) {
      this.adminLoading = true;
      this.adminError = null;

      try {
        const mergedFilters: AdminReportFilters = {
          ...this.adminFilters,
          ...filters,
        };

        const result = await moderationService.getAdminReports(mergedFilters);
        this.adminReports = result.reports;
        this.adminPagination = result.pagination;
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to load admin reports';
        throw error;
      }
      finally {
        this.adminLoading = false;
      }
    },

    /**
     * Fetches a single admin report with its escalation history.
     *
     * @param reportId - The report UUID
     */
    async fetchAdminReport(reportId: string) {
      this.loadingAdminReport = true;
      this.adminError = null;

      try {
        const result = await moderationService.getAdminReport(reportId);
        this.currentAdminReport = {
          report: result.report,
          escalationHistory: result.escalationHistory,
        };
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to load admin report';
        throw error;
      }
      finally {
        this.loadingAdminReport = false;
      }
    },

    /**
     * Resolves a report as admin and updates local state.
     *
     * @param reportId - The report UUID
     * @param notes - Resolution notes
     */
    async adminResolveReport(reportId: string, notes: string) {
      this.adminError = null;

      try {
        const updatedReport = await moderationService.adminResolveReport(reportId, notes);

        const index = this.adminReports.findIndex((r: Report) => r.id === reportId);
        if (index >= 0) {
          this.adminReports[index] = updatedReport;
        }

        if (this.currentAdminReport && this.currentAdminReport.report.id === reportId) {
          this.currentAdminReport.report = updatedReport;
        }
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to resolve report';
        throw error;
      }
    },

    /**
     * Dismisses a report as admin and updates local state.
     *
     * @param reportId - The report UUID
     * @param notes - Dismissal notes
     */
    async adminDismissReport(reportId: string, notes: string) {
      this.adminError = null;

      try {
        const updatedReport = await moderationService.adminDismissReport(reportId, notes);

        const index = this.adminReports.findIndex((r: Report) => r.id === reportId);
        if (index >= 0) {
          this.adminReports[index] = updatedReport;
        }

        if (this.currentAdminReport && this.currentAdminReport.report.id === reportId) {
          this.currentAdminReport.report = updatedReport;
        }
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to dismiss report';
        throw error;
      }
    },

    /**
     * Overrides a calendar owner's decision on a report.
     *
     * @param reportId - The report UUID
     * @param notes - Override notes
     */
    async adminOverrideReport(reportId: string, notes: string) {
      this.adminError = null;

      try {
        const updatedReport = await moderationService.adminOverrideReport(reportId, notes);

        const index = this.adminReports.findIndex((r: Report) => r.id === reportId);
        if (index >= 0) {
          this.adminReports[index] = updatedReport;
        }

        if (this.currentAdminReport && this.currentAdminReport.report.id === reportId) {
          this.currentAdminReport.report = updatedReport;
        }
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to override report';
        throw error;
      }
    },

    /**
     * Creates an admin-initiated report for an event.
     *
     * @param data - The report creation data
     * @returns The newly created report
     */
    async createAdminReport(data: CreateAdminReportData) {
      this.adminError = null;

      try {
        const report = await moderationService.createAdminReport(data);
        return report;
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to create report';
        throw error;
      }
    },

    /**
     * Forwards a report to the remote admin of the federated instance
     * that owns the event.
     *
     * @param reportId - The report UUID to forward
     */
    async adminForwardToRemoteAdmin(reportId: string) {
      this.adminError = null;

      try {
        await moderationService.adminForwardToRemoteAdmin(reportId);
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to forward report';
        throw error;
      }
    },

    /**
     * Fetches instance-wide moderation settings.
     */
    async fetchModerationSettings() {
      this.loadingSettings = true;
      this.adminError = null;

      try {
        const settings = await moderationService.getModerationSettings();
        this.moderationSettings = settings;
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to load settings';
        throw error;
      }
      finally {
        this.loadingSettings = false;
      }
    },

    /**
     * Saves updated moderation settings. Supports partial updates.
     *
     * @param settings - Partial settings to update
     */
    async saveModerationSettings(settings: Partial<ModerationSettings>) {
      this.adminError = null;

      try {
        const updatedSettings = await moderationService.updateModerationSettings(settings);
        this.moderationSettings = updatedSettings;
      }
      catch (error) {
        this.adminError = error instanceof Error ? error.message : 'Failed to save settings';
        throw error;
      }
    },

    /**
     * Fetches the list of blocked instances.
     */
    async fetchBlockedInstances() {
      this.loadingBlockedInstances = true;
      this.blockingError = null;

      try {
        this.blockedInstances = await moderationService.listBlockedInstances();
      }
      catch (error) {
        this.blockingError = error instanceof Error ? error.message : 'Failed to load blocked instances';
        throw error;
      }
      finally {
        this.loadingBlockedInstances = false;
      }
    },

    /**
     * Blocks a federated instance.
     *
     * @param domain - The domain to block
     * @param reason - Reason for blocking
     */
    async blockInstance(domain: string, reason: string) {
      this.blockingError = null;

      try {
        const blockedInstance = await moderationService.blockInstance(domain, reason);
        this.blockedInstances.push(blockedInstance);
      }
      catch (error) {
        this.blockingError = error instanceof Error ? error.message : 'Failed to block instance';
        throw error;
      }
    },

    /**
     * Unblocks a federated instance.
     *
     * @param domain - The domain to unblock
     */
    async unblockInstance(domain: string) {
      this.blockingError = null;

      try {
        await moderationService.unblockInstance(domain);
        this.blockedInstances = this.blockedInstances.filter((instance) => instance.domain !== domain);
      }
      catch (error) {
        this.blockingError = error instanceof Error ? error.message : 'Failed to unblock instance';
        throw error;
      }
    },

    /**
     * Updates admin filter state.
     *
     * @param filters - New admin filter values to apply
     */
    setAdminFilters(filters: AdminReportFilters) {
      this.adminFilters = { ...filters };
    },

    /**
     * Changes the admin report page number.
     *
     * @param page - The page number to navigate to
     */
    setAdminPage(page: number) {
      this.adminFilters = {
        ...this.adminFilters,
        page,
      };
    },

    /**
     * Resets all admin-level state to initial values.
     */
    resetAdmin() {
      this.adminReports = [];
      this.currentAdminReport = null;
      this.adminPagination = {
        currentPage: 1,
        totalPages: 0,
        totalCount: 0,
        limit: 20,
      };
      this.adminFilters = {};
      this.adminLoading = false;
      this.loadingAdminReport = false;
      this.moderationSettings = null;
      this.loadingSettings = false;
      this.adminError = null;
    },
  },
});
