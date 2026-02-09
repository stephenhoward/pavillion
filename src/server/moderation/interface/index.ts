import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Report } from '@/common/model/report';
import ModerationService from '../service/moderation';
import type { CreateReportData, CreateReportForEventData, ReportFilters, PaginatedReports, EscalationRecord } from '../service/moderation';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';

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

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    emailInterface: EmailInterface,
  ) {
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
    this.emailInterface = emailInterface;
    this.moderationService = new ModerationService(eventBus, calendarInterface);
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
}

export type { CreateReportData, CreateReportForEventData, ReportFilters, PaginatedReports, EscalationRecord };
