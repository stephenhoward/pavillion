import config from 'config';
import { Account } from '@/common/model/account';

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
    static actorUrl(account: Account|string ): string {
        let id = typeof account == 'string'
            ? account
            : account.id;

        if( id.match('^https?:\/\/') ) {
            return id;
        }
        else if ( account instanceof Account ) {
            const domain = account.domain || config.get('domain');
            return 'https://'+domain+'/users/'+account.username+'/events/'+id;
        }

        throw('cannot generate url for this account profile: '+ account);
    }
}

export { ActivityPubActivity, ActivityPubActor, ActivityPubObject };