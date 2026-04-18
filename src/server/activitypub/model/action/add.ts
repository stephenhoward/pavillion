import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity, ActivityPubObject } from '@/server/activitypub/model/base';

/**
 * ActivityPub Add activity. Used in Pavillion to notify a remote actor
 * (e.g. a remote calendar editor) that they have been added to a collection
 * such as a calendar's editor list. Add activities use explicit `to`
 * targeting for single-recipient delivery rather than follower fan-out.
 */
class AddActivity extends ActivityPubActivity {

  target: string | ActivityPubObject = '';

  constructor( actorUrl: string, object: string | ActivityPubObject, target: string | ActivityPubObject = '' ) {
    super(actorUrl);
    this.type = 'Add';
    this.object = object;
    this.target = target;
    const objectId = typeof object === 'string' ? object : object.id;
    this.id = objectId + '/adds/' + uuidv4();
  }

  static fromObject( json: Record<string, any> ): AddActivity | null {
    if (!json || typeof json !== 'object') {
      return null;
    }

    if (!json.actor || typeof json.actor !== 'string') {
      return null;
    }

    if (!json.object) {
      return null;
    }

    let activity = new AddActivity(json.actor, json.object, json.target ?? '');

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

  toObject(): Record<string, any> {
    const result = super.toObject();
    if (this.target) {
      result.target = typeof this.target === 'object' && this.target !== null
        ? ('toObject' in this.target ? (this.target as any).toObject() : this.target)
        : this.target;
    }
    return result;
  }
}

export default AddActivity;
