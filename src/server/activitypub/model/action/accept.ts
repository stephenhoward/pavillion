import { v4 as uuidv4 } from 'uuid';
import { ActivityPubActivity } from '@/server/activitypub/model/base';

/**
 * Represents an Accept activity in ActivityPub protocol.
 * Used to accept Follow requests and other activities.
 */
class AcceptActivity extends ActivityPubActivity {

  /**
   * The embedded activity is reduced here, not by callers, so every
   * construction path stores only the identity reference.
   */
  constructor(actorUrl: string, objectActivity: unknown) {
    super(actorUrl);
    this.type = 'Accept';
    this.object = AcceptActivity.reduceObject(objectActivity);
    this.id = actorUrl + '/accepts/' + uuidv4();
  }

  static fromObject(object: Record<string, any>): AcceptActivity | null {
    if (!object || typeof object !== 'object') {
      return null;
    }

    if (!object.actor || typeof object.actor !== 'string') {
      return null;
    }

    if (!object.object) {
      return null;
    }

    let activity = new AcceptActivity(object.actor, object.object);
    if (object.id) {
      activity.id = object.id;
    }
    return activity;
  }

  /**
   * Reduces an embedded accepted activity to the fields a consumer reads. The
   * retained fields and why each is needed:
   *   - `id`: the Accept(Flag) path acknowledges the forwarded report by the
   *     embedded Flag's id (`processAcceptActivity`); on the wire, the Follow
   *     sender correlates the Accept to the Follow it sent by this id.
   *   - `type`: `processAcceptActivity` discriminates `'Flag'` from `'Follow'`,
   *     and `acceptActivitySchema` requires `type` on an embedded object, so a
   *     peer validating with the same rule needs it.
   *   - `actor`: outbox delivery of Pavillion's own Accept resolves the
   *     recipient from `object.actor`.
   *   - `object`: the Accept(Follow) path reads it as the remote actor IRI to
   *     find the followed calendar. Kept only when it is a string — a Follow's
   *     object is always an IRI, and no consumer reads a Flag's embedded
   *     `object`.
   * Nothing else is read by any consumer. Keeping the peer's payload would
   * make every inbound Accept an unbounded durable write into `ap_inbox` (the
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

export default AcceptActivity;
