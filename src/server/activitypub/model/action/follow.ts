import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity } from '@/server/activitypub/model/base';

class FollowActivity extends ActivityPubActivity {

  constructor( actorUrl: string, accountIdentifier: string ) {
    super(actorUrl);
    this.type = 'Follow';
    this.object = accountIdentifier;
    this.id = actorUrl + '/follows/'+ uuidv4();
  }

  static fromObject(object: Record<string,any>): FollowActivity | null {
    if (!object || typeof object !== 'object') {
      return null;
    }

    if (!object.actor || typeof object.actor !== 'string') {
      return null;
    }

    if (!object.object || typeof object.object !== 'string') {
      return null;
    }

    let activity = new FollowActivity(object.actor, object.object);
    if ( object.id ) {
      activity.id = object.id;
    }

    return activity;
  }
}

export default FollowActivity;
