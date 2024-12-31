import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey, HasMany } from 'sequelize-typescript';
import { DateTime } from 'luxon';

import { CalendarEvent, CalendarEventContent, CalendarEventSchedule, language } from '@/common/model/events';
import db from '@/server/common/entity/db';
import { LocationEntity } from '@/server/common/entity/location';
import { AccountEntity } from '@/server/common/entity/account';

@Table({ tableName: 'event' })
class EventEntity extends Model {
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        defaultValue: DataType.UUIDV4,
        allowNull: false
    })
    declare id: string;

    @ForeignKey(() => EventEntity)
    @Column({ type: DataType.UUID })
    declare parent_event_id: string;

    @ForeignKey(() => AccountEntity)
    @Column({ type: DataType.UUID })
    declare account_id: string;

    @ForeignKey(() => LocationEntity)
    @Column({ type: DataType.UUID })
    declare location_id: string;

    @BelongsTo(() => EventEntity)
    declare parentEvent: EventEntity;

    @BelongsTo(() => AccountEntity)
    declare account: AccountEntity;

    @HasMany(() => EventContentEntity)
    declare content: EventContentEntity[];

    @HasMany(() => EventScheduleEntity)
    declare schedules: EventScheduleEntity[];

    @BelongsTo(() => LocationEntity)
    declare location: LocationEntity;

    toModel(): CalendarEvent {
        return new CalendarEvent( this.account_id, this.id );
    };

    static fromModel(event: CalendarEvent): EventEntity {
        return EventEntity.build({
            id: event.id,
        });
    }
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

    toModel(): CalendarEventContent {
        let content = new CalendarEventContent( this.language as language );
        content.name = this.name;
        content.description = this.description;

        return content;
    }

    static fromModel(content: CalendarEventContent): EventContentEntity {
        return EventContentEntity.build({
            language: content.language as string,
            name: content.name,
            description: content.description
        });
    }
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

    @Column({ type: DataType.STRING })
    declare by_day: string;

    @Column({ type: DataType.BOOLEAN })
    declare is_exclusion: boolean;

    @BelongsTo(() => EventEntity)
    declare event: EventEntity;

    // TODO: use timezone field
    toModel(): CalendarEventSchedule {
        return CalendarEventSchedule.fromObject({
            id: this.id,
            start: DateTime.fromJSDate(this.start_date),
            end: DateTime.fromJSDate(this.end_date),
            frequency: this.frequency,
            interval: this.interval,
            count: this.count,
            byDay: this.by_day ? this.by_day.split(',') : [],
            isExclusion: this.is_exclusion
        });
    }

    // TODO: set timezone field
    static fromModel(schedule: CalendarEventSchedule): EventScheduleEntity {
        return EventScheduleEntity.build({
            id: schedule.id,
            start_date: schedule.startDate?.toJSDate(),
            end_date: schedule.endDate?.toJSDate(),
            frequency: schedule.frequency as string,
            interval: schedule.interval,
            count: schedule.count,
            by_day: schedule.byDay ? schedule.byDay.join(',') : '',
            is_exclusion: schedule.isExclusion
        });
    }
};

db.addModels([EventEntity, EventContentEntity, EventScheduleEntity]);

export {
    EventEntity,
    EventContentEntity,
    EventScheduleEntity
};