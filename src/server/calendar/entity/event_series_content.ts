import { Table, Column, Model, DataType, PrimaryKey, BelongsTo, ForeignKey } from 'sequelize-typescript';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { EventSeriesEntity } from './event_series';

/**
 * Event series content database entity.
 * Represents translatable content for event series.
 */
@Table({
  tableName: 'event_series_content',
  timestamps: false,
})
export class EventSeriesContentEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => EventSeriesEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'series_id',
  })
  declare series_id: string;

  @Column({
    type: DataType.STRING(5),
    allowNull: false,
  })
  declare language: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare name: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare description: string | null;

  // Associations
  @BelongsTo(() => EventSeriesEntity)
  declare series: EventSeriesEntity;

  /**
   * Convert entity to domain model.
   */
  toModel(): EventSeriesContent {
    return new EventSeriesContent(
      this.language,
      this.name,
      this.description ?? '',
    );
  }

  /**
   * Create entity from domain model.
   */
  static fromModel(model: EventSeriesContent): EventSeriesContentEntity {
    return EventSeriesContentEntity.build({
      language: model.language,
      name: model.name,
      description: model.description || null,
    });
  }
}

// Note: EventSeriesContentEntity is registered by EventSeriesEntity
