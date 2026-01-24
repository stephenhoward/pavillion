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

import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

/**
 * RemoteCalendarAccess model for representing a local user's access to a remote calendar
 */
export interface RemoteCalendarAccess {
  id: string;
  accountId: string;
  remoteCalendarId: string;
  remoteCalendarActorUri: string;
  remoteCalendarInboxUrl: string | null;
  remoteCalendarDomain: string;
  grantedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * RemoteCalendarAccessEntity
 *
 * Represents a local user's editor access to a remote (federated) calendar.
 * This record is created when the local instance receives an ActivityPub notification
 * that one of its users has been granted editor access to a calendar on another instance.
 *
 * This enables local event creation to be proxied to the remote calendar:
 * 1. User calls POST /api/v1/events with a remote calendarId
 * 2. System looks up this entity to find the remote calendar's inbox URL
 * 3. System sends ActivityPub Create activity to the remote inbox
 */
@Table({
  tableName: 'remote_calendar_access',
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['account_id', 'remote_calendar_id'],
      name: 'unique_remote_calendar_access',
    },
  ],
})
class RemoteCalendarAccessEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: () => uuidv4() })
  declare id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  @Index
  declare account_id: string;

  /**
   * The UUID of the remote calendar (as known on the remote instance)
   * This is used to match incoming event creation requests
   */
  @Column({ type: DataType.UUID, allowNull: false })
  @Index
  declare remote_calendar_id: string;

  /**
   * The ActivityPub actor URI of the remote calendar
   * e.g., https://alpha.federation.local/calendars/events
   */
  @Column({ type: DataType.STRING, allowNull: false })
  declare remote_calendar_actor_uri: string;

  /**
   * The inbox URL for the remote calendar's actor
   * Used for sending Create/Update/Delete activities
   */
  @Column({ type: DataType.STRING, allowNull: true })
  declare remote_calendar_inbox_url: string | null;

  /**
   * The domain of the remote instance
   * e.g., "alpha.federation.local"
   */
  @Column({ type: DataType.STRING, allowNull: false })
  declare remote_calendar_domain: string;

  /**
   * When the access was granted by the remote instance
   */
  @Column({ type: DataType.DATE, allowNull: false })
  declare granted_at: Date;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @BelongsTo(() => AccountEntity, { onDelete: 'CASCADE' })
  declare account: AccountEntity;

  /**
   * Converts the entity to a plain RemoteCalendarAccess object
   */
  toModel(): RemoteCalendarAccess {
    return {
      id: this.id,
      accountId: this.account_id,
      remoteCalendarId: this.remote_calendar_id,
      remoteCalendarActorUri: this.remote_calendar_actor_uri,
      remoteCalendarInboxUrl: this.remote_calendar_inbox_url,
      remoteCalendarDomain: this.remote_calendar_domain,
      grantedAt: this.granted_at,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a RemoteCalendarAccessEntity from a RemoteCalendarAccess model
   */
  static fromModel(access: RemoteCalendarAccess): RemoteCalendarAccessEntity {
    return RemoteCalendarAccessEntity.build({
      id: access.id,
      account_id: access.accountId,
      remote_calendar_id: access.remoteCalendarId,
      remote_calendar_actor_uri: access.remoteCalendarActorUri,
      remote_calendar_inbox_url: access.remoteCalendarInboxUrl,
      remote_calendar_domain: access.remoteCalendarDomain,
      granted_at: access.grantedAt,
    });
  }
}

db.addModels([RemoteCalendarAccessEntity]);

export { RemoteCalendarAccessEntity };
