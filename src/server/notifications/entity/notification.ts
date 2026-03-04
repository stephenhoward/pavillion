import {
  Model,
  Column,
  Table,
  ForeignKey,
  DataType,
  PrimaryKey,
  Index,
  CreatedAt,
} from 'sequelize-typescript';
import { v4 as uuidv4 } from 'uuid';

import { AccountEntity } from '@/server/common/entity/account';
import { Notification } from '@/common/model/notification';
import db from '@/server/common/entity/db';

/**
 * NotificationEntity
 *
 * Persists notifications for calendar owners and editors.
 * Supports two notification types:
 *   - 'follow': someone followed a calendar
 *   - 'repost': someone reposted an event from a calendar
 *
 * account_id is stored in the DB (so we know which account to notify)
 * but is excluded from toModel() output to avoid leaking internal IDs
 * through API responses.
 */
@Table({ tableName: 'notification', updatedAt: false })
class NotificationEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: () => uuidv4() })
  declare id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  @Index
  declare account_id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare type: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare calendar_id: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare event_id: string | null;

  @Column({ type: DataType.STRING(256), allowNull: false })
  declare actor_name: string;

  @Column({ type: DataType.STRING(2048), allowNull: true })
  declare actor_url: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare seen: boolean;

  @Index
  @CreatedAt
  declare created_at: Date;

  /**
   * Converts the entity to a Notification domain model.
   * Note: account_id is intentionally not included in the model.
   *
   * @returns {Notification} Domain model representation
   */
  toModel(): Notification {
    const notification = new Notification(this.id);
    notification.type = this.type;
    notification.calendarId = this.calendar_id;
    notification.eventId = this.event_id ?? null;
    notification.actorName = this.actor_name;
    notification.actorUrl = this.actor_url ?? null;
    notification.seen = this.seen;
    notification.createdAt = this.created_at ?? null;
    return notification;
  }

  /**
   * Creates a NotificationEntity from a Notification domain model.
   * Requires accountId as a separate parameter because account_id
   * is stored in the DB but not part of the Notification model.
   *
   * @param {Notification} notification - Domain model to convert
   * @param {string} accountId - The account to notify
   * @returns {NotificationEntity} Entity instance
   */
  static fromModel(notification: Notification, accountId: string): NotificationEntity {
    return NotificationEntity.build({
      id: notification.id,
      account_id: accountId,
      type: notification.type,
      calendar_id: notification.calendarId,
      event_id: notification.eventId ?? null,
      actor_name: notification.actorName,
      actor_url: notification.actorUrl ?? null,
      seen: notification.seen,
    });
  }
}

db.addModels([NotificationEntity]);

export { NotificationEntity };
