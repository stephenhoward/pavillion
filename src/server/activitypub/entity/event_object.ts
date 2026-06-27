import { Table, Column, Model, DataType, PrimaryKey, CreatedAt, UpdatedAt, Index } from 'sequelize-typescript';

import db from '@/server/common/entity/db';

/**
 * EventObjectEntity - the canonical ActivityPub identity for EVERY event on
 * this instance, both local AND federated. There is exactly one row per event;
 * no event participates in federation without one.
 *
 * This entity stores the ActivityPub identity information for events,
 * linking local EventEntity records to their AP object IDs and
 * attributing them to their originating calendar actors.
 *
 * For local events: ap_id is the local AP URL, attributed_to is the local calendar actor.
 * For remote events: ap_id is the remote AP URL, attributed_to is the remote calendar actor.
 *
 * Lifecycle: the row exists before the event is dispatched anywhere. Local
 * events get their row in the eventCreated handler (see
 * src/server/activitypub/events/index.ts) before any outbox dispatch; remote
 * events get theirs at inbox-ingest time. The dispatch path reads
 * attributed_to for attribution and loop-guard checks, so a missing row is
 * never a valid state for a dispatched event — do not treat EventObjectEntity
 * as present only for federated inbox events.
 *
 * This replaces storing AP-specific information directly on EventEntity,
 * keeping the calendar domain focused on event data while the AP domain
 * handles federation identity.
 */
@Table({
  tableName: 'ap_event_object',
  timestamps: true,
})
export class EventObjectEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  /**
   * FK to EventEntity. Links this AP identity to a local event record.
   */
  @Index('idx_event_object_event_id')
  @Column({
    type: DataType.UUID,
    allowNull: false,
    unique: true,
  })
  declare event_id: string;

  /**
   * The full ActivityPub object ID (URL) for this event.
   * e.g., https://example.com/events/uuid or https://example.com/calendars/name/events/uuid
   */
  @Index('idx_event_object_ap_id')
  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  declare ap_id: string;

  /**
   * The ActivityPub actor URI of the calendar that created/owns this event.
   * e.g., https://example.com/calendars/name
   */
  @Index('idx_event_object_attributed_to')
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare attributed_to: string;

  /**
   * Source categories extracted from the incoming ActivityPub event payload.
   * Stores an array of { id: string, name?: string } objects parsed from
   * the categories[] URI array in the AP object, or null if not present.
   */
  @Column({ type: DataType.JSON, allowNull: true })
  declare source_categories: Array<{ id: string; name?: string }> | null;

  /**
   * Source series metadata extracted from the incoming ActivityPub event payload.
   * Stores a validated { id: string; name?: string; description?: string } object
   * parsed from the series field in the AP object, or null if not present.
   * All string fields are stored as plain text only.
   */
  @Column({ type: DataType.JSON, allowNull: true })
  declare source_series: { id: string; name?: string; description?: string } | null;

  @CreatedAt
  declare created_at: Date;

  @UpdatedAt
  declare updated_at: Date;
}

db.addModels([EventObjectEntity]);
