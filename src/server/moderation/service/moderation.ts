import { randomBytes, createHmac } from 'crypto';
import { EventEmitter } from 'events';
import { Op, UniqueConstraintError } from 'sequelize';
import config from 'config';

import { Account } from '@/common/model/account';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import type { ReporterType, EscalationType } from '@/common/model/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { DuplicateReportError, ReportValidationError } from '@/common/exceptions/report';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import {
  InvalidVerificationTokenError,
  ReportNotFoundError,
  ReportAlreadyResolvedError,
  EmailRateLimitError,
} from '@/server/moderation/exceptions';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';

/** Token expiration duration in hours. */
const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;

/** Default page size for paginated queries. */
const DEFAULT_PAGE_LIMIT = 20;

/** Valid report categories derived from the ReportCategory enum values. */
const VALID_CATEGORIES = Object.values(ReportCategory);

/** Valid sort fields for report listing. */
const VALID_SORT_FIELDS = ['created_at', 'updated_at', 'status', 'category'];

/** Valid sort orders. */
const VALID_SORT_ORDERS = ['ASC', 'DESC'];

/** Valid report status values for filtering. */
const VALID_STATUSES = Object.values(ReportStatus);

/** Valid reporter type values for source filtering. */
const VALID_SOURCES: ReporterType[] = ['anonymous', 'authenticated', 'administrator'];

/** Valid escalation type values for filtering. */
const VALID_ESCALATION_TYPES: EscalationType[] = ['manual', 'automatic'];

/** Maximum allowed length for report description text. */
const MAX_DESCRIPTION_LENGTH = 2000;

/** Basic email format validation pattern. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Maximum allowed length for email address (RFC 5321 limit). */
const MAX_EMAIL_LENGTH = 254;

/** UUID v4 validation regex. */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Valid admin priority values. */
const VALID_PRIORITIES = ['low', 'medium', 'high'];

/** Valid admin action values for PUT /admin/reports/:reportId. */
const VALID_ADMIN_ACTIONS = ['override', 'resolve', 'dismiss'];

/** Default moderation settings stored as string key-value pairs in Configuration. */
const MODERATION_SETTING_DEFAULTS: Record<string, number> = {
  'moderation.autoEscalationHours': 72,
  'moderation.adminReportEscalationHours': 24,
  'moderation.reminderBeforeEscalationHours': 12,
};

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
 * Input data for creating an admin-initiated report.
 * Admin reports skip verification and go directly to submitted status.
 */
interface CreateAdminReportData {
  eventId: string;
  adminId: string;
  category: ReportCategory;
  description: string;
  priority: 'low' | 'medium' | 'high';
  deadline?: Date;
  adminNotes?: string;
}

/**
 * Filter options for listing reports.
 */
interface ReportFilters {
  status?: ReportStatus;
  category?: ReportCategory;
  eventId?: string;
  calendarId?: string;
  source?: ReporterType;
  escalationType?: EscalationType;
  sortBy?: 'created_at' | 'updated_at' | 'status' | 'category';
  sortOrder?: 'ASC' | 'DESC';
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
 * Escalation history record shape returned by getEscalationHistory.
 */
interface EscalationRecord {
  id: string;
  reportId: string;
  fromStatus: string;
  toStatus: string;
  reviewerId: string | null;
  reviewerRole: string;
  decision: string;
  notes: string | null;
  createdAt: Date;
}

/**
 * Moderation settings shape returned by getModerationSettings.
 */
interface ModerationSettings {
  autoEscalationHours: number;
  adminReportEscalationHours: number;
  reminderBeforeEscalationHours: number;
}

/**
 * Service for managing the report lifecycle including creation,
 * duplicate detection, verification, status transitions, and escalation.
 */
class ModerationService {
  private eventBus?: EventEmitter;
  private calendarInterface?: CalendarInterface;
  private configurationInterface?: ConfigurationInterface;

  constructor(eventBus?: EventEmitter, calendarInterface?: CalendarInterface, configurationInterface?: ConfigurationInterface) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.configurationInterface = configurationInterface;
  }

  /**
   * Collects validation errors for eventId, category, and description fields.
   * Does not throw - returns an array of error messages for aggregation.
   *
   * @param eventId - Event UUID to report
   * @param category - Report category value
   * @param description - Report description text
   * @returns Array of validation error messages (empty if valid)
   */
  validateReportFields(eventId: any, category: any, description: any): string[] {
    const errors: string[] = [];

    // Event ID validation - must be present and valid UUID format
    if (!eventId) {
      errors.push('Event ID is required');
    }
    else if (typeof eventId !== 'string' || !UUID_V4_REGEX.test(eventId)) {
      errors.push('Event ID must be a valid UUID');
    }

    // Category validation - must be in the allowlist
    if (!category) {
      errors.push('Category is required');
    }
    else if (!VALID_CATEGORIES.includes(category)) {
      errors.push(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    // Description validation - must be a non-empty string within length limit
    if (!description && description !== 0 && description !== false) {
      errors.push('Description is required');
    }
    else if (typeof description !== 'string') {
      errors.push('Description must be a string');
    }
    else if (description.trim().length === 0) {
      errors.push('Description is required');
    }
    else if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`);
    }

    return errors;
  }

  /**
   * Collects validation errors for email field.
   * Does not throw - returns an array of error messages for aggregation.
   *
   * @param email - Reporter email address
   * @returns Array of validation error messages (empty if valid)
   */
  validateEmailField(email: any): string[] {
    const errors: string[] = [];

    if (!email) {
      errors.push('Email is required');
    }
    else if (typeof email === 'string' && email.trim().length > MAX_EMAIL_LENGTH) {
      errors.push(`Email address must be ${MAX_EMAIL_LENGTH} characters or fewer`);
    }
    else if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      errors.push('A valid email address is required');
    }

    return errors;
  }

  /**
   * Validates all report input fields and throws if any are invalid.
   * Collects all errors across all fields before throwing, so the
   * caller receives all validation issues in a single response.
   *
   * @param data - Report creation data to validate
   * @throws ReportValidationError if any validation checks fail
   */
  validateCreateReportForEventInput(data: CreateReportForEventData): void {
    const errors: string[] = [
      ...this.validateReportFields(data.eventId, data.category, data.description),
    ];

    // Validate email for anonymous reporters
    if (data.reporterType === 'anonymous') {
      errors.push(...this.validateEmailField(data.reporterEmail));
    }

    if (errors.length > 0) {
      throw new ReportValidationError(errors);
    }
  }

  /**
   * Validates admin-specific report fields (priority, deadline).
   * Does not throw - returns an array of error messages for aggregation.
   *
   * @param priority - Admin priority value
   * @param deadline - Optional deadline date
   * @returns Array of validation error messages (empty if valid)
   */
  validateAdminReportFields(priority: any, deadline?: Date): string[] {
    const errors: string[] = [];

    if (!priority) {
      errors.push('Priority is required');
    }
    else if (!VALID_PRIORITIES.includes(priority)) {
      errors.push(`Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`);
    }

    if (deadline !== undefined) {
      if (!(deadline instanceof Date) || isNaN(deadline.getTime())) {
        errors.push('Deadline must be a valid date');
      }
      else if (deadline.getTime() <= Date.now()) {
        errors.push('Deadline must be in the future');
      }
    }

    return errors;
  }

  /**
   * Creates a new report for an event, resolving the calendarId internally.
   * Validates all input fields before proceeding with event lookup and
   * report creation.
   *
   * @param data - Report creation data (without calendarId)
   * @returns The created Report domain model
   * @throws ReportValidationError if input validation fails
   * @throws EventNotFoundError if the event does not exist or has no calendarId
   * @throws DuplicateReportError if the reporter has already reported this event
   * @throws EmailRateLimitError if the email has exceeded the verification email limit
   */
  async createReportForEvent(data: CreateReportForEventData): Promise<Report> {
    if (!this.calendarInterface) {
      throw new Error('CalendarInterface is required for createReportForEvent');
    }

    // Validate all input fields in one pass
    this.validateCreateReportForEventInput(data);

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
   * Creates an admin-initiated report for an event.
   * Validates admin-specific fields (priority, deadline) in addition
   * to standard report fields. Delegates to createReportForEvent with
   * reporterType set to 'administrator'. Admin reports skip verification
   * and go directly to submitted status.
   *
   * @param data - Admin report creation data
   * @returns The created Report domain model
   * @throws ReportValidationError if input validation fails
   * @throws EventNotFoundError if the event does not exist
   * @throws DuplicateReportError if admin has already reported this event
   */
  async createAdminReport(data: CreateAdminReportData): Promise<Report> {
    // Validate standard report fields + admin-specific fields in one pass
    const errors: string[] = [
      ...this.validateReportFields(data.eventId, data.category, data.description),
      ...this.validateAdminReportFields(data.priority, data.deadline),
    ];

    if (errors.length > 0) {
      throw new ReportValidationError(errors);
    }

    return this.createReportForEvent({
      eventId: data.eventId,
      category: data.category,
      description: data.description,
      reporterType: 'administrator',
      reporterAccountId: data.adminId,
      adminId: data.adminId,
      adminPriority: data.priority,
      adminDeadline: data.deadline,
      adminNotes: data.adminNotes,
    });
  }

  /**
   * Creates a new report against an event.
   * For anonymous reporters the email is hashed and a verification token is generated.
   * For authenticated and administrator reporters the status starts as submitted.
   * Checks for duplicate reports before creation.
   * For anonymous reporters, enforces per-email rate limiting on verification emails.
   *
   * If a concurrent request creates the EventReporter record between the
   * duplicate check and the save, the DB unique constraint will reject the
   * second insert. In that case the orphaned ReportEntity is cleaned up and
   * a DuplicateReportError is thrown, keeping behavior consistent regardless
   * of timing.
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

    // Create EventReporter record for duplicate tracking.
    // The DB unique constraint on (event_id, reporter_identifier) guards
    // against a race where a concurrent request passed the duplicate check
    // above. If the constraint fires, clean up the orphaned report and
    // surface the duplicate as a proper DuplicateReportError.
    const reporterRecord = EventReporterEntity.fromModel({
      eventId: data.eventId,
      reporterIdentifier,
      reportId: createdReport.id,
    });

    try {
      await reporterRecord.save();
    }
    catch (error) {
      if (error instanceof UniqueConstraintError) {
        // Clean up the orphaned ReportEntity created moments ago
        await ReportEntity.destroy({ where: { id: createdReport.id } });
        throw new DuplicateReportError();
      }
      throw error;
    }

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
   * @param filters - Optional status, category, eventId, source, sorting, page, limit filters
   * @returns Paginated list of reports
   */
  async getReportsForCalendar(calendarId: string, filters: ReportFilters = {}): Promise<PaginatedReports> {
    this.validateListFilters(filters);

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
    if (filters.eventId) {
      where.event_id = filters.eventId;
    }
    if (filters.source) {
      where.reporter_type = filters.source;
    }

    const sortBy = filters.sortBy ?? 'created_at';
    const sortOrder = filters.sortOrder ?? 'DESC';

    const { rows, count } = await ReportEntity.findAndCountAll({
      where,
      limit,
      offset,
      order: [[sortBy, sortOrder]],
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
   * Checks if a user has permission to review reports for a calendar.
   * Delegates to CalendarInterface.userCanReviewReports.
   *
   * @param account - The authenticated account
   * @param calendarId - Calendar UUID
   * @returns True if the user can review reports
   */
  async userCanReviewReports(account: Account, calendarId: string): Promise<boolean> {
    if (!this.calendarInterface) {
      throw new Error('CalendarInterface is required for userCanReviewReports');
    }
    return this.calendarInterface.userCanReviewReports(account, calendarId);
  }

  /**
   * Retrieves a report by ID and verifies it belongs to the specified calendar.
   * Combines the common getReportById + calendar ownership check.
   *
   * @param reportId - Report UUID
   * @param calendarId - Calendar UUID the report must belong to
   * @returns The Report
   * @throws ReportNotFoundError if report not found or belongs to a different calendar
   */
  async getReportForCalendar(reportId: string, calendarId: string): Promise<Report> {
    const report = await this.getReportById(reportId);
    if (!report || report.calendarId !== calendarId) {
      throw new ReportNotFoundError();
    }
    return report;
  }

  /**
   * Validates list filter parameters for report listing.
   * Throws ReportValidationError if any filter values are invalid.
   *
   * @param filters - Filter parameters to validate
   * @throws ReportValidationError if any filter is invalid
   */
  validateListFilters(filters: ReportFilters): void {
    const errors: string[] = [];

    if (filters.page !== undefined && (isNaN(filters.page) || filters.page < 1)) {
      errors.push('Page must be a positive integer');
    }

    if (filters.limit !== undefined && (isNaN(filters.limit) || filters.limit < 1 || filters.limit > 100)) {
      errors.push('Limit must be between 1 and 100');
    }

    if (filters.status && !VALID_STATUSES.includes(filters.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    if (filters.category && !VALID_CATEGORIES.includes(filters.category)) {
      errors.push(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    if (filters.source && !VALID_SOURCES.includes(filters.source)) {
      errors.push(`Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`);
    }

    if (filters.escalationType && !VALID_ESCALATION_TYPES.includes(filters.escalationType)) {
      errors.push(`Invalid escalationType. Must be one of: ${VALID_ESCALATION_TYPES.join(', ')}`);
    }

    if (filters.sortBy && !VALID_SORT_FIELDS.includes(filters.sortBy)) {
      errors.push(`Invalid sortBy. Must be one of: ${VALID_SORT_FIELDS.join(', ')}`);
    }

    if (filters.sortOrder && !VALID_SORT_ORDERS.includes(filters.sortOrder)) {
      errors.push('Invalid sortOrder. Must be ASC or DESC');
    }

    if (errors.length > 0) {
      throw new ReportValidationError(errors);
    }
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
   * Retrieves paginated admin-relevant reports with optional filters.
   * Returns reports that are either escalated OR admin-initiated
   * (reporterType = 'administrator'), with full filtering and sorting support.
   *
   * @param filters - Optional status, category, calendarId, source, escalationType, sorting, page, limit filters
   * @returns Paginated list of admin-relevant reports
   * @throws ReportValidationError if any filter values are invalid
   */
  async getAdminReports(filters: ReportFilters = {}): Promise<PaginatedReports> {
    this.validateListFilters(filters);

    const page = filters.page ?? 1;
    const limit = filters.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = (page - 1) * limit;

    // Base condition: escalated reports OR admin-initiated reports
    const baseCondition: Record<string, any> = {
      [Op.or]: [
        { status: ReportStatus.ESCALATED },
        { reporter_type: 'administrator' },
      ],
    };

    // Build additional filter conditions
    const additionalConditions: Record<string, any>[] = [];

    if (filters.status) {
      additionalConditions.push({ status: filters.status });
    }
    if (filters.category) {
      additionalConditions.push({ category: filters.category });
    }
    if (filters.calendarId) {
      additionalConditions.push({ calendar_id: filters.calendarId });
    }
    if (filters.source) {
      additionalConditions.push({ reporter_type: filters.source });
    }
    if (filters.escalationType) {
      additionalConditions.push({ escalation_type: filters.escalationType });
    }

    // Combine base condition with additional filters using AND
    const where: Record<string, any> = additionalConditions.length > 0
      ? { [Op.and]: [baseCondition, ...additionalConditions] }
      : baseCondition;

    const sortBy = filters.sortBy ?? 'created_at';
    const sortOrder = filters.sortOrder ?? 'DESC';

    const { rows, count } = await ReportEntity.findAndCountAll({
      where,
      limit,
      offset,
      order: [[sortBy, sortOrder]],
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
   * Retrieves a single report by ID for admin review.
   * Unlike getReportForCalendar, this has no calendar scoping -
   * admins can view any report across all calendars.
   *
   * @param reportId - Report UUID
   * @returns The Report
   * @throws ReportNotFoundError if report not found
   */
  async getAdminReport(reportId: string): Promise<Report> {
    const report = await this.getReportById(reportId);
    if (!report) {
      throw new ReportNotFoundError();
    }
    return report;
  }

  /**
   * Retrieves the escalation history for a report.
   *
   * @param reportId - Report UUID
   * @returns Array of escalation records ordered by creation date
   */
  async getEscalationHistory(reportId: string): Promise<EscalationRecord[]> {
    const entities = await ReportEscalationEntity.findAll({
      where: { report_id: reportId },
      order: [['created_at', 'ASC']],
    });
    return entities.map((entity) => entity.toModel() as EscalationRecord);
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
    const entity = await ReportEntity.findByPk(reportId);
    if (!entity) {
      throw new ReportNotFoundError();
    }

    await entity.update({ owner_notes: ownerNotes });
    return entity.toModel();
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
   * Resolves a report as an admin, recording the admin as reviewer.
   * Creates an escalation record with reviewer_role 'admin'.
   *
   * @param reportId - Report UUID
   * @param adminId - Admin account UUID
   * @param notes - Resolution notes
   * @returns The resolved Report
   * @throws ReportNotFoundError if report not found
   * @throws ReportAlreadyResolvedError if report is already resolved or dismissed
   */
  async adminResolveReport(reportId: string, adminId: string, notes: string): Promise<Report> {
    const entity = await ReportEntity.findByPk(reportId);
    if (!entity) {
      throw new ReportNotFoundError();
    }

    const currentStatus = entity.status as ReportStatus;
    if (currentStatus === ReportStatus.RESOLVED || currentStatus === ReportStatus.DISMISSED) {
      throw new ReportAlreadyResolvedError();
    }

    await entity.update({
      status: ReportStatus.RESOLVED,
      reviewer_id: adminId,
      reviewer_notes: notes,
      reviewer_timestamp: new Date(),
    });

    const escalationRecord = ReportEscalationEntity.fromModel({
      reportId,
      fromStatus: currentStatus,
      toStatus: ReportStatus.RESOLVED,
      reviewerId: adminId,
      reviewerRole: 'admin',
      decision: 'resolved',
      notes,
    });
    await escalationRecord.save();

    const report = entity.toModel();

    this.emit('reportResolved', { report, reviewerId: adminId });

    return report;
  }

  /**
   * Dismisses a report as an admin. This is a final decision -
   * no further escalation is possible. Sets status to 'dismissed'.
   * Creates an escalation record with reviewer_role 'admin' and
   * decision 'dismissed'.
   *
   * @param reportId - Report UUID
   * @param adminId - Admin account UUID
   * @param notes - Dismissal notes
   * @returns The dismissed Report
   * @throws ReportNotFoundError if report not found
   * @throws ReportAlreadyResolvedError if report is already resolved or dismissed
   */
  async adminDismissReport(reportId: string, adminId: string, notes: string): Promise<Report> {
    const entity = await ReportEntity.findByPk(reportId);
    if (!entity) {
      throw new ReportNotFoundError();
    }

    const currentStatus = entity.status as ReportStatus;
    if (currentStatus === ReportStatus.RESOLVED || currentStatus === ReportStatus.DISMISSED) {
      throw new ReportAlreadyResolvedError();
    }

    await entity.update({
      status: ReportStatus.DISMISSED,
      reviewer_id: adminId,
      reviewer_notes: notes,
      reviewer_timestamp: new Date(),
    });

    const escalationRecord = ReportEscalationEntity.fromModel({
      reportId,
      fromStatus: currentStatus,
      toStatus: ReportStatus.DISMISSED,
      reviewerId: adminId,
      reviewerRole: 'admin',
      decision: 'dismissed',
      notes,
    });
    await escalationRecord.save();

    const report = entity.toModel();

    this.emit('reportDismissed', { report, reviewerId: adminId });

    return report;
  }

  /**
   * Overrides the current status of a report as an admin, setting it
   * to 'resolved' regardless of its current state. This allows admins
   * to reverse owner decisions or act on reports in any status.
   * Creates an escalation record with reviewer_role 'admin' and
   * decision 'override'.
   *
   * @param reportId - Report UUID
   * @param adminId - Admin account UUID
   * @param notes - Override notes
   * @returns The overridden Report
   * @throws ReportNotFoundError if report not found
   */
  async adminOverrideReport(reportId: string, adminId: string, notes: string): Promise<Report> {
    const entity = await ReportEntity.findByPk(reportId);
    if (!entity) {
      throw new ReportNotFoundError();
    }

    const currentStatus = entity.status as ReportStatus;

    await entity.update({
      status: ReportStatus.RESOLVED,
      reviewer_id: adminId,
      reviewer_notes: notes,
      reviewer_timestamp: new Date(),
    });

    const escalationRecord = ReportEscalationEntity.fromModel({
      reportId,
      fromStatus: currentStatus,
      toStatus: ReportStatus.RESOLVED,
      reviewerId: adminId,
      reviewerRole: 'admin',
      decision: 'override',
      notes,
    });
    await escalationRecord.save();

    const report = entity.toModel();

    this.emit('reportOverridden', { report, reviewerId: adminId });

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
   * Retrieves current moderation settings from the Configuration domain.
   * Returns defaults for any settings not explicitly configured.
   *
   * @returns Current moderation settings with defaults applied
   */
  async getModerationSettings(): Promise<ModerationSettings> {
    if (!this.configurationInterface) {
      throw new Error('ConfigurationInterface is required for getModerationSettings');
    }

    const autoEscalation = await this.configurationInterface.getSetting('moderation.autoEscalationHours');
    const adminReportEscalation = await this.configurationInterface.getSetting('moderation.adminReportEscalationHours');
    const reminderBefore = await this.configurationInterface.getSetting('moderation.reminderBeforeEscalationHours');

    return {
      autoEscalationHours: autoEscalation
        ? parseFloat(autoEscalation)
        : MODERATION_SETTING_DEFAULTS['moderation.autoEscalationHours'],
      adminReportEscalationHours: adminReportEscalation
        ? parseFloat(adminReportEscalation)
        : MODERATION_SETTING_DEFAULTS['moderation.adminReportEscalationHours'],
      reminderBeforeEscalationHours: reminderBefore
        ? parseFloat(reminderBefore)
        : MODERATION_SETTING_DEFAULTS['moderation.reminderBeforeEscalationHours'],
    };
  }

  /**
   * Updates moderation settings via the Configuration domain.
   * Supports partial updates - only provided keys are updated.
   * Returns the complete settings after update with defaults for unchanged values.
   *
   * @param updates - Partial settings object with values to update
   * @returns Updated moderation settings
   */
  async updateModerationSettings(updates: Partial<ModerationSettings>): Promise<ModerationSettings> {
    if (!this.configurationInterface) {
      throw new Error('ConfigurationInterface is required for updateModerationSettings');
    }

    if (updates.autoEscalationHours !== undefined) {
      await this.configurationInterface.setSetting(
        'moderation.autoEscalationHours',
        String(updates.autoEscalationHours),
      );
    }

    if (updates.adminReportEscalationHours !== undefined) {
      await this.configurationInterface.setSetting(
        'moderation.adminReportEscalationHours',
        String(updates.adminReportEscalationHours),
      );
    }

    if (updates.reminderBeforeEscalationHours !== undefined) {
      await this.configurationInterface.setSetting(
        'moderation.reminderBeforeEscalationHours',
        String(updates.reminderBeforeEscalationHours),
      );
    }

    return this.getModerationSettings();
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
export { VALID_ADMIN_ACTIONS };
export type { CreateReportData, CreateReportForEventData, CreateAdminReportData, ReportFilters, PaginatedReports, EscalationRecord, ModerationSettings };
