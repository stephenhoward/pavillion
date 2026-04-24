import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  CreatedAt,
  UpdatedAt,
  Index,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';

import db from '@/server/common/entity/db';
import { EventEntity } from '@/server/calendar/entity/event';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';

/**
 * EventImportOriginEntity - ICS-import provenance metadata for events.
 *
 * This sibling entity carries the upstream-feed identity and sync bookkeeping
 * for events that were imported from an ICS source. Separating this metadata
 * into its own table keeps the core `event` row shape clean and hides import
 * provenance from the parent EventEntity (no reciprocal @HasOne — the parent
 * stays unaware by design, matching the RepostDismissalEntity precedent).
 *
 * Invariants:
 * - One-to-one with EventEntity: event_id is UNIQUE and the row lifecycle is
 *   tied to the event via ON DELETE CASCADE.
 * - One-to-many from ImportSourceEntity: a source may produce many event
 *   origin rows, and the row lifecycle is tied to the source via ON DELETE
 *   CASCADE.
 * - (import_source_id, external_uid, COALESCE(external_recurrence_id, ''))
 *   is unique — enforced by a dialect-specific functional/plain UNIQUE index
 *   created in migration 0028. See that migration for the COALESCE rationale.
 *
 * No toModel/fromModel and no model-class wrapper: this is an internal
 * service-consumed table that is never serialized over the wire. The
 * precedent is EventObjectEntity.
 *
 * @see bead pv-picz.1
 * @see migration 0028_create_event_import_origin.ts
 */
@Table({
  tableName: 'event_import_origin',
  timestamps: true,
  underscored: true,
})
class EventImportOriginEntity extends Model {

  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    allowNull: false,
  })
  declare id: string;

  @ForeignKey(() => EventEntity)
  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  declare event_id: string;

  @ForeignKey(() => ImportSourceEntity)
  @Index({ name: 'idx_event_import_origin_source' })
  @Column({ type: DataType.UUID, allowNull: false })
  declare import_source_id: string;

  @Column({ type: DataType.STRING(512), allowNull: false })
  declare external_uid: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare external_recurrence_id: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare source_last_modified: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare source_last_seen_at: Date | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare locally_edited: boolean;

  @Column({ type: DataType.JSON, allowNull: true })
  declare x_props: Record<string, unknown> | null;

  @CreatedAt
  declare created_at: Date;

  @UpdatedAt
  declare updated_at: Date;

  @BelongsTo(() => EventEntity, { foreignKey: 'event_id', onDelete: 'CASCADE' })
  declare event: EventEntity;

  @BelongsTo(() => ImportSourceEntity, { foreignKey: 'import_source_id', onDelete: 'CASCADE' })
  declare importSource: ImportSourceEntity;
}

db.addModels([EventImportOriginEntity]);

export { EventImportOriginEntity };
