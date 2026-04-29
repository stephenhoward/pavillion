import { Model, Table, Column, BelongsTo, DataType, ForeignKey, PrimaryKey, Index } from 'sequelize-typescript';
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

  @Index({ name: 'idx_event_instance_event_id_start_time_unique', unique: true })
  @ForeignKey(() => EventEntity)
  @Column({ type: DataType.UUID })
  declare event_id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID })
  declare calendar_id: string;

  // Compound unique index on (event_id, start_time) — matches migration 0025
  // (see docs/superpowers/specs/2026-04-22-instance-timestamp-slug-design.md).
  // Mirrors event_series.ts's compound-unique convention. Under the
  // single-producer model (pv-hr72) only the originating calendar materializes
  // a row per (event_id, start_time), so db.sync environments no longer collide
  // with this constraint.
  @Index({ name: 'idx_event_instance_event_id_start_time_unique', unique: true })
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
