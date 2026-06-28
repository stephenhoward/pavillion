import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey, BeforeCreate, Index } from 'sequelize-typescript';

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

  /**
   * Calendar this invitation grants editor access to, when set.
   *
   * Stored as a plain UUID rather than a typed @ForeignKey to CalendarEntity
   * to keep this accounts-domain entity decoupled from the calendar domain at
   * the data layer (see DEC-003). Null for admin invitations that grant no
   * calendar-scoped access.
   */
  @Index
  @Column({ type: DataType.UUID, allowNull: true })
  declare calendar_id: string;

  toModel(): AccountInvitation {
    return new AccountInvitation(this.id, this.email, this.inviter.toModel(), this.message, this.expiration_time, this.calendar_id, this.createdAt);
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
