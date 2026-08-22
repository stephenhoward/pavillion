import config from 'config';
import { v4 as uuidv4 } from 'uuid';

import { Report } from '@/common/model/report';
import { CalendarEvent } from '@/common/model/events';
import FlagActivity from '@/server/activitypub/model/action/flag';

/**
 * Translates a Pavillion moderation report into the ActivityPub `Flag`
 * activity that carries it across a federation boundary.
 *
 * The moderation domain hands over its own models — a `Report` and the
 * `CalendarEvent` it is about — and names the recipient. Every choice below is
 * a protocol choice and belongs to no other domain: the minted Flag IRI, the
 * `@context`, a report category rendered as a hashtag, and which IRI names the
 * reported event. Moderation never sees the wire form, and nothing
 * ActivityPub-shaped crosses the interface boundary.
 */
class FlagActivityBuilder {
  private domain: string;

  /**
   * @param domain - This instance's domain (e.g. "local.instance.example").
   *   `domain` is the key this application defines; `server.domain` is not.
   */
  constructor(domain: string = config.get<string>('domain')) {
    this.domain = domain;
  }

  /**
   * Builds the Flag activity for a report leaving this instance.
   *
   * @param report - The report being forwarded
   * @param event - The event the report is about
   * @param senderActorUri - Actor URI of the calendar signing and sending the
   *   Flag. Every Flag is attributed to this calendar actor — admin-initiated
   *   reports included, since the admin's calendar carries them as courier and
   *   the activity `actor` must match the HTTP-Signature `keyId`.
   * @param recipientActorUri - The actor the Flag is addressed to
   * @returns A `FlagActivity` model, ready for the outbox
   */
  build(
    report: Report,
    event: CalendarEvent,
    senderActorUri: string,
    recipientActorUri: string,
  ): FlagActivity {
    const activity = new FlagActivity(
      `https://${this.domain}/flags/${uuidv4()}`,
      senderActorUri,
      this.reportedEventUri(event),
    );

    activity.to = [recipientActorUri];
    activity.content = report.description;
    activity.published = report.createdAt;
    activity['@context'] = 'https://www.w3.org/ns/activitystreams';
    activity.summary = `Event report: ${report.category}`;
    activity.tag = [{ type: 'Hashtag', name: `#${report.category}` }];

    return activity;
  }

  /**
   * The IRI naming the reported event on the instance that HOSTS it.
   *
   * For a remote event that is its `eventSourceUrl`. The local form names an
   * id this instance minted for its own copy of a federated event, which the
   * recipient cannot resolve — it would drop the report as referencing an
   * unknown event.
   */
  private reportedEventUri(event: CalendarEvent): string {
    if (event.isRemote() && event.eventSourceUrl) {
      return event.eventSourceUrl;
    }
    return `https://${this.domain}/events/${event.id}`;
  }
}

export default FlagActivityBuilder;
