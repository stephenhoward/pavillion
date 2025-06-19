import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey, BeforeCreate } from 'sequelize-typescript';

import { Account } from '@/common/model/account';
import AccountInvitation from '@/common/model/invitation';
import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';


@Table({ tableName: 'account_invitation' })
export default class AccountInvitationEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare invited_by: string;

  @BelongsTo(() => AccountEntity)
  declare inviter: AccountEntity;

  @Column({ type: DataType.STRING })
  declare email: string;

  @Column({ type: DataType.STRING })
  declare message: string;

  @Column({ type: DataType.STRING })
  declare invitation_code: string;

  @Column({ type: DataType.DATE })
  declare expiration_time: Date;

  toModel(): AccountInvitation {
    return new AccountInvitation(this.id, this.email, this.inviter.toModel(), this.message, this.expiration_time);
  }

  @BeforeCreate
  static setExpirationTime(instance: AccountInvitationEntity) {
    // Set expiration time to 1 week from now
    const oneWeekFromNow = new Date();
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
    instance.expiration_time = oneWeekFromNow;
  }
};

db.addModels([AccountInvitationEntity]);
