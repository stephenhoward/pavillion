import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity } from '@/server/activitypub/model/base';

/**
 * Represents a Reject activity in ActivityPub protocol.
 * Received when a peer refuses (or revokes) a Follow we sent.
 */
class RejectActivity extends ActivityPubActivity {

  /**
   * The embedded activity is reduced here, not by callers, so every
   * construction path stores only the identity reference.
   */
  constructor(actorUrl: string, objectActivity: unknown) {
    super(actorUrl);
    this.type = 'Reject';
    this.object = RejectActivity.reduceObject(objectActivity);
    this.id = actorUrl + '/rejects/' + uuidv4();
  }

  static fromObject(object: Record<string, any>): RejectActivity | null {
    if (!object || typeof object !== 'object') {
      return null;
    }

    if (!object.actor || typeof object.actor !== 'string') {
      return null;
    }

    if (!object.object) {
      return null;
    }

    let activity = new RejectActivity(object.actor, object.object);
    if (object.id) {
      activity.id = object.id;
    }
    return activity;
  }

  /**
   * Reduces an embedded accepted activity to the fields a consumer reads. The
   * retained fields and why each is needed:
   *   - `id`: the Accept(Flag) path acknowledges the forwarded report by the
   *     embedded Flag's id (`processRejectActivity`); on the wire, the Follow
   *     sender correlates the Reject to the Follow it sent by this id.
   *   - `type`: `processRejectActivity` discriminates `'Flag'` from `'Follow'`,
   *     and `acceptActivitySchema` requires `type` on an embedded object, so a
   *     peer validating with the same rule needs it.
   *   - `actor`: kept so the embedded Follow's sender is available.
   *   - `object`: the Reject(Follow) path reads it as the followed actor IRI. Kept only when it is a string — a Follow's
   *     object is always an IRI.
   * Nothing else is read by any consumer. Keeping the peer's payload would
   * make every inbound Reject an unbounded durable write into `ap_inbox` (the
   * inbound row stores the live model instance), and reducing in the
   * constructor keeps the outbound reply built in `processFollowAccount` and
   * `fromObject` from diverging.
   */
  private static reduceObject(object: unknown): string | Record<string, string> {
    if (typeof object !== 'object' || object === null) {
      return typeof object === 'string' ? object : '';
    }
    const reduced: Record<string, string> = {};
    for (const key of ['id', 'type', 'actor', 'object'] as const) {
      const value = (object as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        reduced[key] = value;
      }
    }
    return reduced;
  }
}

export default RejectActivity;
