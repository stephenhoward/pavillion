import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity, ActivityPubObject } from '@/server/activitypub/model/base';

class UpdateActivity extends ActivityPubActivity {
    
    constructor( actorUrl: string, object: ActivityPubObject ) {
        super(actorUrl);
        this.type = 'Update';
        this.object = object;
        this.id = object.id + '/updates/' + uuidv4();
    }

    static fromObject( json: Record<string, any> ): UpdateActivity {
        let object = json.object;
        let actor = json.actor;
        let activity = new UpdateActivity(actor, object);
          activity.id = json.id;
          activity.to = json.to;
          activity.cc = json.cc;
          return activity;
      }
  }

export default UpdateActivity;