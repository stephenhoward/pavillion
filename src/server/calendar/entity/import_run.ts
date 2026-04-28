import {
  Model,
  Column,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
  PrimaryKey,
  CreatedAt,
  Index,
  Default,
} from 'sequelize-typescript';

import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import db from '@/server/common/entity/db';

/**
 * Allowed values for the `outcome` column on import_run. Captured as a
 * string-literal union for type-safety at the service layer; the database
 * enforces the same set via the ENUM column.
 */
export type ImportRunOutcome =
  | 'success'
  | 'no_changes'
  | 'fetch_error'
  | 'parse_error'
  | 'ssrf_blocked'
  | 'dns_error';

/**
 * ImportRunEntity
 *
 * Sequelize entity mirroring the `import_run` table defined in migration
 * 0026. Records one row per ICS import attempt with the outcome, counts of
 * events affected, and any error details — providing an audit trail and
 * operational visibility for scheduled imports.
 *
 * Server-only: no common-model counterpart. Import-run data is surfaced to
 * clients via a dedicated API shape, not a round-trippable domain model.
 *
 * @see bead pv-1qcp.1.2
 * @see migration 0027_create_import_run.ts
 */
@Table({
  tableName: 'import_run',
  timestamps: false,
  underscored: true,
})
class ImportRunEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => ImportSourceEntity)
  @Index({ name: 'idx_import_run_source' })
  @Column({ type: DataType.UUID, allowNull: false })
  declare import_source_id: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare started_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare finished_at: Date | null;

  @Column({
    type: DataType.ENUM(
      'success',
      'no_changes',
      'fetch_error',
      'parse_error',
      'ssrf_blocked',
      'dns_error',
    ),
    allowNull: false,
  })
  declare outcome: ImportRunOutcome;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare events_created: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare events_updated: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare events_skipped_locally_edited: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare events_disappeared: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare error_message: string | null;

  @CreatedAt
  declare created_at: Date;

  @BelongsTo(() => ImportSourceEntity, {
    foreignKey: 'import_source_id',
    onDelete: 'CASCADE',
  })
  declare importSource: ImportSourceEntity;
}

db.addModels([ImportRunEntity]);

export { ImportRunEntity };
