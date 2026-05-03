import { Model, Table, Column, PrimaryKey, DataType } from 'sequelize-typescript';
import db from '@/server/common/entity/db';

@Table({ tableName: 'settings_content', timestamps: false })
class SettingsContentEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.STRING(5) })
  declare language: string;

  @Column({ type: DataType.TEXT })
  declare description: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare policy: string | null;
}

db.addModels([SettingsContentEntity]);

export default SettingsContentEntity;
