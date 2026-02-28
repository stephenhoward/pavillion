import { Table, Column, Model, DataType, PrimaryKey, CreatedAt, UpdatedAt, BelongsTo, ForeignKey, HasMany, Index } from 'sequelize-typescript';
import { EventSeries } from '@/common/model/event_series';
import { CalendarEntity } from './calendar';
import { EventSeriesContentEntity } from './event_series_content';
import db from '@/server/common/entity/db';

/**
 * Event series database entity.
 * Represents a named grouping of related events within a calendar.
 */
@Table({
  tableName: 'event_series',
  timestamps: true,
})
class EventSeriesEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Index({ name: 'idx_event_series_calendar_url_name', unique: true })
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'calendar_id',
  })
  declare calendar_id: string;

  @Index({ name: 'idx_event_series_calendar_url_name', unique: true })
  @Column({
    type: DataType.STRING(24),
    allowNull: false,
    field: 'url_name',
  })
  declare url_name: string;

  @Column({
    type: DataType.UUID,
    allowNull: true,
    field: 'media_id',
  })
  declare media_id: string | null;

  @CreatedAt
  declare created_at: Date;

  @UpdatedAt
  declare updated_at: Date;

  // Associations
  @BelongsTo(() => CalendarEntity)
  declare calendar: CalendarEntity;

  @HasMany(() => EventSeriesContentEntity)
  declare content: EventSeriesContentEntity[];

  /**
   * Convert entity to domain model.
   */
  toModel(): EventSeries {
    const model = new EventSeries(
      this.id,
      this.calendar_id,
      this.url_name,
      this.media_id ?? null,
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
  static fromModel(model: EventSeries): EventSeriesEntity {
    return EventSeriesEntity.build({
      id: model.id,
      calendar_id: model.calendarId,
      url_name: model.urlName,
      media_id: model.mediaId ?? null,
    });
  }
}

// Register both entities with Sequelize to ensure proper associations
db.addModels([EventSeriesEntity, EventSeriesContentEntity]);

export { EventSeriesEntity, EventSeriesContentEntity };
