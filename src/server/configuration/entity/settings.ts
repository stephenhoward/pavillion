import { Model, Table, Column, PrimaryKey, DataType } from 'sequelize-typescript';
import db from '@/server/common/entity/db';

@Table({ tableName: 'service_config' })
class ServiceSettingEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.STRING })
  declare parameter: string;

  @Column({ type: DataType.STRING })
  declare value: string;
}

db.addModels([ServiceSettingEntity]);

export default ServiceSettingEntity;
