import { Account } from '@/common/model/account';
import { CalendarEvent } from '@/common/model/events';
import { ActivityPubObject } from '@/server/activitypub/model/base'

class EventObject extends ActivityPubObject {
    date: Date;
    location: LocationObject|string;
    parentEvent: string = '';
    childEvents: string[] = [];
    categories: string[] = [];
    content: Record<string, APEventContent>;
    schedules: CalendarEventSchedule[];

    static eventUrl(account: Account, event: CalendarEvent|string ): string {
        let id = typeof event == 'string'
            ? event
            : event.id;

        return id.match('^https?:\/\/')
            ? id
            : 'https://'+account.domain+'/users/'+account.username+'/events/'+id;
    }

    constructor( account: Account, event: CalendarEvent ) {
        super();
        this.id = EventObject.eventUrl(account,event);

        this.date = event.date;
        this.content = event.toObject().content;

        if( event.parentEvent ) {
            this.parentEvent = event.parentEvent.id;
        }
    }
}

export { EventObject }