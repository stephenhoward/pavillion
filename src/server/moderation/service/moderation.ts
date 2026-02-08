import { randomBytes, createHash } from 'crypto';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import type { ReporterType, EscalationType } from '@/common/model/report';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import {
  DuplicateReportError,
  InvalidVerificationTokenError,
  ReportNotFoundError,
  ReportAlreadyResolvedError,
} from '@/server/moderation/exceptions';

/** Token expiration duration in hours. */
const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;

/** Default page size for paginated queries. */
const DEFAULT_PAGE_LIMIT = 20;

/**
 * Input data for creating a new report.
 */
interface CreateReportData {
  eventId: string;
  calendarId: string;
  category: ReportCategory;
  description: string;
  reporterEmail?: string;
  reporterAccountId?: string;
  reporterType: ReporterType;
  adminId?: string;
  adminPriority?: 'low' | 'medium' | 'high';
  adminDeadline?: Date;
  adminNotes?: string;
}

/**
 * Filter options for listing reports.
 */
interface ReportFilters {
  status?: ReportStatus;
  category?: ReportCategory;
  page?: number;
  limit?: number;
}

/**
 * Paginated result shape returned by list methods.
 */
interface PaginatedReports {
  reports: Report[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    limit: number;
  };
}

/**
 * Service for managing the report lifecycle including creation,
 * duplicate detection, verification, status transitions, and escalation.
 */
class ModerationService {
  private eventBus?: EventEmitter;

  constructor(eventBus?: EventEmitter) {
    this.eventBus = eventBus;
  }

  /**
   * Creates a new report against an event.
   * For anonymous reporters the email is hashed and a verification token is generated.
   * For authenticated and administrator reporters the status starts as submitted.
   * Checks for duplicate reports before creation.
   *
   * @param data - Report creation data
   * @returns The created Report domain model
   * @throws DuplicateReportError if the reporter has already reported this event
   */
  async createReport(data: CreateReportData): Promise<Report> {
    const report = new Report();
    report.eventId = data.eventId;
    report.calendarId = data.calendarId;
    report.category = data.category;
    report.description = data.description;
    report.reporterType = data.reporterType;

    let reporterIdentifier: string;

    if (data.reporterType === 'anonymous') {
      if (!data.reporterEmail) {
        throw new Error('Reporter email is required for anonymous reports');
      }
      const emailHash = this.hashEmail(data.reporterEmail);
      report.reporterEmailHash = emailHash;
      reporterIdentifier = emailHash;

      // Anonymous reporters start in pending_verification
      report.status = ReportStatus.PENDING_VERIFICATION;

      // Generate verification token
      const token = this.generateVerificationToken();
      report.verificationToken = token;
      report.verificationExpiration = this.createTokenExpiration();
    }
    else if (data.reporterType === 'authenticated') {
      report.reporterAccountId = data.reporterAccountId ?? null;
      reporterIdentifier = data.reporterAccountId ?? '';
      report.status = ReportStatus.SUBMITTED;
    }
    else {
      // administrator
      report.reporterAccountId = data.reporterAccountId ?? null;
      report.adminId = data.adminId ?? null;
      report.adminPriority = data.adminPriority ?? null;
      report.adminDeadline = data.adminDeadline ?? null;
      report.adminNotes = data.adminNotes ?? null;
      reporterIdentifier = data.reporterAccountId ?? data.adminId ?? '';
      report.status = ReportStatus.SUBMITTED;
    }

    // Check for duplicate reports
    const alreadyReported = await this.hasReporterAlreadyReported(data.eventId, reporterIdentifier);
    if (alreadyReported) {
      throw new DuplicateReportError();
    }

    // Persist the report
    const entity = ReportEntity.fromModel(report);
    const saved = await entity.save();
    const createdReport = saved.toModel();

    // Create EventReporter record for duplicate tracking
    const reporterRecord = EventReporterEntity.fromModel({
      eventId: data.eventId,
      reporterIdentifier,
      reportId: createdReport.id,
    });
    await reporterRecord.save();

    // Emit domain event
    this.emit('reportCreated', { report: createdReport });

    return createdReport;
  }

  /**
   * Retrieves a single report by its ID.
   *
   * @param id - Report UUID
   * @returns The Report or null if not found
   */
  async getReportById(id: string): Promise<Report | null> {
    const entity = await ReportEntity.findByPk(id);
    return entity ? entity.toModel() : null;
  }

  /**
   * Retrieves paginated reports for a calendar with optional filters.
   *
   * @param calendarId - Calendar UUID
   * @param filters - Optional status, category, page, limit filters
   * @returns Paginated list of reports
   */
  async getReportsForCalendar(calendarId: string, filters: ReportFilters = {}): Promise<PaginatedReports> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = (page - 1) * limit;

    const where: Record<string, any> = { calendar_id: calendarId };
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.category) {
      where.category = filters.category;
    }

    const { rows, count } = await ReportEntity.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
    });

    return {
      reports: rows.map((entity) => entity.toModel()),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalCount: count,
        limit,
      },
    };
  }

  /**
   * Retrieves all reports for a specific event.
   *
   * @param eventId - Event UUID
   * @returns Array of reports for the event
   */
  async getReportsForEvent(eventId: string): Promise<Report[]> {
    const entities = await ReportEntity.findAll({
      where: { event_id: eventId },
      order: [['created_at', 'DESC']],
    });
    return entities.map((entity) => entity.toModel());
  }

  /**
   * Retrieves paginated escalated reports for admin review.
   *
   * @param filters - Optional category, page, limit filters
   * @returns Paginated list of escalated reports
   */
  async getEscalatedReports(filters: ReportFilters = {}): Promise<PaginatedReports> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = (page - 1) * limit;

    const where: Record<string, any> = { status: ReportStatus.ESCALATED };
    if (filters.category) {
      where.category = filters.category;
    }

    const { rows, count } = await ReportEntity.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
    });

    return {
      reports: rows.map((entity) => entity.toModel()),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalCount: count,
        limit,
      },
    };
  }

  /**
   * Verifies a report using its verification token.
   * Transitions from pending_verification to submitted.
   *
   * @param token - Verification token string
   * @returns The verified Report
   * @throws InvalidVerificationTokenError if token is invalid or expired
   */
  async verifyReport(token: string): Promise<Report> {
    const entity = await ReportEntity.findOne({
      where: { verification_token: token },
    });

    if (!entity) {
      throw new InvalidVerificationTokenError();
    }

    // Check token expiration
    if (entity.verification_expiration && new Date() > entity.verification_expiration) {
      throw new InvalidVerificationTokenError();
    }

    // Update status and clear verification fields
    await entity.update({
      status: ReportStatus.SUBMITTED,
      verification_token: null,
      verification_expiration: null,
    });

    const report = entity.toModel();

    this.emit('reportVerified', { report });

    return report;
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
    const entity = await ReportEntity.findByPk(reportId);
    if (!entity) {
      throw new ReportNotFoundError();
    }

    const currentStatus = entity.status as ReportStatus;
    if (currentStatus === ReportStatus.RESOLVED || currentStatus === ReportStatus.DISMISSED) {
      throw new ReportAlreadyResolvedError();
    }

    // Update report status
    await entity.update({
      status: ReportStatus.RESOLVED,
      reviewer_id: reviewerId,
      reviewer_notes: notes,
      reviewer_timestamp: new Date(),
    });

    // Create escalation record (audit trail)
    const escalationRecord = ReportEscalationEntity.fromModel({
      reportId,
      fromStatus: currentStatus,
      toStatus: ReportStatus.RESOLVED,
      reviewerId,
      reviewerRole: 'owner',
      decision: 'resolved',
      notes,
    });
    await escalationRecord.save();

    const report = entity.toModel();

    this.emit('reportResolved', { report, reviewerId });

    return report;
  }

  /**
   * Dismisses a report. Because dismissals by calendar owners auto-escalate to admin,
   * this transitions the report to escalated status with escalation_type: automatic.
   *
   * @param reportId - Report UUID
   * @param reviewerId - Account UUID of the calendar owner who dismissed
   * @param notes - Dismissal notes
   * @returns The escalated Report
   * @throws ReportNotFoundError if report not found
   * @throws ReportAlreadyResolvedError if report is already resolved or dismissed
   */
  async dismissReport(reportId: string, reviewerId: string, notes: string): Promise<Report> {
    const entity = await ReportEntity.findByPk(reportId);
    if (!entity) {
      throw new ReportNotFoundError();
    }

    const currentStatus = entity.status as ReportStatus;
    if (currentStatus === ReportStatus.RESOLVED || currentStatus === ReportStatus.DISMISSED) {
      throw new ReportAlreadyResolvedError();
    }

    // Auto-escalate: dismissals become escalations to admin
    await entity.update({
      status: ReportStatus.ESCALATED,
      escalation_type: 'automatic' as EscalationType,
      reviewer_id: reviewerId,
      reviewer_notes: notes,
      reviewer_timestamp: new Date(),
    });

    // Create escalation record
    const escalationRecord = ReportEscalationEntity.fromModel({
      reportId,
      fromStatus: currentStatus,
      toStatus: ReportStatus.ESCALATED,
      reviewerId,
      reviewerRole: 'owner',
      decision: 'dismissed',
      notes,
    });
    await escalationRecord.save();

    const report = entity.toModel();

    this.emit('reportEscalated', { report, reason: notes });

    return report;
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
    const entity = await ReportEntity.findByPk(reportId);
    if (!entity) {
      throw new ReportNotFoundError();
    }

    const currentStatus = entity.status as ReportStatus;
    if (currentStatus === ReportStatus.RESOLVED || currentStatus === ReportStatus.DISMISSED) {
      throw new ReportAlreadyResolvedError();
    }

    await entity.update({
      status: ReportStatus.ESCALATED,
      escalation_type: 'manual' as EscalationType,
    });

    // Create escalation record
    const escalationRecord = ReportEscalationEntity.fromModel({
      reportId,
      fromStatus: currentStatus,
      toStatus: ReportStatus.ESCALATED,
      reviewerRole: 'system',
      decision: 'escalated',
      notes: reason,
    });
    await escalationRecord.save();

    const report = entity.toModel();

    this.emit('reportEscalated', { report, reason });

    return report;
  }

  /**
   * Checks whether a reporter has already reported a specific event.
   *
   * @param eventId - Event UUID
   * @param reporterIdentifier - Email hash or account ID
   * @returns True if a report already exists for this reporter and event
   */
  async hasReporterAlreadyReported(eventId: string, reporterIdentifier: string): Promise<boolean> {
    const existing = await EventReporterEntity.findOne({
      where: {
        event_id: eventId,
        reporter_identifier: reporterIdentifier,
      },
    });
    return existing !== null;
  }

  /**
   * Hashes an email address using SHA-256 for anonymous reporter tracking.
   *
   * @param email - Email address to hash
   * @returns Hex-encoded SHA-256 hash of the lowercase email
   */
  private hashEmail(email: string): string {
    return createHash('sha256')
      .update(email.toLowerCase().trim())
      .digest('hex');
  }

  /**
   * Generates a cryptographically random verification token.
   *
   * @returns Hex-encoded random token
   */
  private generateVerificationToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Creates a token expiration date set to VERIFICATION_TOKEN_EXPIRY_HOURS from now.
   *
   * @returns Date object representing the expiration time
   */
  private createTokenExpiration(): Date {
    const expiration = new Date();
    expiration.setHours(expiration.getHours() + VERIFICATION_TOKEN_EXPIRY_HOURS);
    return expiration;
  }

  /**
   * Emits a domain event on the event bus if available.
   *
   * @param event - Event name
   * @param payload - Event payload
   */
  private emit(event: string, payload: Record<string, any>): void {
    if (this.eventBus) {
      this.eventBus.emit(event, payload);
    }
  }
}

export default ModerationService;
export type { CreateReportData, ReportFilters, PaginatedReports };
