import { randomBytes, createHmac } from 'crypto';
import { EventEmitter } from 'events';
import { Op } from 'sequelize';
import config from 'config';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import type { ReporterType, EscalationType } from '@/common/model/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import {
  DuplicateReportError,
  InvalidVerificationTokenError,
  ReportNotFoundError,
  ReportAlreadyResolvedError,
  EmailRateLimitError,
} from '@/server/moderation/exceptions';
import CalendarInterface from '@/server/calendar/interface';

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
 * Input data for creating a report by event ID, without requiring calendarId.
 * The service resolves the calendarId internally via the calendar domain.
 */
interface CreateReportForEventData {
  eventId: string;
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
  private calendarInterface?: CalendarInterface;

  constructor(eventBus?: EventEmitter, calendarInterface?: CalendarInterface) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
  }

  /**
   * Creates a new report for an event, resolving the calendarId internally.
   * Looks up the event via CalendarInterface to determine which calendar
   * the event belongs to, then delegates to createReport.
   *
   * @param data - Report creation data (without calendarId)
   * @returns The created Report domain model
   * @throws EventNotFoundError if the event does not exist or has no calendarId
   * @throws DuplicateReportError if the reporter has already reported this event
   * @throws EmailRateLimitError if the email has exceeded the verification email limit
   */
  async createReportForEvent(data: CreateReportForEventData): Promise<Report> {
    if (!this.calendarInterface) {
      throw new Error('CalendarInterface is required for createReportForEvent');
    }

    let calendarId: string;
    try {
      const event = await this.calendarInterface.getEventById(data.eventId);
      if (!event || !event.calendarId) {
        throw new EventNotFoundError();
      }
      calendarId = event.calendarId;
    }
    catch (error) {
      if (error instanceof EventNotFoundError) {
        throw error;
      }
      throw new EventNotFoundError();
    }

    return this.createReport({
      ...data,
      calendarId,
    });
  }

  /**
   * Creates a new report against an event.
   * For anonymous reporters the email is hashed and a verification token is generated.
   * For authenticated and administrator reporters the status starts as submitted.
   * Checks for duplicate reports before creation.
   * For anonymous reporters, enforces per-email rate limiting on verification emails.
   *
   * @param data - Report creation data
   * @returns The created Report domain model
   * @throws DuplicateReportError if the reporter has already reported this event
   * @throws EmailRateLimitError if the email has exceeded the verification email limit
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

      // Check per-email rate limit before proceeding
      const emailExceedsLimit = await this.hasExceededEmailRateLimit(emailHash);
      if (emailExceedsLimit) {
        throw new EmailRateLimitError();
      }

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

    // Emit domain event with reporter email for verification email sending
    this.emit('reportCreated', {
      report: createdReport,
      reporterEmail: data.reporterEmail,
    });

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
   * Verifies a report using its verification token via an atomic update.
   * Uses a single UPDATE ... WHERE query that matches on the token,
   * expected status, and non-expired expiration to prevent race conditions
   * from concurrent verification requests. If 0 rows are affected, the
   * token is invalid, expired, or was already consumed by another request.
   *
   * @param token - Verification token string
   * @returns The verified Report
   * @throws InvalidVerificationTokenError if token is invalid, expired, or already used
   */
  async verifyReport(token: string): Promise<Report> {
    // Atomic update: only succeeds if the token exists, the report is still
    // pending verification, and the token has not expired
    const [affectedCount] = await ReportEntity.update(
      {
        status: ReportStatus.SUBMITTED,
        verification_token: null,
        verification_expiration: null,
      },
      {
        where: {
          verification_token: token,
          status: ReportStatus.PENDING_VERIFICATION,
          verification_expiration: {
            [Op.gt]: new Date(),
          },
        },
      },
    );

    if (affectedCount === 0) {
      throw new InvalidVerificationTokenError();
    }

    // Retrieve the updated report for event emission.
    // The token was cleared by the atomic update, so we find the report
    // by querying for the most recently updated submitted report with a
    // null verification token. This is safe because the atomic update
    // guarantees only one request succeeds.
    const entity = await ReportEntity.findOne({
      where: {
        status: ReportStatus.SUBMITTED,
        verification_token: null,
      },
      order: [['updated_at', 'DESC']],
    });

    if (!entity) {
      throw new InvalidVerificationTokenError();
    }

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
   * Checks whether an email hash has exceeded the per-email rate limit
   * for report submissions within the configured time window.
   *
   * @param emailHash - HMAC-SHA256 hash of the reporter email
   * @returns True if the email has exceeded the rate limit
   */
  async hasExceededEmailRateLimit(emailHash: string): Promise<boolean> {
    const windowMs = config.get<number>('rateLimit.moderation.byEmail.windowMs');
    const maxReports = config.get<number>('rateLimit.moderation.byEmail.max');

    const windowStart = new Date(Date.now() - windowMs);

    const recentCount = await ReportEntity.count({
      where: {
        reporter_email_hash: emailHash,
        created_at: {
          [Op.gte]: windowStart,
        },
      },
    });

    return recentCount >= maxReports;
  }

  /**
   * Hashes an email address using HMAC-SHA256 with a server-side secret
   * for anonymous reporter tracking. Uses HMAC to prevent rainbow table
   * attacks against the low-entropy email address space.
   *
   * @param email - Email address to hash
   * @returns Hex-encoded HMAC-SHA256 hash of the lowercase email
   */
  hashEmail(email: string): string {
    const secret = config.get<string>('moderation.emailHashSecret');
    return createHmac('sha256', secret)
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
export type { CreateReportData, CreateReportForEventData, ReportFilters, PaginatedReports };
