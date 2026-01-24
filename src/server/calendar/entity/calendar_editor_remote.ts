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
import db from '@/server/common/entity/db';

/**
 * RemoteEditor model for representing a remote (federated) user who has editor access
 */
export interface RemoteEditor {
  id: string;
  calendarId: string;
  actorUri: string;
  remoteUsername: string;
  remoteDomain: string;
  grantedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CalendarEditorRemoteEntity
 *
 * Represents a remote (federated) user who has been granted editor access to a calendar.
 * Unlike CalendarEditorPersonEntity which references local accounts, this entity stores
 * the ActivityPub actor URI of the remote user along with their username and domain.
 *
 * Remote editors can create, update, and delete events on the calendar via ActivityPub
 * federation - they send Create/Update/Delete activities to the calendar's inbox, which
 * are processed after verifying the actor is in this table.
 */
@Table({
  tableName: 'calendar_editor_remote',
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['calendar_id', 'actor_uri'],
      name: 'unique_calendar_editor_remote',
    },
  ],
})
class CalendarEditorRemoteEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: () => uuidv4() })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  @Index
  declare calendar_id: string;

  /**
   * The ActivityPub actor URI of the remote editor
   * e.g., https://beta.federation.local/users/Admin
   */
  @Column({ type: DataType.STRING, allowNull: false })
  @Index
  declare actor_uri: string;

  /**
   * The username portion of the remote editor's identity
   * e.g., "Admin" from user@beta.federation.local
   */
  @Column({ type: DataType.STRING, allowNull: false })
  declare remote_username: string;

  /**
   * The domain of the remote instance
   * e.g., "beta.federation.local"
   */
  @Column({ type: DataType.STRING, allowNull: false })
  declare remote_domain: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare granted_by: string;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @BelongsTo(() => CalendarEntity, { onDelete: 'CASCADE' })
  declare calendar: CalendarEntity;

  @BelongsTo(() => AccountEntity, { foreignKey: 'granted_by', as: 'grantor' })
  declare grantor: AccountEntity;

  /**
   * Converts the entity to a plain RemoteEditor object
   */
  toModel(): RemoteEditor {
    return {
      id: this.id,
      calendarId: this.calendar_id,
      actorUri: this.actor_uri,
      remoteUsername: this.remote_username,
      remoteDomain: this.remote_domain,
      grantedBy: this.granted_by,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a CalendarEditorRemoteEntity from a RemoteEditor model
   */
  static fromModel(remoteEditor: RemoteEditor): CalendarEditorRemoteEntity {
    return CalendarEditorRemoteEntity.build({
      id: remoteEditor.id,
      calendar_id: remoteEditor.calendarId,
      actor_uri: remoteEditor.actorUri,
      remote_username: remoteEditor.remoteUsername,
      remote_domain: remoteEditor.remoteDomain,
      granted_by: remoteEditor.grantedBy,
    });
  }
}

db.addModels([CalendarEditorRemoteEntity]);

export { CalendarEditorRemoteEntity };
