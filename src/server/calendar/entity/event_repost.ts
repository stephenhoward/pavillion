import { Table, Column, Model, DataType, PrimaryKey, CreatedAt, ForeignKey, BelongsTo, Index } from 'sequelize-typescript';

import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEntity } from '@/server/calendar/entity/event';

/**
 * Event repost entity - tracks when a calendar reposts an event.
 *
 * This creates a link between an event (which may be owned by another calendar
 * or copied from a remote source) and a calendar that is reposting it.
 *
 * For local events: the event's calendar_id points to the original calendar,
 * and EventRepostEntity links it to calendars that repost it.
 *
 * For remote events: the event's calendar_id is null (AP origin tracked separately),
 * and EventRepostEntity links it to local calendars that repost it.
 */
@Table({
  tableName: 'event_repost',
  timestamps: true,
  updatedAt: false,
})
export class EventRepostEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => EventEntity)
  @Index('idx_event_repost_event_id')
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare event_id: string;

  @ForeignKey(() => CalendarEntity)
  @Index('idx_event_repost_calendar_id')
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare calendar_id: string;

  @CreatedAt
  declare created_at: Date;

  @BelongsTo(() => EventEntity)
  declare event: EventEntity;

  @BelongsTo(() => CalendarEntity)
  declare calendar: CalendarEntity;
}

db.addModels([EventRepostEntity]);
