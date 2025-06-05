import { Model, Table, Column, BelongsTo, DataType, ForeignKey } from 'sequelize-typescript';
import { DateTime } from 'luxon';
import db from '@/server/common/entity/db';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventEntity } from '@/server/calendar/entity/event';
import { CalendarEntity } from './calendar';

@Table({ tableName: 'event_instance' })
export class EventInstanceEntity extends Model {

  @ForeignKey(() => EventEntity)
  @Column({ type: DataType.UUID })
  declare event_id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID })
  declare calendar_id: string;

  @Column({ type: DataType.DATE })
  declare start_time: Date;

  @Column({ type: DataType.DATE })
  declare end_time: Date | null;

  @BelongsTo(() => EventEntity)
  declare event: EventEntity;

  toModel(): CalendarEventInstance {
    return new CalendarEventInstance(
      this.event.toModel(),
      DateTime.fromJSDate(this.start_time),
      this.end_time ? DateTime.fromJSDate(this.end_time) : null,
    );
  }
  static fromModel(eventInstance: CalendarEventInstance): EventInstanceEntity {
    return EventInstanceEntity.build({
      calendar_id: eventInstance.event.calendarId,
      event_id: eventInstance.event.id,
      start_time: eventInstance.start.toJSDate(),
      end_time: eventInstance.end ? eventInstance.end.toJSDate() : null,
    });
  }
}

db.addModels([EventInstanceEntity]);
