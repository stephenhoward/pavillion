import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey } from 'sequelize-typescript';

import { AccountEntity } from '@/server/common/entity/account';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import db from '@/server/common/entity/db';

@Table({ tableName: 'calendar' })
class CalendarEntity extends Model {

    @PrimaryKey
    @Column({ type: DataType.UUID })
    declare id: string;

    @ForeignKey(() => AccountEntity)
    @Column({ type: DataType.UUID })
    declare account_id: string;

    @Column({ type: DataType.STRING })
    declare url_name: string;

    toModel(): Calendar {
        return new Calendar( this.id, this.url_name );
    };

    static fromModel(calendar: Calendar): CalendarEntity {
        return CalendarEntity.build({
            id: calendar.id,
            account_id: calendar.accountId,
            url_name: calendar.urlName
        });
    }
};

@Table({ tableName: 'calendar_content' })
class CalendarContentEntity extends Model {
    @PrimaryKey
    @Column({ type: DataType.UUID }) 
    declare id: string;
    
    @ForeignKey(() => CalendarEntity)
    @Column({ type: DataType.UUID })
    declare calendar_id: string;

    @Column({ type: DataType.STRING })
    declare language: string

    @Column({ type: DataType.STRING })
    declare name: string;

    @Column({ type: DataType.STRING })
    declare description: string;

    @BelongsTo(() => CalendarEntity)
    declare calendar: CalendarEntity;

    toModel(): CalendarContent {
        let content = new CalendarContent( this.language );
        content.name = this.name;
        content.description = this.description;

        return content;
    }

    static fromModel(content: CalendarContent): CalendarContentEntity {
        return CalendarContentEntity.build({
            language: content.language as string,
            name: content.name,
            description: content.description
        });
    }
};

db.addModels([CalendarEntity, CalendarContentEntity]);

export {
    CalendarEntity,
    CalendarContentEntity
};