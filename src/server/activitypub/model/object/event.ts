import config from 'config';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { ActivityPubObject } from '@/server/activitypub/model/base';

class EventObject extends ActivityPubObject {
  type: string = 'Event';
  attributedTo: string;
  date: Date;
  location: LocationObject|string;
  parentEvent: string = '';
  childEvents: string[] = [];
  categories: string[] = [];
  content: Record<string, APEventContent>;
  schedules: CalendarEventSchedule[];

  static eventUrl(calendar: Calendar, event: CalendarEvent|string ): string {
    let id = typeof event == 'string'
      ? event
      : event.id;

    return id.match('^https?:\/\/')
      ? id
      : 'https://'+config.get('domain')+'/calendars/'+calendar.urlName+'/events/'+id;
  }

  constructor( calendar: Calendar, event: CalendarEvent ) {
    super();
    this.id = EventObject.eventUrl(calendar,event);

    // Set attributedTo to the calendar's actor URL
    const domain = config.get('domain');
    this.attributedTo = 'https://'+domain+'/calendars/'+calendar.urlName;

    this.date = event.date;
    this.content = event.toObject().content;

    if( event.parentEvent ) {
      this.parentEvent = event.parentEvent.id;
    }
  }
}

export { EventObject };
