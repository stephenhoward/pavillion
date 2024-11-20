import { Account } from './account';

type CalendarEvent = {
    account: string;
    id: string;
    date: string;
    location: string;
    organizer: Account;
};

enum language {
    EN = "en",
    ES = "es",
    FR = "fr",
    DE = "de",
    IT = "it"
};

type CalendarEventContent = {
    name: string;
    description: string;
    language: language;
};
