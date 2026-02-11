import {
  Model,
  Column,
  Table,
  DataType,
  PrimaryKey,
  ForeignKey,
  Index,
} from 'sequelize-typescript';

import { BlockedReporter } from '@/common/model/blocked_reporter';
import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

/**
 * Database entity for blocked reporter email addresses.
 * Tracks email hashes of reporters who have been blocked from submitting
 * new reports, including who blocked them and why.
 */
@Table({
  tableName: 'blocked_reporter',
  timestamps: false,
  underscored: true,
})
class BlockedReporterEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Index({ unique: true })
  @Column({ type: DataType.STRING, allowNull: false })
  declare email_hash: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare blocked_by: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare reason: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare created_at: Date;

  /**
   * Converts the entity to a BlockedReporter domain model.
   *
   * @returns BlockedReporter domain model instance
   */
  toModel(): BlockedReporter {
    const blockedReporter = new BlockedReporter(this.id);
    blockedReporter.emailHash = this.email_hash;
    blockedReporter.blockedBy = this.blocked_by;
    blockedReporter.reason = this.reason;
    blockedReporter.createdAt = this.created_at;
    return blockedReporter;
  }

  /**
   * Creates a BlockedReporterEntity from a BlockedReporter domain model.
   *
   * @param blockedReporter - BlockedReporter domain model to convert
   * @returns BlockedReporterEntity instance
   */
  static fromModel(blockedReporter: BlockedReporter): BlockedReporterEntity {
    return BlockedReporterEntity.build({
      id: blockedReporter.id,
      email_hash: blockedReporter.emailHash,
      blocked_by: blockedReporter.blockedBy,
      reason: blockedReporter.reason,
      created_at: blockedReporter.createdAt,
    });
  }
}

db.addModels([BlockedReporterEntity]);

export { BlockedReporterEntity };
