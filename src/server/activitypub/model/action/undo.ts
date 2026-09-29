import { ActivityPubActivity } from '@/server/activitypub/model/base';

class UndoActivity extends ActivityPubActivity {

  constructor( actorUrl: string, objectUrl: string ) {
    super(actorUrl);

    this.type = 'Undo';
    this.object = objectUrl;
    this.id = objectUrl + '/undo';
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

    let activity = new UndoActivity(object.actor, targetId);
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
