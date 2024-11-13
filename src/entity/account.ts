import { Model, InferAttributes, InferCreationAttributes, Sequelize, DataTypes } from 'sequelize';
import db from './db';

class AccountEntity extends Model<InferAttributes<AccountEntity>,InferCreationAttributes<AccountEntity>> {

    declare id: string;
    declare username: string;
    declare email: string;
};

AccountEntity.init({
    id: {
        type: DataTypes.UUID,
        primaryKey: true
    },
    username: DataTypes.STRING,
    email: DataTypes.STRING,
},{
    sequelize: db,
    tableName: 'account'
});

class AccountInvitationEntity extends Model<InferAttributes<AccountInvitationEntity>,InferCreationAttributes<AccountInvitationEntity>> {
    declare id: string;
    declare email: string;
    declare message: string;
    declare invitation_code: string;
};

AccountInvitationEntity.init({
    id: {
        type: DataTypes.UUID,
        primaryKey: true
    },
    email: DataTypes.STRING,
    message: DataTypes.STRING,
    invitation_code: DataTypes.STRING
},{
    sequelize: db,
    tableName: 'account_invitation'
});

class AccountApplicationEntity extends Model<InferAttributes<AccountApplicationEntity>,InferCreationAttributes<AccountApplicationEntity>> {
    declare id: string;
    declare email: string;
    declare message: string;
};

AccountApplicationEntity.init({
    id: {
        type: DataTypes.UUID,
        primaryKey: true
    },
    email: DataTypes.STRING,
    message: DataTypes.STRING
},{
    sequelize: db,
    tableName: 'account_application'
});

class ProfileEntity extends Model<InferAttributes<ProfileEntity>,InferCreationAttributes<ProfileEntity>> {
    declare account_id: string;
    declare username: string;
    declare description: string;
    declare url: string;
};

ProfileEntity.init({
    account_id: {
        type: DataTypes.UUID,
        primaryKey: true
    },
    username: DataTypes.STRING,
    description: DataTypes.STRING,
    url: DataTypes.STRING
},{
    sequelize: db,
    tableName: 'profile'
});

class AccountSecretsEntity extends Model<InferAttributes<AccountSecretsEntity>,InferCreationAttributes<AccountSecretsEntity>> {
    declare account_id: string;
    declare salt: string | null;
    declare password: string | null;
    declare url_verification_code: string | null;
    declare password_reset_code: string | null;
    declare password_reset_expiration: Date | null;
};

AccountSecretsEntity.init({
    account_id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    salt: DataTypes.STRING,
    password: DataTypes.STRING,
    url_verification_code: DataTypes.STRING,
    password_reset_code: DataTypes.STRING,
    password_reset_expiration: DataTypes.DATE
},{
    sequelize: db,
    tableName: 'account_secrets'
});

ProfileEntity.belongsTo(AccountEntity, {foreignKey: 'account_id'});
AccountSecretsEntity.belongsTo(AccountEntity, {foreignKey: 'account_id'});

export {
    AccountEntity,
    AccountSecretsEntity,
    AccountApplicationEntity,
    AccountInvitationEntity,
    ProfileEntity
};