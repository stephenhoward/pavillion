import { ActivityPubActivity } from '@/server/activitypub/model/base';

class DeleteActivity extends ActivityPubActivity {

  constructor( actorUrl: string, objectUrl: string ) {
    super(actorUrl);

    this.type = 'Delete';
    this.object = objectUrl;
    this.id = objectUrl + '/delete';
  }

  static fromObject(object: Record<string,any>): DeleteActivity | null {
    if (!object || typeof object !== 'object') {
      return null;
    }

    if (!object.actor || typeof object.actor !== 'string') {
      return null;
    }

    if (!object.object || typeof object.object !== 'string') {
      return null;
    }

    let activity = new DeleteActivity(object.actor, object.object);
    if ( object.id ) {
      activity.id = object.id;
    }

    return activity;
  }
}

export default DeleteActivity;
