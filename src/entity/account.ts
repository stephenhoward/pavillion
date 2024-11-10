import { Model, InferAttributes, InferCreationAttributes, Sequelize, DataTypes } from 'sequelize';
import db from './db';

class AccountEntity extends Model<InferAttributes<AccountEntity>,InferCreationAttributes<AccountEntity>> {

    declare id: string;
    declare username: string;
    declare email: string;
};

AccountEntity.init({
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    username: DataTypes.STRING,
    email: DataTypes.STRING,
},{
    sequelize: db,
    tableName: 'account'
});

const ProfileEntity = db.define('profile', {
    account_id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    username: DataTypes.STRING,
    description: DataTypes.STRING,
    url: DataTypes.STRING
});

class AccountSecretsEntity extends Model<InferAttributes<AccountSecretsEntity>,InferCreationAttributes<AccountSecretsEntity>> {
    declare account_id: string;
    declare salt: string;
    declare password: string;
    declare url_verification_code: string;
};

AccountSecretsEntity.init({
    account_id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    salt: DataTypes.STRING,
    password: DataTypes.STRING,
    url_verification_code: DataTypes.STRING
},{
    sequelize: db,
    tableName: 'account_secrets'
});

ProfileEntity.belongsTo(AccountEntity, {foreignKey: 'account_id'});
AccountSecretsEntity.belongsTo(AccountEntity, {foreignKey: 'account_id'});

export {
    AccountEntity,
    AccountSecretsEntity,
    ProfileEntity
};