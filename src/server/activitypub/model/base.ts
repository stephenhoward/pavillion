import { Profile } from '@/common/model/account';

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
    static actorUrl(profile: Profile|string ): string {
        let id = typeof profile == 'string'
            ? profile
            : profile.id;

        if( id.match('^https?:\/\/') ) {
            return id;
        }
        else if ( profile instanceof Profile ) {
            return 'https://'+profile.domain+'/users/'+profile.username+'/events/'+id;
        }

        throw('cannot generate url for this account profile: '+ profile);
    }
}

export { ActivityPubActivity, ActivityPubActor, ActivityPubObject };