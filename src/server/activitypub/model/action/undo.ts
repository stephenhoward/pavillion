import { ActivityPubActivity } from '@/server/activitypub/model/base';

class UndoActivity extends ActivityPubActivity {

  constructor( actorUrl: string, objectUrl: string ) {
    super(actorUrl);

    this.type = 'Undo';
    this.object = objectUrl;
    this.id = objectUrl + '/undo';
  }

  static fromObject(object: Record<string,any>): UndoActivity {

    let activity = new UndoActivity(object.actor, object.object);
    if ( object.id ) {
      activity.id = object.id;
    }

    return activity;
  }
}

export default UndoActivity;
