import { DateTime } from 'luxon';

import { Model, PrimaryModel, TranslatedModel, TranslatedContentModel } from '@/common/model/model';
import { EventLocation } from '@/common/model/location';


class CalendarEvent extends TranslatedModel<CalendarEventContent> {
    date: string = '';
    location: EventLocation | null = null;
    parentEvent: CalendarEvent | null = null;
    eventSourceUrl: string = '';
    _content: Record<string, CalendarEventContent> = {};
    schedules: CalendarEventSchedule[] = [];

    constructor(id?: string, date?: string, eventSourceUrl?: string, location?: EventLocation) {
        super(id);
        this.date = date ?? '';
        this.eventSourceUrl = eventSourceUrl ?? '';
        this.location = location ?? null;
    }

    protected createContent(language: string): CalendarEventContent {
        return new CalendarEventContent(language);
    }

    addSchedule(schedule?: CalendarEventSchedule) {
        if ( schedule ) {
            this.schedules.push(schedule);
        }
        else {
            this.schedules.push(new CalendarEventSchedule());
        }
    }

    dropSchedule(index: number) {
        if ( index < 0 || index >= this.schedules.length ) {
            throw new Error('Invalid schedule index');
        }
        this.schedules.splice(index, 1);
    }

    static fromObject(obj: Record<string, any>): CalendarEvent {
        let event = new CalendarEvent(obj.id, obj.date, obj.eventSourceUrl);

        event.location = obj.location ? EventLocation.fromObject(obj.location) : null;

        if ( obj.content ) {
            for( let [language,strings] of Object.entries(obj.content) ) {
                const content = CalendarEventContent.fromObject(strings as Record<string,any>);
                event.addContent(content);
            }
        }

        return event;
    }

    toObject(): Record<string, any> {
        return {
            id: this.id,
            date: this.date,
            location: this.location?.toObject(),
            eventSourceUrl: this.eventSourceUrl,
            content: Object.fromEntries(
                Object.entries(this._content)
                    .map(([language, strings]: [string, CalendarEventContent]) => [language, strings.toObject()])
            ),
            schedules: this.schedules.map(schedule => schedule.toObject())
        };
    }

    clone(): CalendarEvent { return CalendarEvent.fromObject(this.toObject()); }
};

enum language {
    EN = "en",
    ES = "es",
    FR = "fr",
    DE = "de",
    IT = "it"
};

enum event_activity {
    SHARE = "share",
}

class CalendarEventContent extends Model implements TranslatedContentModel {
    language: string;
    name: string = '';
    description: string = '';

    constructor( language: string, name?: string, description?: string) {
        super();
        this.name = name ?? '';
        this.description = description ?? '';
        this.language = language;
    }

    static fromObject(obj: Record<string, any>): CalendarEventContent {
        return new CalendarEventContent(obj.language, obj.name, obj.description);
    }

    toObject(): Record<string, any> {
        return {
            language: this.language,
            name: this.name,
            description: this.description
        };
    }

    isEmpty(): boolean {
        return this.name === '' && this.description === '';
    }
};

enum EventFrequency {
    DAILY = 'daily',
    WEEKLY = 'weekly',
    MONTHLY = 'monthly',
    YEARLY = 'yearly'
};

class CalendarEventSchedule extends Model {
    id: string = '';
    startDate: DateTime | null = null;
    endDate: DateTime | null = null;
    count: number = 0;
    frequency: EventFrequency | null = null;
    interval: number = 0;
    byDay: string[] = [];
    isExclusion: boolean = false;

    constructor(id?: string, startDate?: DateTime, endDate?: DateTime) {
        super();
        this.id = id ?? '';
        this.startDate = startDate ?? null;
        this.endDate = endDate ?? null;
    }

    static parseFrequency(freq: string): EventFrequency | null {
        const enumValues = Object.values(EventFrequency) as string[];
        const isValidRole = enumValues.includes(freq);
        return isValidRole ? freq as EventFrequency : null;
    }
    
    static fromObject(obj: Record<string, any>): CalendarEventSchedule {
        let start = obj.start
            ? DateTime.fromISO(obj.start)
            : undefined;

        let end = obj.end
            ? DateTime.fromISO(obj.end)
            : undefined;

            
        let schedule = new CalendarEventSchedule(obj.id, start, end);

        if ( obj.frequency ) {
            schedule.frequency = CalendarEventSchedule.parseFrequency(obj.frequency);
        }
        schedule.interval = obj.interval;
        schedule.count = obj.count;
        schedule.byDay = obj.byDay;
        schedule.isExclusion = obj.isException;

        return schedule;
    }

    toObject(): Record<string, any> {
        return {
            id: this.id,
            start: this.startDate?.toISO(),
            end: this.endDate?.toISO(),
            frequency: this.frequency as string,
            interval: this.interval,
            count: this.count,
            byDay: this.byDay,
            isException: this.isExclusion
        };
    }
}

export {
    CalendarEvent, CalendarEventContent, CalendarEventSchedule, language, event_activity, EventFrequency
}