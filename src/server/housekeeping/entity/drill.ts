import { Model, Column, Table, DataType, PrimaryKey } from 'sequelize-typescript';
import db from '@/server/common/entity/db';

/**
 * One completed restore-drill run.
 *
 * Appended by `pavillion backup record-drill`, which scripts/restore-drill.sh
 * invokes once per completed drill. The table is an append log rather than a
 * single upserted row because the history is the point: an operator answering
 * "has a drill passed in the last 30 days" needs the last *passing* run, which a
 * row overwritten by a later failure would have erased.
 *
 * `backup_filename` deliberately carries no association to {@link BackupEntity}.
 * GFS retention prunes backup_metadata rows, and a drill record must outlive the
 * backup it proved — see migrations/0044_create_backup_drill.ts for the full
 * reasoning.
 *
 * `timestamps: false` because `ran_at` is the meaningful time; a Sequelize
 * createdAt would be a second, near-identical timestamp with no consumer.
 */
@Table({ tableName: 'backup_drill', timestamps: false })
class BackupDrillEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: string;

  /** The dump the drill ran against. A filename, never a foreign key. */
  @Column({ type: DataType.STRING, allowNull: false })
  declare backup_filename: string;

  /** When the drill completed. */
  @Column({ type: DataType.DATE, allowNull: false })
  declare ran_at: Date;

  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare passed: boolean;

  /** Short, fixed-literal failure reason. Never credentials, never dump content. */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare detail: string | null;
}

db.addModels([BackupDrillEntity]);

export { BackupDrillEntity };
