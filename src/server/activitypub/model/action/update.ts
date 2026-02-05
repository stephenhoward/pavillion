import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity, ActivityPubObject } from '@/server/activitypub/model/base';

class UpdateActivity extends ActivityPubActivity {

  constructor( actorUrl: string, object: ActivityPubObject ) {
    super(actorUrl);
    this.type = 'Update';
    this.object = object;
    this.id = object.id + '/updates/' + uuidv4();
  }

  static fromObject( json: Record<string, any> ): UpdateActivity | null {
    if (!json || typeof json !== 'object') {
      return null;
    }

    if (!json.actor || typeof json.actor !== 'string') {
      return null;
    }

    if (!json.object) {
      return null;
    }

    let object = json.object;
    let actor = json.actor;
    let activity = new UpdateActivity(actor, object);

    if (json.id) {
      activity.id = json.id;
    }
    if (json.to) {
      activity.to = json.to;
    }
    if (json.cc) {
      activity.cc = json.cc;
    }

    return activity;
  }
}

export default UpdateActivity;
