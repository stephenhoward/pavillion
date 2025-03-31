import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey } from 'sequelize-typescript';

import { Account, Profile } from '@/common/model/account';
import AccountInvitation from '@/common/model/invitation';
import AccountApplication from '@/common/model/application';
import db from '@/server/common/entity/db';

@Table({ tableName: 'account' })
class AccountEntity extends Model {

    @PrimaryKey
    @Column({ type: DataType.UUID })
    declare id: string;

    @Column({ type: DataType.STRING })
    declare username: string;

    @Column({ type: DataType.STRING })
    declare domain: string;

    @Column({ type: DataType.STRING })
    declare email: string;

    @Column({ type: DataType.STRING })
    declare language: string;

    toModel(): Account {
        let account = new Account( this.id, this.username, this.email );
        account.language = this.language;

        return account;
    };
};

@Table({ tableName: 'account_role' })
class AccountRoleEntity extends Model {
    @ForeignKey(() => AccountEntity)
    @Column({ type: DataType.UUID })
    declare account_id: string;

    @Column({ type: DataType.STRING })
    declare role: string;

    @BelongsTo(() => AccountEntity)
    declare account: AccountEntity;
}

@Table({ tableName: 'account_invitation' })
class AccountInvitationEntity extends Model {
    @PrimaryKey
    @Column({ type: DataType.UUID })
    declare id: string;

    @Column({ type: DataType.STRING })
    declare email: string;

    @Column({ type: DataType.STRING })
    declare message: string;

    @Column({ type: DataType.STRING })
    declare invitation_code: string;

    toModel(): AccountInvitation {
        return new AccountInvitation(this.id, this.email, this.message);
    }
};

@Table({ tableName: 'account_application' })
class AccountApplicationEntity extends Model {
    @PrimaryKey
    @Column({ type: DataType.UUID })
    declare id: string;

    @Column({ type: DataType.STRING })
    declare email: string;

    @Column({ type: DataType.STRING })
    declare message: string;

    toModel(): AccountApplication {
        return new AccountApplication( this.id, this.email, this.message );
    };

};

@Table({ tableName: 'profile' })
class ProfileEntity extends Model {
    @ForeignKey(() => AccountEntity)
    @PrimaryKey
    @Column({ type: DataType.UUID })
    declare account_id: string;

    @Column({ type: DataType.STRING })
    declare description: string;

    @Column({ type: DataType.STRING })
    declare url: string;

    @BelongsTo(() => AccountEntity)
    declare account: AccountEntity;

    toModel(): Profile {
        return Profile.fromObject({
            id: this.account_id,
            description: this.description,
            url: this.url
        });
    };
};

@Table({ tableName: 'account_secrets' })
class AccountSecretsEntity extends Model {
    @ForeignKey(() => AccountEntity)
    @PrimaryKey
    @Column({ type: DataType.UUID })
    declare account_id: string;

    @Column({ type: DataType.STRING })
    declare salt: string | null;

    @Column({ type: DataType.STRING })
    declare password: string | null;

    @Column({ type: DataType.STRING })
    declare url_verification_code: string | null;

    @Column({ type: DataType.STRING })
    declare password_reset_code: string | null;

    @Column({ type: DataType.DATE })
    declare password_reset_expiration: Date | null;

    @BelongsTo(() => AccountEntity)
    declare account: AccountEntity;
};

db.addModels([AccountEntity, AccountRoleEntity, AccountSecretsEntity, AccountApplicationEntity, AccountInvitationEntity, ProfileEntity]);

export {
    AccountEntity,
    AccountRoleEntity,
    AccountSecretsEntity,
    AccountApplicationEntity,
    AccountInvitationEntity,
    ProfileEntity
};