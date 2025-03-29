import config from 'config';
import { Model, PrimaryModel, TranslatedContentModel, TranslatedModel } from '@/common/model/model';

class Calendar extends TranslatedModel<CalendarContent> {
    urlName: string = '';
    languages: string[] = ['en'];
    description: string = '';
    domain: string = config.get('domain');
    _content: Record<string, CalendarContent> = {};

    protected createContent(language: string): CalendarContent {
        return new CalendarContent(language);
    }

    constructor (id?: string, urlName?: string) {
        super(id);
        this.urlName = urlName ?? '';
    };

    toObject(): Record<string,any> {
        return {
            id: this.id,
            urlName: this.urlName,
            description: this.description,
            languages: this.languages
        };
    };
    static fromObject(obj: Record<string,any>): Calendar {
        let calendar = new Calendar(obj.id, obj.urlName);
        calendar.languages = obj.languages;
        calendar.description = obj.description;
        return calendar;
    }

    clone(): Calendar { return Calendar.fromObject(this.toObject()); }
};

class CalendarContent extends Model implements TranslatedContentModel {
    language: string = 'en';
    name: string = '';
    description: string = '';

    constructor( language: string, name?: string, description?: string) {
        super();
        this.name = name ?? '';
        this.description = description ?? '';
        this.language = language;
    }

    static fromObject(obj: Record<string, any>): CalendarContent {
        return new CalendarContent(obj.language, obj.name, obj.description);
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
}

export { Calendar, CalendarContent }