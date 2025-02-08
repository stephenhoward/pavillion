import { Profile } from '@/common/model/account';
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

    static eventUrl(profile: Profile, event: CalendarEvent|string ): string {
        let id = typeof event == 'string'
            ? event
            : event.id;

        return id.match('^https?:\/\/')
            ? id
            : 'https://'+profile.domain+'/users/'+profile.username+'/events/'+id;
    }

    constructor( profile: Profile, event: CalendarEvent ) {
        super();
        this.id = EventObject.eventUrl(profile,event);

        this.date = event.date;
        this.content = event.toObject().content;

        if( event.parentEvent ) {
            this.parentEvent = event.parentEvent.id;
        }
    }
}

export { EventObject }