import { ActivityPubActivity, ActivityPubObject } from '../base';

/**
 * Hashtag representation for Flag activity tags.
 */
interface Hashtag {
  type: 'Hashtag';
  name: string;
}

/**
 * Flag activity for content reporting in ActivityPub.
 *
 * Represents a report or complaint about content, conforming to the
 * ActivityStreams Flag activity type. Used for cross-instance moderation.
 */
class FlagActivity extends ActivityPubActivity {
  type: 'Flag' = 'Flag';
  object: string | ActivityPubObject;
  content?: string;
  tag?: Hashtag[];
  summary?: string;
  published?: string;
  attributedTo?: string;

  constructor(
    id: string,
    actor: string,
    object: string | ActivityPubObject,
  ) {
    super(actor);
    this.id = id;
    this.type = 'Flag';
    this.object = object;
  }

  /**
   * Converts the Flag activity to a plain object for JSON serialization.
   *
   * @returns Plain object representation of the Flag activity
   */
  toObject(): Record<string, any> {
    const obj: Record<string, any> = {
      type: this.type,
      id: this.id,
      actor: this.actor,
      object: typeof this.object === 'string' ? this.object : this.object.toObject(),
    };

    // Include '@context' if present
    if (this['@context']) {
      obj['@context'] = this['@context'];
    }

    // Include optional fields if present
    if (this.to && this.to.length > 0) {
      obj.to = this.to;
    }

    if (this.content) {
      obj.content = this.content;
    }

    if (this.tag) {
      obj.tag = this.tag;
    }

    if (this.summary) {
      obj.summary = this.summary;
    }

    if (this.published) {
      obj.published = this.published;
    }

    if (this.attributedTo) {
      obj.attributedTo = this.attributedTo;
    }

    return obj;
  }

  /**
   * Creates a Flag activity from a plain object.
   *
   * @param obj - Plain object to parse
   * @returns FlagActivity instance or null if parsing fails
   */
  static fromObject(obj: any): FlagActivity | null {
    if (!obj || obj.type !== 'Flag') {
      return null;
    }

    if (!obj.id || !obj.actor || !obj.object) {
      return null;
    }

    const activity = new FlagActivity(obj.id, obj.actor, obj.object);

    // Set optional fields
    if (obj['@context']) {
      activity['@context'] = obj['@context'];
    }

    if (obj.to) {
      activity.to = Array.isArray(obj.to) ? obj.to : [obj.to];
    }

    if (obj.content) {
      activity.content = obj.content;
    }

    if (obj.tag) {
      activity.tag = obj.tag;
    }

    if (obj.summary) {
      activity.summary = obj.summary;
    }

    if (obj.published) {
      activity.published = obj.published;
    }

    if (obj.attributedTo) {
      activity.attributedTo = obj.attributedTo;
    }

    return activity;
  }
}

export default FlagActivity;
