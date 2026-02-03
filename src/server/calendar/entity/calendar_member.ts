import {
  Model,
  Column,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
  PrimaryKey,
  Index,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';
import { v4 as uuidv4 } from 'uuid';

import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { AccountEntity } from '@/server/common/entity/account';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { CalendarMember } from '@/common/model/calendar_member';
import db from '@/server/common/entity/db';

/**
 * CalendarMemberEntity
 *
 * Unified join table for calendar ownership and editor relationships.
 * A member can be either an owner or an editor, and can be either a
 * local account (account_id) or a remote federated user (user_actor_id).
 *
 * Supports membership on both local calendars (via calendar_id) and
 * remote calendars (via calendar_actor_id).
 */
@Table({
  tableName: 'calendar_member',
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['calendar_id', 'account_id'],
      name: 'unique_calendar_member_account',
    },
    {
      unique: true,
      fields: ['calendar_id', 'user_actor_id'],
      name: 'unique_calendar_member_actor',
    },
    {
      unique: true,
      fields: ['calendar_actor_id', 'account_id'],
      name: 'unique_remote_calendar_member_account',
    },
  ],
})
class CalendarMemberEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: () => uuidv4() })
  declare id: string;

  /**
   * For membership on LOCAL calendars - FK to CalendarEntity.
   * Null when membership is on a remote calendar.
   */
  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  @Index
  declare calendar_id: string | null;

  /**
   * For membership on REMOTE calendars - FK to CalendarActorEntity (remote actors only).
   * Null when membership is on a local calendar.
   *
   * XOR constraint: Either calendar_id is set OR calendar_actor_id is set, never both.
   */
  @ForeignKey(() => CalendarActorEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  @Index
  declare calendar_actor_id: string | null;

  @Column({ type: DataType.STRING, allowNull: false })
  declare role: string;

  /**
   * Local account (for local users being members).
   * XOR constraint with user_actor_id.
   */
  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  @Index
  declare account_id: string | null;

  /**
   * Remote user actor (for remote users being members of local calendars).
   * XOR constraint with account_id.
   */
  @ForeignKey(() => UserActorEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  @Index
  declare user_actor_id: string | null;

  /**
   * Who granted the access (local account only).
   */
  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  declare granted_by: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @BelongsTo(() => CalendarEntity, { foreignKey: 'calendar_id', onDelete: 'CASCADE' })
  declare calendar: CalendarEntity;

  @BelongsTo(() => CalendarActorEntity, { foreignKey: 'calendar_actor_id', onDelete: 'CASCADE' })
  declare calendarActor: CalendarActorEntity;

  @BelongsTo(() => AccountEntity, { foreignKey: 'account_id' })
  declare account: AccountEntity;

  @BelongsTo(() => AccountEntity, { foreignKey: 'granted_by', as: 'grantor' })
  declare grantor: AccountEntity;

  @BelongsTo(() => UserActorEntity, { foreignKey: 'user_actor_id' })
  declare userActor: UserActorEntity;

  /**
   * Converts the entity to a CalendarMember domain model.
   *
   * @returns {CalendarMember} Domain model representation
   */
  toModel(): CalendarMember {
    return new CalendarMember(
      this.id,
      this.calendar_id,
      this.calendar_actor_id,
      this.role as 'owner' | 'editor',
      this.account_id,
      this.user_actor_id,
      this.granted_by,
    );
  }

  /**
   * Creates a CalendarMemberEntity from a CalendarMember domain model.
   *
   * @param {CalendarMember} member - Domain model to convert
   * @returns {CalendarMemberEntity} Entity instance
   */
  static fromModel(member: CalendarMember): CalendarMemberEntity {
    return CalendarMemberEntity.build({
      id: member.id,
      calendar_id: member.calendarId,
      calendar_actor_id: member.calendarActorId,
      role: member.role,
      account_id: member.accountId,
      user_actor_id: member.userActorId,
      granted_by: member.grantedBy,
    });
  }
}

db.addModels([CalendarMemberEntity]);

export { CalendarMemberEntity };
