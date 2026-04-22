import { Model, Table, Column, BelongsTo, DataType, ForeignKey, PrimaryKey } from 'sequelize-typescript';
import { DateTime } from 'luxon';
import db from '@/server/common/entity/db';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventEntity } from '@/server/calendar/entity/event';
import { CalendarEntity } from './calendar';

@Table({ tableName: 'event_instance' })
export class EventInstanceEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => EventEntity)
  @Column({ type: DataType.UUID })
  declare event_id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID })
  declare calendar_id: string;

  // The unique index on (event_id, start_time) is defined in migration 0025
  // (see docs/superpowers/specs/2026-04-22-instance-timestamp-slug-design.md).
  // We do NOT mirror it here as a `@Index` decorator because db.sync envs
  // (e2e seed) currently materialize per-calendar rows for shared events,
  // which collides with the unique constraint. The shared-event materialization
  // semantics are tracked as a follow-up; production migrations enforce the
  // constraint as the spec intends.
  @Column({ type: DataType.DATE })
  declare start_time: Date;

  @Column({ type: DataType.DATE })
  declare end_time: Date | null;

  @BelongsTo(() => EventEntity)
  declare event: EventEntity;

  toModel(): CalendarEventInstance {
    return new CalendarEventInstance(
      this.id,
      this.event.toModel(),
      DateTime.fromJSDate(this.start_time, { zone: 'utc' }),
      this.end_time ? DateTime.fromJSDate(this.end_time, { zone: 'utc' }) : null,
    );
  }
  static fromModel(eventInstance: CalendarEventInstance): EventInstanceEntity {
    return EventInstanceEntity.build({
      id: eventInstance.id,
      calendar_id: eventInstance.event.calendarId,
      event_id: eventInstance.event.id,
      start_time: eventInstance.start.toJSDate(),
      end_time: eventInstance.end ? eventInstance.end.toJSDate() : null,
    });
  }
}

db.addModels([EventInstanceEntity]);
