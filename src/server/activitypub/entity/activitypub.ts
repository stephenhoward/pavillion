import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey } from 'sequelize-typescript';

import { event_activity } from '@/common/model/events';
import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import FollowActivity from '@/server/activitypub/model/action/follow';
import UndoActivity from '@/server/activitypub/model/action/undo';

// Define enum for auto-repost policy
enum AutoRepostPolicy {
  MANUAL = 'manual',         // No auto-repost, manual sharing only
  ORIGINAL = 'original',     // Auto-repost only events that originate from the followed calendar
  ALL = 'all',                // Auto-repost all events including those the followed calendar has reposted
}

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

    return builder( this.message );
  }
}

// messages from calendars from across the web
@Table({ tableName: 'ap_inbox'})
class ActivityPubInboxMessageEntity extends ActivityPubMessageEntity {
}

// messages from the calendar holder to their followers/ the public
@Table({ tableName: 'ap_outbox'})
class ActivityPubOutboxMessageEntity extends ActivityPubMessageEntity {
}

/**
 * Base class for calendar follow relationships with common properties
 */
abstract class BaseFollowEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare id: string;

  @Column({ type: DataType.STRING })
  declare remote_calendar_id: string;

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
    type: DataType.STRING,
    defaultValue: AutoRepostPolicy.MANUAL,
    allowNull: false,
    validate: {
      isIn: [[AutoRepostPolicy.MANUAL, AutoRepostPolicy.ORIGINAL, AutoRepostPolicy.ALL]],
    },
  })
  declare repost_policy: AutoRepostPolicy;
}

/**
 * Represents a remote calendar that is following the local calendar
 * This entity stores information about our followers
 */
@Table({ tableName: 'ap_follower'})
class FollowerCalendarEntity extends BaseFollowEntity {
  // Any follower-specific fields can be added here
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

  @Column({ type: DataType.STRING })
  declare event_id: string;

  @Column({ type: DataType.STRING })
  declare calendar_id: string;
}

// a list of activities (shares, etc) that other calendars have done to a calendar's
// own events
@Table({ tableName: 'ap_event_activity'})
class EventActivityEntity extends Model {

  @Column({ type: DataType.STRING })
  declare event_id: string;

  // TODO: Make this a proper enum? Or convert from enum in model to string in entity
  @Column({ type: DataType.STRING })
  declare type: event_activity;

  @Column({ type: DataType.STRING })
  declare remote_calendar_id: string;
}

// A collection of events that have been processed from an calendar's inbox,
// from calendars they follow
// TODO: Implement EventFeed functionality for ActivityPub
@Table({ tableName: 'ap_event_feed' })
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class EventFeed extends Model {

  @Column({ type: DataType.STRING })
  declare event_id: string;

  @Column({ type: DataType.STRING })
  declare calendar_id: string;
}

db.addModels([
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  FollowingCalendarEntity,
  FollowerCalendarEntity,
  SharedEventEntity,
  EventActivityEntity,
]);

export {
  ActivityPubMessageEntity,
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  FollowingCalendarEntity,
  FollowerCalendarEntity,
  SharedEventEntity,
  EventActivityEntity,
  AutoRepostPolicy,
};
