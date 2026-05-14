import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity, ActivityPubObject } from '@/server/activitypub/model/base';

/**
 * ActivityPub Remove activity. Used in Pavillion to notify a remote actor
 * (e.g. a remote calendar editor) that they have been removed from a
 * collection such as a calendar's editor list. Mirrors {@link AddActivity}
 * — Add/Remove is the symmetric pair for collection-membership management
 * per AS2 §8.13. Remove uses explicit `to` targeting for single-recipient
 * delivery rather than follower fan-out.
 *
 * The receiving user actor inbox derives the calendar from `activity.actor`
 * (the calendar actor URI), so Remove does NOT carry the
 * `calendarId` / `calendarInboxUrl` extension fields that Add uses to seed
 * the initial editor-invite membership.
 */
class RemoveActivity extends ActivityPubActivity {

  target: string | ActivityPubObject = '';

  constructor( actorUrl: string, object: string | ActivityPubObject, target: string | ActivityPubObject = '' ) {
    super(actorUrl);
    this.type = 'Remove';
    this.object = object;
    this.target = target;
    const objectId = typeof object === 'string' ? object : object.id;
    this.id = objectId + '/removes/' + uuidv4();
  }

  static fromObject( json: Record<string, any> ): RemoveActivity | null {
    if (!json || typeof json !== 'object') {
      return null;
    }

    if (!json.actor || typeof json.actor !== 'string') {
      return null;
    }

    if (!json.object) {
      return null;
    }

    let activity = new RemoveActivity(json.actor, json.object, json.target ?? '');

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

export default RemoveActivity;
