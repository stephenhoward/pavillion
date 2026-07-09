import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity } from '@/server/activitypub/model/base';

/**
 * Represents an Ignore activity in the ActivityPub protocol.
 *
 * Pavillion emits Ignore in exactly one situation: to satisfy the FEP-8a8e
 * requirement that a server respond to a Join activity it does not handle with
 * an Ignore. Pavillion has no RSVP/attendance model (joinMode: 'none'), so a
 * Join is never actionable — the Ignore is a courtesy reply telling the sender
 * their Join was seen and deliberately not acted on.
 *
 * Structurally this mirrors AcceptActivity (a direct reply that embeds the
 * activity being responded to as its `object`), with a deterministic id of
 * `{actor}/ignores/{uuid}`. Unlike Accept, the reply is addressed directly to
 * the sender (never as:Public); `to` is preserved through fromObject so the
 * outbound wire payload round-trips the single-recipient addressing.
 */
class IgnoreActivity extends ActivityPubActivity {

  constructor(actorUrl: string, objectActivity: Record<string, any> | any) {
    super(actorUrl);
    this.type = 'Ignore';
    this.object = objectActivity;
    this.id = actorUrl + '/ignores/' + uuidv4();
  }

  static fromObject(object: Record<string, any>): IgnoreActivity | null {
    if (!object || typeof object !== 'object') {
      return null;
    }

    if (!object.actor || typeof object.actor !== 'string') {
      return null;
    }

    if (!object.object) {
      return null;
    }

    const activity = new IgnoreActivity(object.actor, object.object);
    if (object.id) {
      activity.id = object.id;
    }
    // Preserve direct addressing so the delivered Ignore stays scoped to the
    // sender (never public).
    if (object.to && Array.isArray(object.to)) {
      activity.to = object.to;
    }
    return activity;
  }
}

export default IgnoreActivity;
