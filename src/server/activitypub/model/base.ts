import config from 'config';
import { Calendar } from '@/common/model/calendar';

const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

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

  /**
   * Address this activity to the public timeline, with the actor's followers
   * collection in cc. Sets published to the current time. Returns this so the
   * call can be chained onto the constructor.
   *
   * Required for public outbound activities (Announce/Create/Update/Delete) so
   * that AP consumers — including Mastodon — can render them on actor profiles
   * and timelines. Per ActivityPub §5.6 / §6, an activity is only treated as
   * public when it addresses as:Public in to or cc.
   */
  addressPublic(followersUrl: string): this {
    this.to = [AS_PUBLIC];
    this.cc = [followersUrl];
    this.published = new Date();
    return this;
  }

  toObject(): Record<string, any> {
    const result: Record<string, any> = {
      '@context': this.context,
      id: this.id,
      type: this.type,
      actor: this.actor,
      object: typeof this.object === 'object' && this.object !== null
        ? ('toActivityPubObject' in this.object
          ? (this.object as any).toActivityPubObject()
          : ('toObject' in this.object ? (this.object as any).toObject() : this.object))
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

export { ActivityPubActivity, ActivityPubActor, ActivityPubObject, AS_PUBLIC };
