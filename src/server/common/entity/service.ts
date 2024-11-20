import { Model, InferAttributes, InferCreationAttributes, Sequelize, DataTypes } from 'sequelize';
import db from './db';

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