import { Table, Column, Model, DataType, PrimaryKey, CreatedAt, UpdatedAt, BelongsTo, ForeignKey, HasMany } from 'sequelize-typescript';
import { EventCategory } from '@/common/model/event_category';
import { CalendarEntity } from './calendar';
import { EventCategoryContentEntity } from './event_category_content';
import db from '@/server/common/entity/db';

/**
 * Event category database entity.
 * Represents a tag or category that can be assigned to events within a calendar.
 */
@Table({
  tableName: 'event_categories',
  timestamps: true,
})
class EventCategoryEntity extends Model {
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
    field: 'calendar_id',
  })
  declare calendar_id: string;

  @CreatedAt
  declare created_at: Date;

  @UpdatedAt
  declare updated_at: Date;

  // Associations
  @BelongsTo(() => CalendarEntity)
  declare calendar: CalendarEntity;

  @HasMany(() => EventCategoryContentEntity)
  declare content: EventCategoryContentEntity[];

  /**
   * Convert entity to domain model.
   */
  toModel(): EventCategory {
    const model = new EventCategory(
      this.id,
      this.calendar_id,
    );

    if (this.content && this.content.length > 0) {
      for (const content of this.content) {
        model.addContent(content.toModel());
      }
    }

    return model;
  }

  /**
   * Create entity from domain model.
   */
  static fromModel(model: EventCategory): EventCategoryEntity {
    return EventCategoryEntity.build({
      id: model.id,
      calendar_id: model.calendarId,
    });
  }
}

// Register both entities with Sequelize to ensure proper associations
db.addModels([EventCategoryEntity, EventCategoryContentEntity]);

export { EventCategoryEntity, EventCategoryContentEntity };
