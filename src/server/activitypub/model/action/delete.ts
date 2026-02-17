import { ActivityPubActivity } from '@/server/activitypub/model/base';

class DeleteActivity extends ActivityPubActivity {

  constructor( actorUrl: string, objectUrl: string ) {
    super(actorUrl);

    this.type = 'Delete';
    this.object = objectUrl;
    this.id = objectUrl + '/delete';
  }

  static fromObject(object: Record<string,any>): DeleteActivity | null {
    if (!object || typeof object !== 'object') {
      return null;
    }

    if (!object.actor || typeof object.actor !== 'string') {
      return null;
    }

    // object.object can be a string URL (standard federation) or a Tombstone object
    // (cross-instance editor delete, where additional fields like eventId are needed)
    if (!object.object) {
      return null;
    }

    const objectValue = object.object;

    if (typeof objectValue !== 'string' && (typeof objectValue !== 'object' || !objectValue.id)) {
      return null;
    }

    // Extract the canonical URL for the object (used to build the activity ID)
    const objectUrl = typeof objectValue === 'string' ? objectValue : objectValue.id;

    let activity = new DeleteActivity(object.actor, objectUrl);

    // Preserve the full object (Tombstone or string) so processDeleteEvent can access fields
    activity.object = objectValue;

    if ( object.id ) {
      activity.id = object.id;
    }

    return activity;
  }
}

export default DeleteActivity;
