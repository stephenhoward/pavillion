import { Account } from './account';

class CalendarEvent {
    account: Account;
    id: string = '';
    date: string = '';
    location: string = '';
    parentEvent: CalendarEvent | null = null;

    constructor(account: Account, id?: string, date?: string, location?: string) {
        this.account = account;
        this.id = id ?? '';
        this.date = date ?? '';
        this.location = location ?? '';
    }
};

enum language {
    EN = "en",
    ES = "es",
    FR = "fr",
    DE = "de",
    IT = "it"
};

class CalendarEventContent {
    event: CalendarEvent;
    language: language;
    name: string = '';
    description: string = '';

    constructor(event: CalendarEvent, language: language, name?: string, description?: string) {
        this.name = name ?? '';
        this.description = description ?? '';
        this.language = language;
        this.event = event;
    }
};

export {
    CalendarEvent, CalendarEventContent
}