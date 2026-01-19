import { Model, Column, Table, DataType, PrimaryKey } from 'sequelize-typescript';
import db from '@/server/common/entity/db';

/**
 * Backup metadata entity for tracking database backups.
 *
 * Stores metadata about each backup including filename, size, category,
 * and verification status for GFS retention policy management.
 */
@Table({ tableName: 'backup_metadata' })
class BackupEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare filename: string;

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare size_bytes: number;

  @Column({ type: DataType.DATE, allowNull: false })
  declare created_at: Date;

  @Column({ type: DataType.STRING, allowNull: false })
  declare type: 'manual' | 'scheduled';

  @Column({ type: DataType.STRING, allowNull: false })
  declare category: 'daily' | 'weekly' | 'monthly';

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare verified: boolean;

  @Column({ type: DataType.STRING, allowNull: false })
  declare storage_location: string;
}

db.addModels([BackupEntity]);

export { BackupEntity };
