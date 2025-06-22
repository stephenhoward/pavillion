import { Table, Column, Model, DataType, PrimaryKey, CreatedAt, BelongsTo, ForeignKey } from 'sequelize-typescript';
import { EventCategoryAssignmentModel } from '@/common/model/event_category_assignment';
import { EventEntity } from './event';
import { EventCategoryEntity } from './event_category';
import db from '@/server/common/entity/db';

/**
 * Event category assignment database entity.
 * Represents the many-to-many relationship between events and categories.
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

  @ForeignKey(() => EventEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'event_id',
  })
  declare event_id: string;

  @ForeignKey(() => EventCategoryEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'category_id',
  })
  declare category_id: string;

  @CreatedAt
  declare created_at: Date;

  // Associations
  @BelongsTo(() => EventEntity)
  declare event: EventEntity;

  @BelongsTo(() => EventCategoryEntity)
  declare category: EventCategoryEntity;

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

// Register the assignment entity with Sequelize
db.addModels([EventCategoryAssignmentEntity]);
