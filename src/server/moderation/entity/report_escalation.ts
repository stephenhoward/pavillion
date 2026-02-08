import {
  Model,
  Column,
  Table,
  DataType,
  PrimaryKey,
  CreatedAt,
} from 'sequelize-typescript';

import db from '@/server/common/entity/db';

/**
 * Database entity for tracking report escalation and status transition history.
 * Each record represents a decision point in the report review lifecycle,
 * recording who made the decision, what the transition was, and any notes.
 */
@Table({
  tableName: 'report_escalation',
  timestamps: false,
  underscored: true,
})
class ReportEscalationEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare report_id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare from_status: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare to_status: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare reviewer_id: string | null;

  @Column({ type: DataType.STRING, allowNull: false })
  declare reviewer_role: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare decision: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @CreatedAt
  @Column({ type: DataType.DATE })
  declare created_at: Date;

  /**
   * Converts the entity to a plain object representation.
   *
   * @returns Plain object with camelCase property names
   */
  toModel(): Record<string, any> {
    return {
      id: this.id,
      reportId: this.report_id,
      fromStatus: this.from_status,
      toStatus: this.to_status,
      reviewerId: this.reviewer_id,
      reviewerRole: this.reviewer_role,
      decision: this.decision,
      notes: this.notes,
      createdAt: this.created_at,
    };
  }

  /**
   * Creates a ReportEscalationEntity from a plain object.
   *
   * @param data - Object with camelCase property names
   * @returns ReportEscalationEntity instance
   */
  static fromModel(data: {
    id?: string;
    reportId: string;
    fromStatus: string;
    toStatus: string;
    reviewerId?: string | null;
    reviewerRole: string;
    decision: string;
    notes?: string | null;
  }): ReportEscalationEntity {
    return ReportEscalationEntity.build({
      id: data.id,
      report_id: data.reportId,
      from_status: data.fromStatus,
      to_status: data.toStatus,
      reviewer_id: data.reviewerId ?? null,
      reviewer_role: data.reviewerRole,
      decision: data.decision,
      notes: data.notes ?? null,
    });
  }
}

db.addModels([ReportEscalationEntity]);

export { ReportEscalationEntity };
