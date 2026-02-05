import { ActivityPubActivity, ActivityPubObject } from '@/server/activitypub/model/base';

class CreateActivity extends ActivityPubActivity {

  constructor( actorUrl: string, object: ActivityPubObject ) {
    super(actorUrl);

    this.type = 'Create';
    this.object = object;
    this.id = object.id + '/create';
  }

  static fromObject( json: Record<string, any> ): CreateActivity | null {
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
    let activity = new CreateActivity(actor, object);

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

export default CreateActivity;
