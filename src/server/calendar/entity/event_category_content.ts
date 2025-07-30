import { Table, Column, Model, DataType, PrimaryKey, BelongsTo, ForeignKey } from 'sequelize-typescript';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { EventCategoryEntity } from './event_category';

/**
 * Event category content database entity.
 * Represents translatable content for event categories.
 */
@Table({
  tableName: 'event_category_content',
  timestamps: false,
})
export class EventCategoryContentEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => EventCategoryEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'category_id',
  })
  declare category_id: string;

  @Column({
    type: DataType.STRING(5),
    allowNull: false,
  })
  declare language: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare name: string;

  // Associations
  @BelongsTo(() => EventCategoryEntity)
  declare category: EventCategoryEntity;

  /**
   * Convert entity to domain model.
   */
  toModel(): EventCategoryContent {
    return new EventCategoryContent(
      this.language,
      this.name,
    );
  }

  /**
   * Create entity from domain model.
   */
  static fromModel(model: EventCategoryContent): EventCategoryContentEntity {
    return EventCategoryContentEntity.build({
      language: model.language,
      name: model.name,
    });
  }
}

// Note: EventCategoryContentEntity is registered by EventCategoryEntity
