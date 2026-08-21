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
   *   Flag. Ignored on the legacy admin-flag path, which attributes the Flag
   *   to the instance admin URI instead.
   * @param recipientActorUri - The actor the Flag is addressed to
   * @returns A `FlagActivity` model, ready for the outbox
   */
  build(
    report: Report,
    event: CalendarEvent,
    senderActorUri: string,
    recipientActorUri: string,
  ): FlagActivity {
    const admin = this.isAdminFlag(report);
    const actorUri = admin ? this.adminActorUri() : senderActorUri;

    const activity = new FlagActivity(
      `https://${this.domain}/flags/${uuidv4()}`,
      actorUri,
      this.reportedEventUri(event),
    );

    activity.to = [recipientActorUri];
    activity.content = report.description;
    activity.published = report.createdAt;

    if (admin) {
      activity.attributedTo = actorUri;
      activity.summary = `Admin report: ${report.category}`;
      activity.tag = [
        { type: 'Hashtag', name: '#admin-flag' },
        { type: 'Hashtag', name: `#priority-${report.adminPriority || 'low'}` },
      ];
    }
    else {
      activity['@context'] = 'https://www.w3.org/ns/activitystreams';
      activity.summary = `Event report: ${report.category}`;
      activity.tag = [{ type: 'Hashtag', name: `#${report.category}` }];
    }

    return activity;
  }

  /**
   * Whether a report takes the legacy admin-flag shape: attributed to
   * `https://<domain>/admin`, carrying `#admin-flag` and a priority tag.
   *
   * Only admin-initiated reports about *locally* hosted events do. An admin
   * report about a remote event has no owning local calendar (`calendarId` is
   * null) and travels as an ordinary calendar-actor Flag, signed by the
   * admin's primary calendar acting as courier, so that the activity `actor`
   * matches the HTTP-Signature `keyId`.
   *
   * The legacy shape carries a known signing mismatch — `https://<domain>/admin`
   * has no key entry in any actor table — kept here as it was rather than
   * fixed in passing. An instance-level admin actor is the fix.
   */
  private isAdminFlag(report: Report): boolean {
    return report.reporterType === 'administrator'
      && !!report.adminId
      && report.calendarId !== null;
  }

  /** The legacy instance-admin actor URI. See {@link isAdminFlag}. */
  private adminActorUri(): string {
    return `https://${this.domain}/admin`;
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
