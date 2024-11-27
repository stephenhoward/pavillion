import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey } from 'sequelize-typescript';
import db from './db';
import { CalendarEvent } from '../../../common/model/events';
import { AccountEntity } from './account';

@Table({ tableName: 'event' })
class EventEntity extends Model {
    @PrimaryKey
    @Column({ type: DataType.UUID })
    declare id: string;

    @ForeignKey(() => EventEntity)
    @Column({ type: DataType.UUID })
    declare parentEventId: string;

    @ForeignKey(() => AccountEntity)
    @Column({ type: DataType.UUID })
    declare accountId: string;

    @BelongsTo(() => EventEntity)
    declare parentEvent: EventEntity;

    @BelongsTo(() => AccountEntity)
    declare account: AccountEntity;

    toModel(): CalendarEvent {
        return new CalendarEvent( this.account.toModel(), this.id );
    };
};

@Table({ tableName: 'event_content' })
class EventContentEntity extends Model {
    @PrimaryKey
    @Column({ type: DataType.UUID }) 
    declare id: string;
    
    @ForeignKey(() => EventEntity)
    @Column({ type: DataType.UUID })
    declare event_id: string;

    @Column({ type: DataType.STRING })
    declare language: string

    @Column({ type: DataType.STRING })
    declare name: string;

    @Column({ type: DataType.STRING })
    declare description: string;

    @BelongsTo(() => EventEntity)
    declare event: EventEntity;
};

@Table({ tableName: 'event_schedule' })
class EventScheduleEntity extends Model {
    @PrimaryKey
    @Column({ type: DataType.UUID })
    declare id: string;

    @ForeignKey(() => EventEntity)
    @Column({ type: DataType.UUID })
    declare event_id: string;

    @Column({ type: DataType.STRING })
    declare timezone: string;

    @Column({ type: DataType.DATE })
    declare start_date: Date;

    @Column({ type: DataType.DATE })
    declare end_date: Date;

    @Column({ type: DataType.INTEGER })
    declare frequency: string;

    @Column({ type: DataType.INTEGER })
    declare interval: number;

    @Column({ type: DataType.INTEGER })
    declare count: number;

    @Column({ type: DataType.INTEGER })
    declare by_setpos: number;

    @Column({ type: DataType.INTEGER })
    declare by_month: number;

    @Column({ type: DataType.INTEGER })
    declare by_monthday: number;

    @Column({ type: DataType.INTEGER })
    declare by_year_day: number;

    @Column({ type: DataType.INTEGER })
    declare by_week_no: number;

    @Column({ type: DataType.INTEGER })
    declare by_weekday: number;

    @Column({ type: DataType.INTEGER })
    declare by_hour: number;

    @Column({ type: DataType.INTEGER })
    declare by_minute: number;

    @Column({ type: DataType.INTEGER })
    declare by_second: number;

    @BelongsTo(() => EventEntity)
    declare event: EventEntity;
};

db.addModels([EventEntity, EventContentEntity, EventScheduleEntity]);

export {
    EventEntity,
    EventContentEntity,
    EventScheduleEntity
};