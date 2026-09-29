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

  /**
   * The embedded activity is reduced here, not by callers, so every
   * construction path — the outbound reply built from a raw inbound Join as
   * well as `fromObject` — stores only the identity reference.
   */
  constructor(actorUrl: string, objectActivity: unknown) {
    super(actorUrl);
    this.type = 'Ignore';
    this.object = IgnoreActivity.reduceObject(objectActivity);
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
    if (object.published) {
      const published = new Date(object.published);
      if (!isNaN(published.getTime())) {
        activity.published = published;
      }
    }
    // Preserve direct addressing so the delivered Ignore stays scoped to the
    // sender (never public).
    if (object.to && Array.isArray(object.to)) {
      activity.to = object.to;
    }
    return activity;
  }

  /**
   * Reduces an embedded ignored activity to its identity. The retained fields
   * and why each is needed:
   *   - `id`: FEP-8a8e correlation — the Join sender matches the reply to the
   *     Join it sent by the embedded activity's id.
   *   - `type`: tells the receiver which kind of activity was ignored without
   *     dereferencing `id` (and `ignoreActivitySchema` validates it).
   *   - `actor`: the outbox resolves delivery of Pavillion's own reply to
   *     `object.actor` — the Join sender.
   * Nothing else is read by any consumer. Keeping the peer's full payload would
   * make every inbound Join an unbounded durable write into `ap_outbox` (echoed
   * back to the peer), and every inbound Ignore one into `ap_inbox`.
   */
  private static reduceObject(object: unknown): string | Record<string, string> {
    if (typeof object !== 'object' || object === null) {
      return typeof object === 'string' ? object : '';
    }
    const reduced: Record<string, string> = {};
    for (const key of ['id', 'type', 'actor'] as const) {
      const value = (object as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        reduced[key] = value;
      }
    }
    return reduced;
  }
}

export default IgnoreActivity;
