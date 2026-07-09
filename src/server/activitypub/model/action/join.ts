import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity } from '@/server/activitypub/model/base';

/**
 * Represents a Join activity in the ActivityPub protocol.
 *
 * Pavillion never originates a Join — it only ingests inbound Joins from peers
 * (e.g. Mobilizon) that model event attendance/RSVP as a Join(Event). Pavillion
 * has no attendance model (DEC-004: no attendee tracking; the Event is emitted
 * with joinMode: 'none'), so an inbound Join is never actionable. Per FEP-8a8e,
 * a server that does not handle a Join MUST respond with an Ignore; the inbox
 * dispatch does exactly that (see ProcessInboxService.processJoinActivity).
 *
 * This model exists so the inbound HTTP path can validate and enqueue a Join
 * like any other supported activity type. The `object` (the thing being joined)
 * may be either a URI string or an embedded object, so it is stored as-is.
 */
class JoinActivity extends ActivityPubActivity {

  constructor(actorUrl: string, objectIdentifier: string | Record<string, any>) {
    super(actorUrl);
    this.type = 'Join';
    this.object = objectIdentifier as any;
    this.id = actorUrl + '/joins/' + uuidv4();
  }

  static fromObject(object: Record<string, any>): JoinActivity | null {
    if (!object || typeof object !== 'object') {
      return null;
    }

    if (!object.actor || typeof object.actor !== 'string') {
      return null;
    }

    if (!object.object) {
      return null;
    }

    const activity = new JoinActivity(object.actor, object.object);
    if (object.id) {
      activity.id = object.id;
    }
    if (object.to && Array.isArray(object.to)) {
      activity.to = object.to;
    }
    return activity;
  }
}

export default JoinActivity;
