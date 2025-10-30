import { Table, Column, Model, DataType, PrimaryKey, CreatedAt, Index } from 'sequelize-typescript';
import { EventCategoryAssignmentModel } from '@/common/model/event_category_assignment';

/**
 * Event category assignment database entity.
 * Represents the many-to-many relationship between events and categories.
 *
 * CIRCULAR DEPENDENCY RESOLUTION:
 * To break the circular dependency with EventEntity, this entity defines foreign
 * keys manually without using @ForeignKey or @BelongsTo decorators. The associations
 * are established programmatically after model registration in event.ts.
 *
 * This avoids the circular import chain:
 * - event.ts would import event_category_assignment.ts (for @HasMany decorator)
 * - event_category_assignment.ts would import event.ts (for @BelongsTo decorator)
 *
 * Instead, both entities define their schemas independently, and associations
 * are wired up after both classes are fully loaded.
 */
@Table({
  tableName: 'event_category_assignments',
  timestamps: true,
  updatedAt: false, // Only track creation time for assignments
})
export class EventCategoryAssignmentEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @Index('idx_event_category_assignment_event_id')
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'event_id',
  })
  declare event_id: string;

  @Index('idx_event_category_assignment_category_id')
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'category_id',
  })
  declare category_id: string;

  @CreatedAt
  declare created_at: Date;

  /**
   * Associations defined programmatically in event.ts
   * to avoid circular dependencies.
   */
  declare event: any;
  declare category: any;

  /**
   * Convert entity to domain model.
   */
  toModel(): EventCategoryAssignmentModel {
    return new EventCategoryAssignmentModel(
      this.id,
      this.event_id,
      this.category_id,
      this.created_at,
    );
  }

  /**
   * Create entity from domain model.
   */
  static fromModel(model: EventCategoryAssignmentModel): EventCategoryAssignmentEntity {
    return EventCategoryAssignmentEntity.build({
      id: model.id,
      event_id: model.eventId,
      category_id: model.categoryId,
      created_at: model.createdAt,
    });
  }
}

// NOTE: EventCategoryAssignmentEntity is registered in event.ts
// along with EventEntity to ensure proper initialization order and
// to establish associations programmatically.
