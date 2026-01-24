import { Model, Column, Table, DataType, PrimaryKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import db from '@/server/common/entity/db';

/**
 * RemoteCalendar model for representing a remote calendar's cached metadata
 */
export interface RemoteCalendar {
  id: string;
  actorUri: string;
  displayName: string | null;
  inboxUrl: string | null;
  sharedInboxUrl: string | null;
  publicKey: string | null;
  lastFetched: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entity for caching remote calendar metadata from ActivityPub federation.
 *
 * This entity serves as the authoritative local reference for remote calendars
 * that we interact with through federation. Instead of storing AP URLs directly
 * in relationship tables (FollowingCalendar, FollowerCalendar, etc.), we store
 * a reference to this entity by UUID.
 *
 * Benefits:
 * - Consistent UUID-based foreign keys throughout the system
 * - Cached metadata reduces redundant federation lookups
 * - Single source of truth for remote calendar information
 * - Enables tracking of last fetch time for cache invalidation
 */
@Table({ tableName: 'remote_calendar' })
class RemoteCalendarEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  /**
   * The ActivityPub actor URI (e.g., https://example.com/calendars/events)
   * This is the canonical identifier for the remote calendar in the AP network.
   */
  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  declare actor_uri: string;

  /**
   * Cached display name from the remote calendar's actor profile.
   * May be null if not yet fetched or if remote doesn't provide one.
   */
  @Column({ type: DataType.STRING, allowNull: true })
  declare display_name: string | null;

  /**
   * The inbox URL for delivering ActivityPub messages to this calendar.
   * Cached from the actor profile to avoid repeated lookups.
   */
  @Column({ type: DataType.STRING, allowNull: true })
  declare inbox_url: string | null;

  /**
   * The shared inbox URL for delivering ActivityPub messages (if available).
   * Some servers support shared inboxes for more efficient delivery.
   */
  @Column({ type: DataType.STRING, allowNull: true })
  declare shared_inbox_url: string | null;

  /**
   * The public key PEM for verifying signatures from this remote calendar.
   * Cached from the actor profile's publicKey property.
   */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare public_key: string | null;

  /**
   * When the remote calendar's metadata was last fetched from the source.
   * Used for cache invalidation and refresh decisions.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare last_fetched: Date | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  /**
   * Converts the entity to a plain RemoteCalendar object
   */
  toModel(): RemoteCalendar {
    return {
      id: this.id,
      actorUri: this.actor_uri,
      displayName: this.display_name,
      inboxUrl: this.inbox_url,
      sharedInboxUrl: this.shared_inbox_url,
      publicKey: this.public_key,
      lastFetched: this.last_fetched,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a RemoteCalendarEntity from a RemoteCalendar model
   */
  static fromModel(remoteCalendar: RemoteCalendar): RemoteCalendarEntity {
    return RemoteCalendarEntity.build({
      id: remoteCalendar.id,
      actor_uri: remoteCalendar.actorUri,
      display_name: remoteCalendar.displayName,
      inbox_url: remoteCalendar.inboxUrl,
      shared_inbox_url: remoteCalendar.sharedInboxUrl,
      public_key: remoteCalendar.publicKey,
      last_fetched: remoteCalendar.lastFetched,
    });
  }
}

db.addModels([RemoteCalendarEntity]);

export { RemoteCalendarEntity };
