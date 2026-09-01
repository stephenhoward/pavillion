import { Model, Column, Table, DataType, PrimaryKey } from 'sequelize-typescript';
import db from '@/server/common/entity/db';

/**
 * Filesystem usage snapshot written by the worker process.
 *
 * The worker is the only process that mounts every volume it monitors (the
 * backup volume is mounted into the worker container, not the app container),
 * so the web process cannot statfs those paths itself. The worker records what
 * it measured here and the web process reads it back.
 *
 * The table is a single-row upsert per `stat_key`, not an append log: nothing
 * consumes the history, and a growing table would need its own retention job.
 * Each row carries its own `written_at` so staleness is observable — if the
 * worker dies, the value must not keep reporting last-known-good silently
 * (DEC-015's lens: for a signal an operator alerts on, staleness is a defect,
 * not a feature).
 */
@Table({ tableName: 'disk_usage_snapshot', timestamps: false })
class DiskUsageSnapshotEntity extends Model {

  /** Stable identifier for the monitored filesystem (e.g. 'backup_path'). */
  @PrimaryKey
  @Column({ type: DataType.STRING, allowNull: false })
  declare stat_key: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare path: string;

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare total_bytes: string;

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare free_bytes: string;

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare used_bytes: string;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare percentage_used: number;

  /** When the worker measured these values. */
  @Column({ type: DataType.DATE, allowNull: false })
  declare written_at: Date;
}

db.addModels([DiskUsageSnapshotEntity]);

export { DiskUsageSnapshotEntity };
