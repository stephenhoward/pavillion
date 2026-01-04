import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import FollowActivity from '@/server/activitypub/model/action/follow';

/**
 * Represents an Accept activity in ActivityPub protocol.
 * Used to accept Follow requests and other activities.
 */
class AcceptActivity extends ActivityPubActivity {

  constructor(actorUrl: string, objectActivity: FollowActivity | any) {
    super(actorUrl);
    this.type = 'Accept';
    this.object = objectActivity;
    this.id = actorUrl + '/accepts/' + uuidv4();
  }

  static fromObject(object: Record<string, any>): AcceptActivity {
    let activity = new AcceptActivity(object.actor, object.object);
    if (object.id) {
      activity.id = object.id;
    }
    return activity;
  }
}

export default AcceptActivity;
