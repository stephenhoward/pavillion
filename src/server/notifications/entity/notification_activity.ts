import {
  Model,
  Column,
  Table,
  DataType,
  PrimaryKey,
  Index,
  CreatedAt,
  HasMany,
} from 'sequelize-typescript';

import db from '@/server/common/entity/db';
import { NotificationRecipientEntity } from '@/server/notifications/entity/notification_recipient';

/**
 * NotificationActivityEntity
 *
 * Persists one row per real-world event (in the AP sense: "Actor A performed
 * Verb V on Object O"), regardless of how many recipients see it. This
 * replaces the old single-table `notification` model and pairs with
 * NotificationRecipientEntity for fan-out.
 *
 * Schema decisions worth noting:
 *   - `object_id` deliberately has no FK constraint. The activity log is
 *     polymorphic and the `object_label` snapshot keeps the row renderable
 *     after the underlying object is deleted.
 *   - `actor_uri` is plain text, not a reference — remote actors are not
 *     local rows.
 *   - `actor_account_id` is nullable; it is only set when actor_kind='account'
 *     and is always NULL for Flag rows (Flag actor identity is anonymized at
 *     write time).
 *   - `verb`, `origin`, `actor_kind`, `object_type` are DB-level ENUMs so
 *     adding a value is a schema migration, not a config change. The
 *     corresponding TypeScript union types live in
 *     src/server/notifications/types.ts.
 *
 * No domain-model converters (toModel/fromModel): the write path inserts
 * directly via entity columns and the read path projects entities straight
 * to the HTTP response shape (see notifications API layer). A separate
 * domain model would add no behavior the live paths use.
 */
@Table({ tableName: 'notification_activity', updatedAt: false })
class NotificationActivityEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Column({
    type: DataType.ENUM(
      'Follow',
      'Announce',
      'Flag',
      'ReportEscalated',
      'ReportResolved',
      'EditorInvited',
      'EditorRevoked',
    ),
    allowNull: false,
  })
  declare verb: string;

  @Column({
    type: DataType.ENUM('local', 'federated'),
    allowNull: false,
  })
  declare origin: string;

  @Column({
    type: DataType.ENUM('account', 'remote_actor', 'anonymous', 'system'),
    allowNull: false,
  })
  declare actor_kind: string;

  // Deliberately no @ForeignKey — migration 0035 omits the `references` block
  // on `actor_account_id` so actor account deletion does not break the activity
  // log. The actor_display_name/url snapshots remain.
  @Column({ type: DataType.UUID, allowNull: true })
  declare actor_account_id: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare actor_uri: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare actor_display_name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare actor_display_url: string | null;

  @Column({
    type: DataType.ENUM('calendar', 'event', 'report'),
    allowNull: false,
  })
  declare object_type: string;

  // Deliberately no @ForeignKey — see class doc and.
  @Index('idx_notification_activity_object')
  @Column({ type: DataType.UUID, allowNull: false })
  declare object_id: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare object_label: string;

  @CreatedAt
  declare created_at: Date;

  // Cascade delete is configured at the DB layer in migration 0035 so the
  // 90-day retention pass drops recipient rows alongside their parent
  // activity automatically.
  @HasMany(() => NotificationRecipientEntity, {
    foreignKey: 'notification_activity_id',
    onDelete: 'CASCADE',
  })
  declare recipients: NotificationRecipientEntity[];
}

// Register both entities together so the associations resolve cleanly and to
// match the EventSeriesEntity / EventSeriesContentEntity pattern.
db.addModels([NotificationActivityEntity, NotificationRecipientEntity]);

export { NotificationActivityEntity, NotificationRecipientEntity };
