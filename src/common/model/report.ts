import { PrimaryModel } from '@/common/model/model';

/**
 * Categories for classifying reported events.
 */
enum ReportCategory {
  SPAM = 'spam',
  INAPPROPRIATE = 'inappropriate',
  MISLEADING = 'misleading',
  HARASSMENT = 'harassment',
  OTHER = 'other',
}

/**
 * Status values representing the lifecycle of a report.
 */
enum ReportStatus {
  PENDING_VERIFICATION = 'pending_verification',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
  ESCALATED = 'escalated',
}

/**
 * Type of reporter who filed the report.
 */
type ReporterType = 'anonymous' | 'authenticated' | 'administrator';

/**
 * Priority level assigned by an administrator.
 */
type AdminPriority = 'low' | 'medium' | 'high';

/**
 * How a report was escalated.
 */
type EscalationType = 'manual' | 'automatic';

/**
 * Represents a report filed against an event.
 * Contains all data about the report, its reporter, review status,
 * and administrative metadata.
 */
class Report extends PrimaryModel {
  eventId: string = '';
  calendarId: string = '';
  category: ReportCategory = ReportCategory.OTHER;
  description: string = '';
  reporterEmailHash: string | null = null;
  reporterAccountId: string | null = null;
  reporterType: ReporterType = 'anonymous';
  adminId: string | null = null;
  adminPriority: AdminPriority | null = null;
  adminDeadline: Date | null = null;
  adminNotes: string | null = null;
  status: ReportStatus = ReportStatus.PENDING_VERIFICATION;
  ownerNotes: string | null = null;
  reviewerId: string | null = null;
  reviewerNotes: string | null = null;
  reviewerTimestamp: Date | null = null;
  verificationToken: string | null = null;
  verificationExpiration: Date | null = null;
  escalationType: EscalationType | null = null;
  createdAt: Date = new Date();
  updatedAt: Date = new Date();

  /**
   * Constructor for Report.
   *
   * @param {string} [id] - Unique identifier for the report
   */
  constructor(id?: string) {
    super(id);
  }

  /**
   * Whether the report has been verified (i.e. is past the pending_verification stage).
   */
  get isVerified(): boolean {
    return this.status !== ReportStatus.PENDING_VERIFICATION;
  }

  /**
   * Whether the report is still pending action (pending_verification or submitted).
   */
  get isPending(): boolean {
    return this.status === ReportStatus.PENDING_VERIFICATION
      || this.status === ReportStatus.SUBMITTED;
  }

  /**
   * Whether the report has been escalated.
   */
  get isEscalated(): boolean {
    return this.status === ReportStatus.ESCALATED;
  }

  /**
   * Whether the report has reached a terminal state (resolved or dismissed).
   */
  get isResolved(): boolean {
    return this.status === ReportStatus.RESOLVED
      || this.status === ReportStatus.DISMISSED;
  }

  /**
   * Serializes only the fields safe for the person who submitted the report.
   * Excludes all sensitive, administrative, and reviewer fields.
   *
   * @returns Plain object with reporter-safe fields only
   */
  toReporterObject(): Record<string, any> {
    return {
      id: this.id,
      eventId: this.eventId,
      category: this.category,
      description: this.description,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
    };
  }

  /**
   * Serializes fields suitable for a calendar owner reviewing reports.
   * Includes reporter-safe fields plus reporterType, but not account details
   * or administrative metadata.
   *
   * @returns Plain object with owner-safe fields
   */
  toOwnerObject(): Record<string, any> {
    return {
      id: this.id,
      eventId: this.eventId,
      category: this.category,
      description: this.description,
      status: this.status,
      reporterType: this.reporterType,
      createdAt: this.createdAt.toISOString(),
    };
  }

  /**
   * Serializes all fields needed for instance admin review.
   * Includes full report details except verification secrets
   * (verificationToken, verificationExpiration).
   *
   * @returns Plain object with admin-level fields
   */
  toAdminObject(): Record<string, any> {
    return {
      id: this.id,
      eventId: this.eventId,
      calendarId: this.calendarId,
      category: this.category,
      description: this.description,
      reporterEmailHash: this.reporterEmailHash,
      reporterAccountId: this.reporterAccountId,
      reporterType: this.reporterType,
      adminId: this.adminId,
      adminPriority: this.adminPriority,
      adminDeadline: this.adminDeadline ? this.adminDeadline.toISOString() : null,
      adminNotes: this.adminNotes,
      status: this.status,
      ownerNotes: this.ownerNotes,
      reviewerId: this.reviewerId,
      reviewerNotes: this.reviewerNotes,
      reviewerTimestamp: this.reviewerTimestamp ? this.reviewerTimestamp.toISOString() : null,
      escalationType: this.escalationType,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Converts the report to a plain JavaScript object.
   * Date fields are serialized to ISO strings.
   * This method includes ALL fields and should only be used for internal purposes.
   *
   * @returns {Record<string, any>} Plain object representation of the report
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      eventId: this.eventId,
      calendarId: this.calendarId,
      category: this.category,
      description: this.description,
      reporterEmailHash: this.reporterEmailHash,
      reporterAccountId: this.reporterAccountId,
      reporterType: this.reporterType,
      adminId: this.adminId,
      adminPriority: this.adminPriority,
      adminDeadline: this.adminDeadline ? this.adminDeadline.toISOString() : null,
      adminNotes: this.adminNotes,
      status: this.status,
      ownerNotes: this.ownerNotes,
      reviewerId: this.reviewerId,
      reviewerNotes: this.reviewerNotes,
      reviewerTimestamp: this.reviewerTimestamp ? this.reviewerTimestamp.toISOString() : null,
      verificationToken: this.verificationToken,
      verificationExpiration: this.verificationExpiration ? this.verificationExpiration.toISOString() : null,
      escalationType: this.escalationType,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Creates a Report instance from a plain object.
   * Date fields are parsed from ISO strings.
   *
   * @param {Record<string, any>} obj - Plain object containing report data
   * @returns {Report} A new Report instance
   */
  static fromObject(obj: Record<string, any>): Report {
    const report = new Report(obj.id);
    report.eventId = obj.eventId ?? '';
    report.calendarId = obj.calendarId ?? '';
    report.category = obj.category ?? ReportCategory.OTHER;
    report.description = obj.description ?? '';
    report.reporterEmailHash = obj.reporterEmailHash ?? null;
    report.reporterAccountId = obj.reporterAccountId ?? null;
    report.reporterType = obj.reporterType ?? 'anonymous';
    report.adminId = obj.adminId ?? null;
    report.adminPriority = obj.adminPriority ?? null;
    report.adminDeadline = obj.adminDeadline ? new Date(obj.adminDeadline) : null;
    report.adminNotes = obj.adminNotes ?? null;
    report.status = obj.status ?? ReportStatus.PENDING_VERIFICATION;
    report.ownerNotes = obj.ownerNotes ?? null;
    report.reviewerId = obj.reviewerId ?? null;
    report.reviewerNotes = obj.reviewerNotes ?? null;
    report.reviewerTimestamp = obj.reviewerTimestamp ? new Date(obj.reviewerTimestamp) : null;
    report.verificationToken = obj.verificationToken ?? null;
    report.verificationExpiration = obj.verificationExpiration ? new Date(obj.verificationExpiration) : null;
    report.escalationType = obj.escalationType ?? null;
    report.createdAt = obj.createdAt ? new Date(obj.createdAt) : new Date();
    report.updatedAt = obj.updatedAt ? new Date(obj.updatedAt) : new Date();
    return report;
  }
}

export { Report, ReportCategory, ReportStatus };
export type { ReporterType, AdminPriority, EscalationType };
