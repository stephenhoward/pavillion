import {
  Model,
  Column,
  Table,
  ForeignKey,
  BelongsTo,
  DataType,
  PrimaryKey,
  Index,
  CreatedAt,
} from 'sequelize-typescript';

import { AccountEntity } from '@/server/common/entity/account';
import { NotificationActivityEntity } from '@/server/notifications/entity/notification_activity';

/**
 * NotificationRecipientEntity
 *
 * One row per (NotificationActivityEntity, Account) — the fan-out side of the
 * activity/recipient split introduced by the notifications domain redesign.
 *
 * Lifecycle fields:
 *   - `seen_at` is set when the recipient opens the inbox row.
 *   - `dismissed_at` is set either by explicit user action or by the
 *     object-scoped dismissal mechanism (e.g. `moderation:report:resolved` →
 *     `dismissForObject`).
 *
 * Schema decisions worth noting:
 *   - Unique `(notification_activity_id, account_id)` guards against
 *     double-fan-out within a single recordActivity call or concurrent
 *     retries. Cross-recipient dedup is enforced separately at the activity
 *     level.
 *   - `onDelete: 'CASCADE'` on `notification_activity_id` means recipient
 *     rows go away automatically when the 90-day activity retention pass
 *     deletes their parent.
 *   - `onDelete: 'CASCADE'` on `account_id` matches the DB-layer behavior
 *     in migration 0035: when an account is deleted, its inbox is gone too.
 *
 * No domain-model converters (toModel/fromModel): the read path eager-loads
 * the parent activity and projects directly to the HTTP response shape; the
 * write path inserts via entity columns. A separate domain model would add
 * no behavior the live paths use.
 */
@Table({
  tableName: 'notification_recipient',
  updatedAt: false,
  indexes: [
    {
      name: 'unique_notification_recipient_activity_account',
      unique: true,
      fields: ['notification_activity_id', 'account_id'],
    },
  ],
})
class NotificationRecipientEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => NotificationActivityEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare notification_activity_id: string;

  @ForeignKey(() => AccountEntity)
  @Index('idx_notification_recipient_account_created_at')
  @Column({ type: DataType.UUID, allowNull: false })
  declare account_id: string;

  @Column({ type: DataType.DATE, allowNull: true })
  declare seen_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare dismissed_at: Date | null;

  @Index('idx_notification_recipient_account_created_at')
  @CreatedAt
  declare created_at: Date;

  @BelongsTo(() => NotificationActivityEntity, {
    foreignKey: 'notification_activity_id',
    onDelete: 'CASCADE',
  })
  declare activity: NotificationActivityEntity;

  @BelongsTo(() => AccountEntity, {
    foreignKey: 'account_id',
    onDelete: 'CASCADE',
  })
  declare account: AccountEntity;
}

// Note: NotificationRecipientEntity is registered by NotificationActivityEntity
// in notification_activity.ts so both models are loaded in a single addModels
// call. This mirrors the EventSeriesEntity / EventSeriesContentEntity pattern
// and avoids a circular addModels call between the two files.

export { NotificationRecipientEntity };
