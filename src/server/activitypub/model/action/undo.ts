import { ActivityPubActivity } from '@/server/activitypub/model/base';

/**
 * The activity being undone, carried inline on the Undo's `object`. Used
 * for outbound Undo(Follow): peers (Mastodon among them) match an Undo to
 * the Follow it reverses by the embedded activity, not by the Follow id
 * alone, so a bare URI is not enough for them to drop the relationship.
 */
interface EmbeddedUndoTarget {
  id: string;
  type: string;
  actor: string;
  object: string;
}

type UndoTarget = string | EmbeddedUndoTarget;

class UndoActivity extends ActivityPubActivity {
  declare object: UndoTarget;

  /**
   * @param actorUrl - The actor performing the Undo
   * @param target - The undone activity's id, or the activity embedded
   *   inline. The Undo's own id is always `{targetId}/undo` either way.
   */
  constructor( actorUrl: string, target: UndoTarget ) {
    super(actorUrl);

    this.type = 'Undo';
    this.object = target;
    this.id = UndoActivity.targetIdOf(target) + '/undo';
  }

  /**
   * Resolves the id of the activity an Undo reverses. ActivityPub allows
   * `object` to be either the undone activity's URI or the activity itself
   * embedded inline (Mastodon sends the latter). Only the id is taken from
   * an embedded activity — its other contents are sender claims and must
   * never be trusted; the stored inbox row for that id is the source of
   * truth for what is undone.
   *
   * @param object - The Undo's `object` field, in either shape
   * @returns The target activity id, or null when neither shape yields one
   */
  static targetIdOf(object: unknown): string | null {
    if (typeof object === 'string') {
      return object || null;
    }
    if (object && typeof object === 'object') {
      const id = (object as Record<string, unknown>).id;
      return typeof id === 'string' && id ? id : null;
    }
    return null;
  }

  /**
   * Rebuilds an Undo from its wire form. An embedded `object` is kept as
   * sent so the outbox can re-serialize our own Undo(Follow) with the
   * Follow still inline; inbound handlers must keep resolving the target
   * through `targetIdOf` rather than reading the embedded contents.
   */
  static fromObject(object: Record<string,any>): UndoActivity | null {
    if (!object || typeof object !== 'object') {
      return null;
    }

    if (!object.actor || typeof object.actor !== 'string') {
      return null;
    }

    const targetId = UndoActivity.targetIdOf(object.object);
    if (!targetId) {
      return null;
    }

    const target: UndoTarget = typeof object.object === 'string' ? targetId : object.object;
    let activity = new UndoActivity(object.actor, target);
    if ( object.id ) {
      activity.id = object.id;
    }
    // Preserve the 'to' field if it exists
    if ( object.to && Array.isArray(object.to) ) {
      activity.to = object.to;
    }

    return activity;
  }
}

export default UndoActivity;
export type { EmbeddedUndoTarget, UndoTarget };
