import { Table, Column, Model, DataType, PrimaryKey, CreatedAt, UpdatedAt, BelongsTo, ForeignKey } from 'sequelize-typescript';
import { CalendarEntity } from './calendar';
import { EventCategoryEntity } from './event_category';
import db from '@/server/common/entity/db';

/**
 * Calendar category mapping database entity.
 * Maps a remote (federated) event category to a local event category,
 * allowing calendar owners to normalise incoming category tags from
 * followed remote calendars into their own local category taxonomy.
 *
 * CIRCULAR DEPENDENCY NOTE:
 * source_calendar_actor_id references calendar_actor.id, but CalendarActorEntity
 * lives in the activitypub domain which already imports from the calendar domain.
 * To avoid a circular import chain, source_calendar_actor_id is defined as a plain
 * UUID column without @ForeignKey / @BelongsTo decorators.  The FK constraint is
 * still enforced at the database level via the migration.
 */
@Table({
  tableName: 'calendar_category_mappings',
  timestamps: true,
  underscored: true,
})
export class CalendarCategoryMappingEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'following_calendar_id',
  })
  declare following_calendar_id: string;

  /**
   * Plain UUID column — no @ForeignKey / @BelongsTo to avoid circular import
   * with the activitypub domain (CalendarActorEntity).  The FK constraint is
   * enforced in the migration SQL.
   */
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'source_calendar_actor_id',
  })
  declare source_calendar_actor_id: string;

  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'source_category_id',
  })
  declare source_category_id: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
    field: 'source_category_name',
  })
  declare source_category_name: string;

  @ForeignKey(() => EventCategoryEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'local_category_id',
  })
  declare local_category_id: string;

  @CreatedAt
  declare created_at: Date;

  @UpdatedAt
  declare updated_at: Date;

  // Associations
  @BelongsTo(() => CalendarEntity)
  declare followingCalendar: CalendarEntity;

  @BelongsTo(() => EventCategoryEntity)
  declare localCategory: EventCategoryEntity;

  /**
   * Convert entity to domain interface.
   */
  toModel(): CalendarCategoryMapping {
    return {
      id: this.id,
      followingCalendarId: this.following_calendar_id,
      sourceCalendarActorId: this.source_calendar_actor_id,
      sourceCategoryId: this.source_category_id,
      sourceCategoryName: this.source_category_name,
      localCategoryId: this.local_category_id,
      createdAt: this.created_at,
      updatedAt: this.updated_at,
    };
  }

  /**
   * Create entity from domain interface.
   */
  static fromModel(model: CalendarCategoryMapping): CalendarCategoryMappingEntity {
    return CalendarCategoryMappingEntity.build({
      id: model.id,
      following_calendar_id: model.followingCalendarId,
      source_calendar_actor_id: model.sourceCalendarActorId,
      source_category_id: model.sourceCategoryId,
      source_category_name: model.sourceCategoryName,
      local_category_id: model.localCategoryId,
    });
  }
}

db.addModels([CalendarCategoryMappingEntity]);

export { CalendarCategoryMappingEntity as default };

/**
 * Domain interface representing a single calendar category mapping record.
 * Kept co-located with the entity because the fields are simple enough that
 * a separate common/model file is unnecessary.
 */
export interface CalendarCategoryMapping {
  id: string;
  followingCalendarId: string;
  sourceCalendarActorId: string;
  sourceCategoryId: string;
  sourceCategoryName: string;
  localCategoryId: string;
  createdAt: Date;
  updatedAt: Date;
}
