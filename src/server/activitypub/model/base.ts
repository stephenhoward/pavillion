import config from 'config';
import { Calendar } from '@/common/model/calendar';

const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

/** The base ActivityStreams 2.0 context IRI. */
const AS_CONTEXT = 'https://www.w3.org/ns/activitystreams';

/**
 * Stable, project-level vocabulary IRI for Pavillion's ActivityPub extension
 * terms (pavillion:content, pavillion:schedules, pavillion:place,
 * pavillion:space, pavillion:categories, pavillion:series, pavillion:urlPrompt).
 *
 * This is deliberately a SINGLE shared IRI across every Pavillion instance —
 * NOT a per-instance `https://{domain}/ns#` IRI. A per-domain IRI would make
 * the same term (e.g. `pavillion:content`) expand to a different IRI on each
 * instance, so cross-instance Pavillion payloads would not be JSON-LD-equivalent
 * and a strict processor would treat them as different properties. Pinning one
 * project namespace keeps federated Pavillion↔Pavillion payloads term-stable.
 */
const PAVILLION_NAMESPACE_IRI = 'https://pavillion.social/ns/activitypub#';

/**
 * JSON-LD @context term object mapping the `pavillion` prefix to the Pavillion
 * vocabulary IRI. Declaring this inside the @context array lets JSON-LD-strict
 * peers expand the pavillion:* extension terms instead of silently dropping
 * them.
 */
const PAVILLION_CONTEXT_TERM: Record<string, string> = { pavillion: PAVILLION_NAMESPACE_IRI };

/**
 * FEP-8a8e event-extension context document IRI (https://w3id.org/fep/8a8e).
 *
 * FEP-8a8e defines its event terms (displayEndTime, timezone, eventStatus) as
 * BARE, unprefixed top-level Event properties — unlike Pavillion's prefixed
 * pavillion:* terms. Per the FEP-8a8e spec examples, the vocabulary is pulled in
 * by listing its remote context document IRI as a plain string in the @context
 * array (NOT as a { prefix: IRI } mapping). Declaring it lets JSON-LD-strict
 * peers expand the bare FEP terms Pavillion emits on federated events instead of
 * silently dropping them.
 */
const FEP_8A8E_CONTEXT = 'https://w3id.org/fep/8a8e';

/**
 * Full ActivityStreams + FEP-8a8e + Pavillion JSON-LD @context. Used both for
 * the outbound activity envelope (below) and for standalone object/collection
 * responses (GET event/series and the series collection) that carry pavillion:*
 * and FEP-8a8e terms but are not wrapped in an activity envelope.
 */
const AP_CONTEXT: (string | Record<string, string>)[] = [AS_CONTEXT, FEP_8A8E_CONTEXT, PAVILLION_CONTEXT_TERM];

class ActivityPubActivity {
  // Spread AP_CONTEXT (single source of truth) into a fresh per-instance array
  // so instances never share a mutable reference.
  context: (string | Record<string, string>)[] = [...AP_CONTEXT];
  id: string = '';
  type: string = '';
  actor: string = '';
  object: string|ActivityPubObject = '';
  published: Date|null = null;
  to: string[] = [];
  cc: string[] = [];

  constructor(actorUrl: string) {
    this.actor = actorUrl;
  }

  /**
   * Address this activity to the public timeline, with the actor's followers
   * collection in cc. Sets published to the current time. Returns this so the
   * call can be chained onto the constructor.
   *
   * Required for public outbound activities (Announce/Create/Update/Delete) so
   * that AP consumers — including Mastodon — can render them on actor profiles
   * and timelines. Per ActivityPub §5.6 / §6, an activity is only treated as
   * public when it addresses as:Public in to or cc.
   */
  addressPublic(followersUrl: string): this {
    this.to = [AS_PUBLIC];
    this.cc = [followersUrl];
    this.published = new Date();
    return this;
  }

  toObject(): Record<string, any> {
    const result: Record<string, any> = {
      '@context': this.context,
      id: this.id,
      type: this.type,
      actor: this.actor,
      object: typeof this.object === 'object' && this.object !== null
        ? ('toActivityPubObject' in this.object
          ? (this.object as any).toActivityPubObject()
          : ('toObject' in this.object ? (this.object as any).toObject() : this.object))
        : this.object,
    };

    if (this.published) {
      result.published = this.published;
    }

    if (this.to && this.to.length > 0) {
      result.to = this.to;
    }

    if (this.cc && this.cc.length > 0) {
      result.cc = this.cc;
    }

    return result;
  }

  static fromObject( json: Record<string, any> ): ActivityPubActivity {
    let object = json.object;
    let actor = json.actor;
    let activity = new ActivityPubActivity(actor);
    activity.object = object;
    return activity;
  }
}

class ActivityPubObject {
  id: string = '';

  constructor() {}
}

class ActivityPubActor {
  static actorUrl(calendar: Calendar|string ): string {
    let id = typeof calendar == 'string'
      ? calendar
      : calendar.id;

    if( id.match('^https?:\/\/') ) {
      return id;
    }
    else if ( calendar instanceof Calendar ) {
      const domain = config.get('domain');
      return 'https://'+domain+'/calendars/'+calendar.urlName;
    }

    throw('cannot generate url for this account profile: '+ calendar);
  }
}

export {
  ActivityPubActivity,
  ActivityPubActor,
  ActivityPubObject,
  AS_PUBLIC,
  AS_CONTEXT,
  AP_CONTEXT,
  FEP_8A8E_CONTEXT,
  PAVILLION_NAMESPACE_IRI,
  PAVILLION_CONTEXT_TERM,
};
