import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Report } from '@/common/model/report';
import ModerationService from '../service/moderation';
import type { CreateReportData, CreateReportForEventData, CreateAdminReportData, ReportFilters, PaginatedReports, EscalationRecord, ModerationSettings } from '../service/moderation';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Moderation domain interface for cross-domain communication.
 *
 * Provides a clean facade over ModerationService for other domains
 * to interact with the moderation system without depending on
 * internal implementation details.
 */
export default class ModerationInterface {
  private moderationService: ModerationService;
  private calendarInterface: CalendarInterface;
  private accountsInterface: AccountsInterface;
  private emailInterface: EmailInterface;
  private configurationInterface: ConfigurationInterface;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    emailInterface: EmailInterface,
    configurationInterface: ConfigurationInterface,
  ) {
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
    this.emailInterface = emailInterface;
    this.configurationInterface = configurationInterface;
    this.moderationService = new ModerationService(eventBus, calendarInterface, configurationInterface);
  }

  /**
   * Returns the underlying ModerationService instance.
   * Used internally by the domain for scheduler initialization.
   *
   * @returns The ModerationService instance
   */
  getModerationService(): ModerationService {
    return this.moderationService;
  }

  /**
   * Creates a new report for an event, resolving the calendarId internally
   * by looking up the event via the calendar domain.
   *
   * @param data - Report creation data (without calendarId)
   * @returns The created Report domain model
   * @throws EventNotFoundError if the event does not exist
   */
  async createReportForEvent(data: CreateReportForEventData): Promise<Report> {
    return this.moderationService.createReportForEvent(data);
  }

  /**
   * Creates a new report against an event.
   *
   * @param data - Report creation data
   * @returns The created Report domain model
   */
  async createReport(data: CreateReportData): Promise<Report> {
    return this.moderationService.createReport(data);
  }

  /**
   * Creates an admin-initiated report for an event.
   * Admin reports skip verification and go directly to submitted status.
   *
   * @param data - Admin report creation data
   * @returns The created Report domain model
   * @throws ReportValidationError if input validation fails
   * @throws EventNotFoundError if the event does not exist
   * @throws DuplicateReportError if admin has already reported this event
   */
  async createAdminReport(data: CreateAdminReportData): Promise<Report> {
    return this.moderationService.createAdminReport(data);
  }

  /**
   * Retrieves a single report by its ID.
   *
   * @param id - Report UUID
   * @returns The Report or null if not found
   */
  async getReportById(id: string): Promise<Report | null> {
    return this.moderationService.getReportById(id);
  }

  /**
   * Retrieves paginated reports for a calendar with optional filters.
   *
   * @param calendarId - Calendar UUID
   * @param filters - Optional status, category, eventId, source, sorting, page, limit filters
   * @returns Paginated list of reports
   */
  async getReportsForCalendar(calendarId: string, filters: ReportFilters = {}): Promise<PaginatedReports> {
    return this.moderationService.getReportsForCalendar(calendarId, filters);
  }

  /**
   * Retrieves all reports for a specific event.
   *
   * @param eventId - Event UUID
   * @returns Array of reports for the event
   */
  async getReportsForEvent(eventId: string): Promise<Report[]> {
    return this.moderationService.getReportsForEvent(eventId);
  }

  /**
   * Retrieves paginated escalated reports for admin review.
   *
   * @param filters - Optional category, page, limit filters
   * @returns Paginated list of escalated reports
   */
  async getEscalatedReports(filters: ReportFilters = {}): Promise<PaginatedReports> {
    return this.moderationService.getEscalatedReports(filters);
  }

  /**
   * Retrieves paginated admin-relevant reports with optional filters.
   * Returns reports that are either escalated OR admin-initiated.
   *
   * @param filters - Optional status, category, calendarId, source, escalationType, sorting, page, limit filters
   * @returns Paginated list of admin-relevant reports
   */
  async getAdminReports(filters: ReportFilters = {}): Promise<PaginatedReports> {
    return this.moderationService.getAdminReports(filters);
  }

  /**
   * Retrieves a single report by ID for admin review.
   * No calendar scoping - admins can view any report.
   *
   * @param reportId - Report UUID
   * @returns The Report
   * @throws ReportNotFoundError if report not found
   */
  async getAdminReport(reportId: string): Promise<Report> {
    return this.moderationService.getAdminReport(reportId);
  }

  /**
   * Retrieves the escalation history for a report.
   *
   * @param reportId - Report UUID
   * @returns Array of escalation records ordered by creation date
   */
  async getEscalationHistory(reportId: string): Promise<EscalationRecord[]> {
    return this.moderationService.getEscalationHistory(reportId);
  }

  /**
   * Updates the owner notes on a report.
   *
   * @param reportId - Report UUID
   * @param ownerNotes - Notes from the calendar owner
   * @returns The updated Report
   * @throws ReportNotFoundError if report not found
   */
  async updateReportNotes(reportId: string, ownerNotes: string): Promise<Report> {
    return this.moderationService.updateReportNotes(reportId, ownerNotes);
  }

  /**
   * Verifies a report using its verification token.
   *
   * @param token - Verification token string
   * @returns The verified Report
   */
  async verifyReport(token: string): Promise<Report> {
    return this.moderationService.verifyReport(token);
  }

  /**
   * Resolves a report, recording the reviewer and notes.
   *
   * @param reportId - Report UUID
   * @param reviewerId - Account UUID of the reviewer
   * @param notes - Resolution notes
   * @returns The resolved Report
   */
  async resolveReport(reportId: string, reviewerId: string, notes: string): Promise<Report> {
    return this.moderationService.resolveReport(reportId, reviewerId, notes);
  }

  /**
   * Dismisses a report. Dismissals by calendar owners auto-escalate to admin.
   *
   * @param reportId - Report UUID
   * @param reviewerId - Account UUID of the calendar owner who dismissed
   * @param notes - Dismissal notes
   * @returns The escalated Report
   */
  async dismissReport(reportId: string, reviewerId: string, notes: string): Promise<Report> {
    return this.moderationService.dismissReport(reportId, reviewerId, notes);
  }

  /**
   * Manually escalates a report to admin review.
   *
   * @param reportId - Report UUID
   * @param reason - Reason for manual escalation
   * @returns The escalated Report
   */
  async escalateReport(reportId: string, reason: string): Promise<Report> {
    return this.moderationService.escalateReport(reportId, reason);
  }

  /**
   * Resolves a report as an admin with reviewer_role 'admin'.
   *
   * @param reportId - Report UUID
   * @param adminId - Admin account UUID
   * @param notes - Resolution notes
   * @returns The resolved Report
   * @throws ReportNotFoundError if report not found
   * @throws ReportAlreadyResolvedError if report is already resolved or dismissed
   */
  async adminResolveReport(reportId: string, adminId: string, notes: string): Promise<Report> {
    return this.moderationService.adminResolveReport(reportId, adminId, notes);
  }

  /**
   * Dismisses a report as an admin. This is a final decision -
   * no further escalation is possible.
   *
   * @param reportId - Report UUID
   * @param adminId - Admin account UUID
   * @param notes - Dismissal notes
   * @returns The dismissed Report
   * @throws ReportNotFoundError if report not found
   * @throws ReportAlreadyResolvedError if report is already resolved or dismissed
   */
  async adminDismissReport(reportId: string, adminId: string, notes: string): Promise<Report> {
    return this.moderationService.adminDismissReport(reportId, adminId, notes);
  }

  /**
   * Overrides the current status of a report as an admin,
   * changing status regardless of current state.
   *
   * @param reportId - Report UUID
   * @param adminId - Admin account UUID
   * @param notes - Override notes
   * @returns The overridden Report
   * @throws ReportNotFoundError if report not found
   */
  async adminOverrideReport(reportId: string, adminId: string, notes: string): Promise<Report> {
    return this.moderationService.adminOverrideReport(reportId, adminId, notes);
  }

  /**
   * Checks whether a reporter has already reported a specific event.
   *
   * @param eventId - Event UUID
   * @param reporterIdentifier - Email hash or account ID
   * @returns True if a report already exists for this reporter and event
   */
  async hasReporterAlreadyReported(eventId: string, reporterIdentifier: string): Promise<boolean> {
    return this.moderationService.hasReporterAlreadyReported(eventId, reporterIdentifier);
  }

  /**
   * Checks if a user has permission to review reports for a calendar.
   *
   * @param account - The authenticated account
   * @param calendarId - Calendar UUID
   * @returns True if the user can review reports
   */
  async userCanReviewReports(account: Account, calendarId: string): Promise<boolean> {
    return this.moderationService.userCanReviewReports(account, calendarId);
  }

  /**
   * Retrieves a report by ID, verifying it belongs to the specified calendar.
   *
   * @param reportId - Report UUID
   * @param calendarId - Calendar UUID the report must belong to
   * @returns The Report
   * @throws ReportNotFoundError if report not found or belongs to a different calendar
   */
  async getReportForCalendar(reportId: string, calendarId: string): Promise<Report> {
    return this.moderationService.getReportForCalendar(reportId, calendarId);
  }

  /**
   * Retrieves current moderation settings.
   *
   * @returns Current moderation settings with defaults applied
   */
  async getModerationSettings(): Promise<ModerationSettings> {
    return this.moderationService.getModerationSettings();
  }

  /**
   * Updates moderation settings. Supports partial updates.
   *
   * @param updates - Partial settings to update
   * @returns Updated moderation settings
   */
  async updateModerationSettings(updates: Partial<ModerationSettings>): Promise<ModerationSettings> {
    return this.moderationService.updateModerationSettings(updates);
  }
}

export type { CreateReportData, CreateReportForEventData, CreateAdminReportData, ReportFilters, PaginatedReports, EscalationRecord, ModerationSettings };
