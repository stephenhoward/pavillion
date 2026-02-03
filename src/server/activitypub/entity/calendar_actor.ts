import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey, Index, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import { CalendarEntity } from '@/server/calendar/entity/calendar';
import db from '@/server/common/entity/db';

/**
 * CalendarActor model for representing a calendar's ActivityPub Group actor.
 * Supports both local actors (linked to a calendar) and remote actors
 * (discovered via federation).
 */
export interface CalendarActor {
  id: string;
  actorType: 'local' | 'remote';
  calendarId: string | null;
  actorUri: string;
  remoteDisplayName: string | null;
  remoteDomain: string | null;
  inboxUrl: string | null;
  sharedInboxUrl: string | null;
  lastFetched: Date | null;
  publicKey: string | null;
  privateKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CalendarActorEntity
 *
 * Universal registry for both local and remote calendar ActivityPub actors.
 *
 * For local calendars (actor_type='local'):
 * - calendar_id is required (FK to CalendarEntity)
 * - private_key is required (for signing outgoing activities)
 * - public_key is required
 *
 * For remote calendars (actor_type='remote'):
 * - calendar_id is null
 * - private_key is null
 * - remote_display_name, remote_domain, inbox_url, shared_inbox_url are used
 * - last_fetched tracks metadata freshness
 */
@Table({ tableName: 'calendar_actor' })
class CalendarActorEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  /**
   * Discriminator: 'local' for calendars owned by this instance,
   * 'remote' for federated calendars discovered via ActivityPub.
   */
  @Column({ type: DataType.STRING(10), allowNull: false, defaultValue: 'local' })
  declare actor_type: 'local' | 'remote';

  /**
   * For local calendars: required FK to CalendarEntity
   * For remote calendars: null
   */
  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID, allowNull: true, unique: true })
  declare calendar_id: string | null;

  /**
   * The ActivityPub actor URI - always required, unique across all actors
   */
  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  declare actor_uri: string;

  // === Remote-only fields ===

  /**
   * Display name cached from remote actor profile.
   * Only used for remote actors.
   */
  @Column({ type: DataType.STRING, allowNull: true })
  declare remote_display_name: string | null;

  /**
   * Domain of the remote instance (e.g., "other.pavillion.io").
   * Only used for remote actors.
   */
  @Index
  @Column({ type: DataType.STRING, allowNull: true })
  declare remote_domain: string | null;

  /**
   * Inbox URL for delivering ActivityPub messages to this calendar.
   * Cached from the actor profile.
   */
  @Column({ type: DataType.STRING, allowNull: true })
  declare inbox_url: string | null;

  /**
   * Shared inbox URL for more efficient delivery (optional).
   */
  @Column({ type: DataType.STRING, allowNull: true })
  declare shared_inbox_url: string | null;

  /**
   * When the remote calendar's metadata was last fetched.
   * Used for cache invalidation.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare last_fetched: Date | null;

  // === Keys ===

  /**
   * Public key for signature verification.
   * For local: required. For remote: cached from remote actor.
   */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare public_key: string | null;

  /**
   * Private key for signing outgoing messages.
   * For local: required. For remote: null.
   */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare private_key: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @BelongsTo(() => CalendarEntity, { onDelete: 'CASCADE' })
  declare calendar: CalendarEntity;

  /**
   * Converts the entity to a plain CalendarActor object
   */
  toModel(): CalendarActor {
    return {
      id: this.id,
      actorType: this.actor_type,
      calendarId: this.calendar_id ?? null,
      actorUri: this.actor_uri,
      remoteDisplayName: this.remote_display_name ?? null,
      remoteDomain: this.remote_domain ?? null,
      inboxUrl: this.inbox_url ?? null,
      sharedInboxUrl: this.shared_inbox_url ?? null,
      lastFetched: this.last_fetched ?? null,
      publicKey: this.public_key ?? null,
      privateKey: this.private_key ?? null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a CalendarActorEntity from a CalendarActor model
   */
  static fromModel(calendarActor: CalendarActor): CalendarActorEntity {
    return CalendarActorEntity.build({
      id: calendarActor.id,
      actor_type: calendarActor.actorType,
      calendar_id: calendarActor.calendarId,
      actor_uri: calendarActor.actorUri,
      remote_display_name: calendarActor.remoteDisplayName,
      remote_domain: calendarActor.remoteDomain,
      inbox_url: calendarActor.inboxUrl,
      shared_inbox_url: calendarActor.sharedInboxUrl,
      last_fetched: calendarActor.lastFetched,
      public_key: calendarActor.publicKey,
      private_key: calendarActor.privateKey,
    });
  }
}

db.addModels([CalendarActorEntity]);

export { CalendarActorEntity };
