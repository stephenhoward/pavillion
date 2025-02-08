import { Model, InferAttributes, InferCreationAttributes, DataTypes } from 'sequelize';
import db from '@/server/common/entity/db';

class ServiceSettingEntity extends Model<InferAttributes<ServiceSettingEntity>,InferCreationAttributes<ServiceSettingEntity>> {

    declare parameter: string;
    declare value: string;
};

ServiceSettingEntity.init({
    parameter: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    value: DataTypes.STRING,
},{
    sequelize: db,
    tableName: 'service_config'
});

export default ServiceSettingEntity;