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

  toObject(): Record<string, any> {
    const result: Record<string, any> = {
      '@context': this.context,
      id: this.id,
      type: this.type,
      actor: this.actor,
      object: typeof this.object === 'object' && this.object !== null && 'toObject' in this.object
        ? this.object.toObject()
        : this.object,
    };

    if (this.published) {
      result.published = this.published;
    }

    if (this.to && this.to.length > 0) {
      result.to = this.to;
    }

    if (this.cc && this.cc.length > 0) {
      result.cc = this.cc;
    }

    return result;
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
      return 'https://'+domain+'/calendars/'+calendar.urlName;
    }

    throw('cannot generate url for this account profile: '+ calendar);
  }
}

export { ActivityPubActivity, ActivityPubActor, ActivityPubObject };
