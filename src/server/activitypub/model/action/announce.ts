import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity, ActivityPubActor } from '@/server/activitypub/model/base';

class AnnounceActivity extends ActivityPubActivity {

  constructor( actorUrl: string, accountIdentifier: string ) {
    super(actorUrl);
    this.type = 'Announce';
    this.object = accountIdentifier;
    this.id = actorUrl + '/shares/'+ uuidv4();
  }

  static fromObject(object: Record<string,any>): AnnounceActivity {

    let activity = new AnnounceActivity(object.actor, object.object);
    if ( object.id ) {
      activity.id = object.id;
    }

    return activity;
  }
}

export default AnnounceActivity;
