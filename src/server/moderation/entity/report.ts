import {
  Model,
  Column,
  Table,
  DataType,
  PrimaryKey,
  CreatedAt,
  UpdatedAt,
  Index,
} from 'sequelize-typescript';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import type { ReporterType, AdminPriority, EscalationType, ForwardStatus } from '@/common/model/report';
import db from '@/server/common/entity/db';

/**
 * Database entity for event reports in the moderation system.
 * Stores all data about a report filed against an event, including
 * reporter information, review status, and administrative metadata.
 */
@Table({
  tableName: 'report',
  timestamps: true,
  underscored: true,
})
class ReportEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare event_id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare calendar_id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare category: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare reporter_email_hash: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare reporter_account_id: string | null;

  @Column({ type: DataType.STRING, allowNull: false })
  declare reporter_type: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare ip_hash: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare ip_subnet: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare ip_region: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare admin_id: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare admin_priority: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare admin_deadline: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare admin_notes: string | null;

  @Column({ type: DataType.STRING, allowNull: false })
  declare status: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare owner_notes: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare reviewer_id: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare reviewer_notes: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare reviewer_timestamp: Date | null;

  @Index
  @Column({ type: DataType.STRING, allowNull: true })
  declare verification_token: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare verification_expiration: Date | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare escalation_type: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare forwarded_from_instance: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare forwarded_report_id: string | null;

  @Column({
    type: DataType.ENUM('pending', 'acknowledged', 'no_response'),
    allowNull: true,
  })
  declare forward_status: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare has_source_flooding_pattern: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare has_event_targeting_pattern: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare has_instance_pattern: boolean;

  @CreatedAt
  declare created_at: Date;

  @UpdatedAt
  declare updated_at: Date;

  /**
   * Converts the entity to a Report domain model.
   *
   * @returns Report domain model instance
   */
  toModel(): Report {
    const report = new Report(this.id);
    report.eventId = this.event_id;
    report.calendarId = this.calendar_id;
    report.category = this.category as ReportCategory;
    report.description = this.description;
    report.reporterEmailHash = this.reporter_email_hash;
    report.reporterAccountId = this.reporter_account_id;
    report.reporterType = this.reporter_type as ReporterType;
    report.adminId = this.admin_id;
    report.adminPriority = this.admin_priority as AdminPriority | null;
    report.adminDeadline = this.admin_deadline;
    report.adminNotes = this.admin_notes;
    report.status = this.status as ReportStatus;
    report.ownerNotes = this.owner_notes;
    report.reviewerId = this.reviewer_id;
    report.reviewerNotes = this.reviewer_notes;
    report.reviewerTimestamp = this.reviewer_timestamp;
    report.verificationToken = this.verification_token;
    report.verificationExpiration = this.verification_expiration;
    report.escalationType = this.escalation_type as EscalationType | null;
    report.forwardedFromInstance = this.forwarded_from_instance;
    report.forwardedReportId = this.forwarded_report_id;
    report.forwardStatus = this.forward_status as ForwardStatus | null;
    report.hasSourceFloodingPattern = this.has_source_flooding_pattern;
    report.hasEventTargetingPattern = this.has_event_targeting_pattern;
    report.hasInstancePattern = this.has_instance_pattern;
    report.createdAt = this.created_at;
    report.updatedAt = this.updated_at;
    return report;
  }

  /**
   * Creates a ReportEntity from a Report domain model.
   *
   * @param report - Report domain model to convert
   * @returns ReportEntity instance
   */
  static fromModel(report: Report): ReportEntity {
    return ReportEntity.build({
      id: report.id,
      event_id: report.eventId,
      calendar_id: report.calendarId,
      category: report.category,
      description: report.description,
      reporter_email_hash: report.reporterEmailHash,
      reporter_account_id: report.reporterAccountId,
      reporter_type: report.reporterType,
      admin_id: report.adminId,
      admin_priority: report.adminPriority,
      admin_deadline: report.adminDeadline,
      admin_notes: report.adminNotes,
      status: report.status,
      owner_notes: report.ownerNotes,
      reviewer_id: report.reviewerId,
      reviewer_notes: report.reviewerNotes,
      reviewer_timestamp: report.reviewerTimestamp,
      verification_token: report.verificationToken,
      verification_expiration: report.verificationExpiration,
      escalation_type: report.escalationType,
      forwarded_from_instance: report.forwardedFromInstance,
      forwarded_report_id: report.forwardedReportId,
      forward_status: report.forwardStatus,
      has_source_flooding_pattern: report.hasSourceFloodingPattern,
      has_event_targeting_pattern: report.hasEventTargetingPattern,
      has_instance_pattern: report.hasInstancePattern,
      created_at: report.createdAt,
      updated_at: report.updatedAt,
    });
  }
}

db.addModels([ReportEntity]);

export { ReportEntity };
