import config from 'config';
import { Calendar } from '@/common/model/calendar';

class ActivityPubActivity {
    context: string[] = ['https://www.w3.org/ns/activitystreams'];
    id: string = '';
    type: string = '';
    actor: string = '';
    object: string|ActivityPubObject = '';
    published: Date|null = null;
    to: string[] = [];
    cc: string[] = [];

    constructor(actorUrl: string) {
        this.actor = actorUrl;
    }

    static fromObject( json: Record<string, any> ): ActivityPubActivity {
        let object = json.object;
        let actor = json.actor;
        let activity = new ActivityPubActivity(actor);
        activity.object = object;
        return activity;
      }
  }

class ActivityPubObject {
    id: string = '';

    constructor() {}
}

class ActivityPubActor {
    static actorUrl(calendar: Calendar|string ): string {
        let id = typeof calendar == 'string'
            ? calendar
            : calendar.id;

        if( id.match('^https?:\/\/') ) {
            return id;
        }
        else if ( calendar instanceof Calendar ) {
            const domain = config.get('domain');
            return 'https://'+domain+'/o/'+calendar.urlName;
        }

        throw('cannot generate url for this account profile: '+ calendar);
    }
}

export { ActivityPubActivity, ActivityPubActor, ActivityPubObject };