import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Report } from '@/common/model/report';
import { BlockedInstance } from '@/common/model/blocked_instance';
import { CalendarEvent } from '@/common/model/events';
import ModerationService from '../service/moderation';
import type { CreateReportData, CreateReportForEventData, CreateAdminReportData, ReportFilters, PaginatedReports, EscalationRecord, ModerationSettings, ReceiveRemoteReportData } from '../service/moderation';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import ActivityPubInterface from '@/server/activitypub/interface';

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
  private activityPubInterface: ActivityPubInterface;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    emailInterface: EmailInterface,
    configurationInterface: ConfigurationInterface,
    activityPubInterface: ActivityPubInterface,
  ) {
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
    this.emailInterface = emailInterface;
    this.configurationInterface = configurationInterface;
    this.activityPubInterface = activityPubInterface;
    this.moderationService = new ModerationService(eventBus, calendarInterface, configurationInterface, activityPubInterface);
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
   * Receives a remote report forwarded from another federated instance.
   * Creates a Report with reporterType='federation'.
   *
   * @param data - Remote report data
   * @returns The created Report domain model
   * @throws EventNotFoundError if the event does not exist
   */
  async receiveRemoteReport(data: ReceiveRemoteReportData): Promise<Report> {
    return this.moderationService.receiveRemoteReport(data);
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
   * Unlike getReportForCalendar, this has no calendar scoping.
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
   * Updates owner notes on a report.
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
   * @throws InvalidVerificationTokenError if token is invalid, expired, or already used
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
   * @throws ReportNotFoundError if report not found
   * @throws ReportAlreadyResolvedError if report is already resolved or dismissed
   */
  async resolveReport(reportId: string, reviewerId: string, notes: string): Promise<Report> {
    return this.moderationService.resolveReport(reportId, reviewerId, notes);
  }

  /**
   * Dismisses a report. Auto-escalates to admin.
   *
   * @param reportId - Report UUID
   * @param reviewerId - Account UUID of the calendar owner who dismissed
   * @param notes - Dismissal notes
   * @returns The escalated Report
   * @throws ReportNotFoundError if report not found
   * @throws ReportAlreadyResolvedError if report is already resolved or dismissed
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
   * @throws ReportNotFoundError if report not found
   * @throws ReportAlreadyResolvedError if report is already resolved or dismissed
   */
  async escalateReport(reportId: string, reason: string): Promise<Report> {
    return this.moderationService.escalateReport(reportId, reason);
  }

  /**
   * Resolves a report as an admin, recording the admin as reviewer.
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
   * Dismisses a report as an admin. This is a final decision,
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

  /**
   * Blocks an instance from federating with this instance.
   *
   * @param domain - Domain name to block
   * @param reason - Reason for blocking the instance
   * @param adminAccountId - Admin account UUID performing the block
   * @returns The created BlockedInstance
   * @throws InstanceAlreadyBlockedError if domain is already blocked
   */
  async blockInstance(domain: string, reason: string, adminAccountId: string): Promise<BlockedInstance> {
    return this.moderationService.blockInstance(domain, reason, adminAccountId);
  }

  /**
   * Unblocks an instance, allowing it to federate again.
   * Silent if the domain was not blocked (idempotent operation).
   *
   * @param domain - Domain name to unblock
   */
  async unblockInstance(domain: string): Promise<void> {
    return this.moderationService.unblockInstance(domain);
  }

  /**
   * Lists all blocked instances, sorted by blocked_at DESC.
   *
   * @returns Array of BlockedInstance domain models
   */
  async listBlockedInstances(): Promise<BlockedInstance[]> {
    return this.moderationService.listBlockedInstances();
  }

  /**
   * Checks if an instance is blocked.
   *
   * @param domain - Domain name to check
   * @returns True if the domain is blocked
   */
  async isInstanceBlocked(domain: string): Promise<boolean> {
    return this.moderationService.isInstanceBlocked(domain);
  }

  /**
   * Forwards a report to a remote calendar owner via ActivityPub.
   *
   * @param reportId - Report UUID to forward
   * @param targetActorUri - Actor URI of the remote calendar owner
   * @throws ReportNotFoundError if report not found
   */
  async forwardReport(reportId: string, targetActorUri: string): Promise<void> {
    return this.moderationService.forwardReport(reportId, targetActorUri);
  }

  /**
   * Retrieves an event by its ID via the calendar domain.
   * Used for verifying event properties (e.g., whether it's remote) during report forwarding.
   *
   * @param eventId - Event UUID
   * @returns The CalendarEvent
   * @throws EventNotFoundError if event not found
   */
  async getEventById(eventId: string): Promise<CalendarEvent> {
    return this.calendarInterface.getEventById(eventId);
  }
}

export type { CreateReportData, CreateReportForEventData, CreateAdminReportData, ReportFilters, PaginatedReports, EscalationRecord, ModerationSettings, ReceiveRemoteReportData };
