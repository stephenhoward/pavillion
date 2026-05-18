import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey, Index } from 'sequelize-typescript';

import { event_activity } from '@/common/model/events';
import { FollowingCalendar, FollowerCalendar } from '@/common/model/follow';
import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AcceptActivity from '@/server/activitypub/model/action/accept';
import UndoActivity from '@/server/activitypub/model/action/undo';

class ActivityPubMessageEntity extends Model {

  @PrimaryKey
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare id: string;

  @Column({ type: DataType.STRING })
  declare type: string;

  @Column({ type: DataType.DATE })
  declare message_time: Date;

  @Column({ type: DataType.JSON })
  declare message: object;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID })
  declare calendar_id: string;

  @Column({ type: DataType.DATE })
  declare processed_time: Date;

  @Column({ type: DataType.STRING })
  declare processed_status: string;

  @BelongsTo(() => CalendarEntity)
  declare calendar: CalendarEntity;

  toModel(): ActivityPubActivity {

    let builder;
    switch( this.type ) {
      case 'Create':
        builder = (object: any) => CreateActivity.fromObject(object);
        break;
      case 'Update':
        builder = (object: any) => UpdateActivity.fromObject(object);
        break;
      case 'Delete':
        builder = (object: any) => DeleteActivity.fromObject(object);
        break;
      case 'Follow':
        builder = (object: any) => FollowActivity.fromObject(object);
        break;
      case 'Accept':
        builder = (object: any) => AcceptActivity.fromObject(object);
        break;
      case 'Announce':
        builder = (object: any) => AnnounceActivity.fromObject(object);
        break;
      case 'Undo':
        builder = (object: any) => UndoActivity.fromObject(object);
        break;
    }

    if ( ! builder ) {
      throw new Error('Invalid message type: "' + this.type + '"');
    }

    const result = builder( this.message );
    if ( ! result ) {
      throw new Error('Failed to parse activity from message');
    }

    return result;
  }
}

// messages from calendars from across the web
@Table({ tableName: 'ap_inbox'})
class ActivityPubInboxMessageEntity extends ActivityPubMessageEntity {

  /**
   * Authentication mechanism that admitted this row to the inbox (DEC-012).
   * Open string enum; known values: `'http_signature'` (live inbox POST
   * verified by HTTP Signatures) and `'outbox_pull'` (follow-backfill
   * signed-GET outbox crawl). NOT NULL with a `'http_signature'` default
   * so pre-DEC-012 rows backfill on migration.
   *
   * Internal field. NOT serialized via `toModel()` and MUST NOT appear in
   * any API response — privacy: leaks how an instance authenticates inbound
   * federation traffic.
   */
  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    defaultValue: 'http_signature',
  })
  declare auth_source: string;

  /**
   * Verified origin (scheme + host) of the authenticating party — keyId
   * origin for HTTP signatures, outbox host for `outbox_pull`. Nullable
   * because the live HTTP path may fail to parse keyId.
   *
   * Internal field. NOT serialized via `toModel()` and MUST NOT appear in
   * any API response — privacy: leaks the verified remote-server identity
   * tied to each inbound activity.
   */
  @Column({
    type: DataType.STRING(2048),
    allowNull: true,
  })
  declare auth_origin: string | null;
}

// messages from the calendar holder to their followers/ the public
@Table({ tableName: 'ap_outbox'})
class ActivityPubOutboxMessageEntity extends ActivityPubMessageEntity {
}

/**
 * Base class for calendar follow relationships with common properties.
 *
 * Note: calendar_actor_id references CalendarActorEntity (remote actors only).
 * The actual AP actor URL is stored in CalendarActorEntity.actor_uri.
 */
abstract class BaseFollowEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare id: string;

  @ForeignKey(() => CalendarActorEntity)
  @Column({ type: DataType.UUID })
  declare calendar_actor_id: string;

  @BelongsTo(() => CalendarActorEntity)
  declare calendarActor: CalendarActorEntity;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID })
  declare calendar_id: string;

  @BelongsTo(() => CalendarEntity)
  declare calendar: CalendarEntity;
}

/**
 * Represents a remote calendar that the local calendar is following
 * This entity stores information about calendars we follow, including
 * auto-repost policy settings
 */
@Table({ tableName: 'ap_following'})
class FollowingCalendarEntity extends BaseFollowEntity {
  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  })
  declare auto_repost_originals: boolean;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  })
  declare auto_repost_reposts: boolean;

  toModel(): FollowingCalendar {
    return new FollowingCalendar(
      this.id,
      this.calendar_actor_id,
      this.calendar_id,
      this.auto_repost_originals,
      this.auto_repost_reposts,
    );
  }
}

/**
 * Represents a remote calendar that is following the local calendar
 * This entity stores information about our followers
 */
@Table({ tableName: 'ap_follower'})
class FollowerCalendarEntity extends BaseFollowEntity {
  toModel(): FollowerCalendar {
    return new FollowerCalendar(
      this.id,
      this.calendar_actor_id,
      this.calendar_id,
    );
  }
}

// a list of remote events the calendar has chosen to repost (share)
@Table({ tableName: 'ap_shared_event'})
class SharedEventEntity extends Model {

  @PrimaryKey
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare id: string;

  @Column({ type: DataType.UUID })
  declare event_id: string;

  @Column({ type: DataType.UUID })
  declare calendar_id: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  })
  declare auto_posted: boolean;
}

/**
 * Sticky dismissals of reposted events. A row here means "calendar X has
 * explicitly said this event should not appear on its calendar via
 * auto-repost." It gates only auto-repost creation; a manual re-share by
 * the calendar owner supersedes the dismissal.
 *
 * The unique index on (event_id, calendar_id) enforces the one-row-per-pair
 * invariant. The event_id FK cascades on delete so dismissals are cleaned
 * up automatically when the underlying local event row is deleted.
 */
@Table({ tableName: 'ap_repost_dismissal' })
class RepostDismissalEntity extends Model {

  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    allowNull: false,
  })
  declare id: string;

  @ForeignKey(() => EventEntity)
  @Index({ name: 'idx_ap_repost_dismissal_event_calendar', unique: true })
  @Column({ type: DataType.UUID, allowNull: false })
  declare event_id: string;

  @ForeignKey(() => CalendarEntity)
  @Index({ name: 'idx_ap_repost_dismissal_event_calendar', unique: true })
  @Column({ type: DataType.UUID, allowNull: false })
  declare calendar_id: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare dismissed_at: Date;

  @BelongsTo(() => EventEntity, { foreignKey: 'event_id', onDelete: 'CASCADE' })
  declare event: EventEntity;

  @BelongsTo(() => CalendarEntity, { foreignKey: 'calendar_id' })
  declare calendar: CalendarEntity;
}

/**
 * A list of activities (shares, etc) that other calendars have done to a calendar's
 * own events.
 *
 * Note: calendar_actor_id references CalendarActorEntity (remote actors only).
 * The actual AP actor URL is stored in CalendarActorEntity.actor_uri.
 */
@Table({ tableName: 'ap_event_activity'})
class EventActivityEntity extends Model {

  @Column({ type: DataType.STRING })
  declare event_id: string;

  // TODO: Make this a proper enum? Or convert from enum in model to string in entity
  @Column({ type: DataType.STRING })
  declare type: event_activity;

  @ForeignKey(() => CalendarActorEntity)
  @Column({ type: DataType.UUID })
  declare calendar_actor_id: string;

  @BelongsTo(() => CalendarActorEntity)
  declare calendarActor: CalendarActorEntity;
}

db.addModels([
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  FollowingCalendarEntity,
  FollowerCalendarEntity,
  SharedEventEntity,
  RepostDismissalEntity,
  EventActivityEntity,
]);

export {
  ActivityPubMessageEntity,
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  FollowingCalendarEntity,
  FollowerCalendarEntity,
  SharedEventEntity,
  RepostDismissalEntity,
  EventActivityEntity,
};
