import config from 'config';
import he from 'he';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { ActivityPubObject, ActivityPubActor } from '@/server/activitypub/model/base';
import { EventObject } from '@/server/activitypub/model/object/event';

/**
 * Sanitizes an untrusted href value from a federated peer. Returns a parsed
 * http(s) URL string or null for any anomaly (non-string, empty/whitespace,
 * too long, malformed, or non-http(s) scheme).
 *
 * Mirrors the helper in `event.ts` — duplicated here rather than re-exported
 * to keep `event.ts`'s helper private to that module. The two implementations
 * MUST stay in sync; both are the authoritative barrier against malicious
 * peers injecting javascript:, data:, ftp:, or other dangerous URL schemes.
 */
function sanitizeExternalUrlHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  }
  catch {
    return null;
  }
}

/**
 * Wraps a CalendarEvent as an ActivityStreams `Note` for Mastodon-class
 * consumers that ignore `type: 'Event'` activities on profile timelines.
 *
 * The Note is a thin presentation surface: a short HTML paragraph containing
 * the event title (linked to its canonical URL), the start time, and the
 * location (when present). Pavillion-aware peers continue to use the
 * companion `EventObject` activity; the Note exists purely so Mastodon
 * timelines render Pavillion posts at all.
 *
 * No `fromActivityPubObject` is implemented — Pavillion never ingests remote
 * Notes (they are minted on-the-wire by each instance to wrap its own canonical
 * Event). No `pavillion:*` extensions are emitted: this is an interop-only
 * rendering, not a Pavillion-to-Pavillion wire format.
 */
class NoteObject extends ActivityPubObject {
  type: string = 'Note';
  attributedTo: string;

  private readonly _calendar: Calendar;
  private readonly _event: CalendarEvent;
  private readonly _urlOverride: string | undefined;

  /**
   * Builds the canonical Note IRI for an event. Always anchored on the
   * configured instance domain (NEVER `req.host` — host-header spoofing risk
   * per security-playbook). The path is the event's canonical AP route with
   * a `/note` suffix so the Note IRI is dereferenceable independently of the
   * Event IRI.
   */
  static noteUrl(calendar: Calendar, event: CalendarEvent | string): string {
    const id = typeof event === 'string'
      ? event
      : event.id;

    return id.match('^https?:\/\/')
      ? `${id}/note`
      : 'https://' + config.get('domain') + '/calendars/' + calendar.urlName + '/events/' + id + '/note';
  }

  constructor(calendar: Calendar, event: CalendarEvent, options?: { urlOverride?: string }) {
    super();
    this._calendar = calendar;
    this._event = event;
    this._urlOverride = options?.urlOverride;
    this.id = NoteObject.noteUrl(calendar, event);

    // attributedTo is the calendar's actor URL — never an account IRI
    // (privacy-playbook federation rule).
    this.attributedTo = ActivityPubActor.actorUrl(calendar);
  }

  /**
   * Serializes this event as an AS `Note` suitable for Mastodon-class
   * consumers. The wire shape is intentionally minimal:
   *
   *   - `content` / `contentMap`: a short HTML paragraph with the title
   *     (linked), start time, and location.
   *   - `name` / `nameMap`: the bare event title.
   *
   * `name`/`nameMap` and `content`/`contentMap` use the same primary-language
   * selection rule and 2+-language gate as `EventObject`. Title and location
   * are HTML-escaped before interpolation (security-playbook template-injection
   * rule) — the only HTML produced by Pavillion is the wrapper `<p>` and the
   * anchor.
   */
  toActivityPubObject(): Record<string, any> {
    const domain = config.get('domain');
    const event = this._event;
    const calendar = this._calendar;

    // Determine primary language: prefer 'en' if event has en content with a
    // name, otherwise use the first language with a non-empty name. Mirrors
    // EventObject's primary-language pick.
    const primaryLanguage = event._content['en']?.name
      ? 'en'
      : Object.keys(event._content).find(l => event._content[l]?.name) || 'en';

    const primaryContent = event._content[primaryLanguage];
    let name = primaryContent?.name || 'Untitled Event';
    if (name === 'Untitled Event') {
      for (const lang of Object.keys(event._content)) {
        const c = event._content[lang];
        if (c.name && c.name.trim().length > 0) {
          name = c.name;
          break;
        }
      }
    }

    // Resolve the canonical event URL the Note's anchor links to. For
    // locally-owned events this is the event's own page; for re-shares the
    // caller passes `urlOverride` set to the remote canonical IRI, which is
    // validated through `sanitizeExternalUrlHref` so a malicious or malformed
    // override never lands in the anchor href. A failed override silently
    // omits `url` and the anchor's href falls back to the local event page.
    let resolvedUrl: string | null = null;
    if (this._urlOverride !== undefined) {
      resolvedUrl = sanitizeExternalUrlHref(this._urlOverride);
    }
    else {
      resolvedUrl = EventObject.eventUrl(calendar, event);
    }

    // Anchor href falls back to the local event URL when override validation
    // fails so the content HTML still renders a working link.
    const anchorHref = resolvedUrl ?? EventObject.eventUrl(calendar, event);

    const formattedStartTime = this._formatStartTime(event);

    const buildContent = (title: string, location: string | null): string => {
      const escapedTitle = he.encode(title);
      const escapedHref = he.encode(anchorHref);
      const locationSegment = location && location.trim().length > 0
        ? ` · ${he.encode(location)}`
        : '';
      return `<p><a href="${escapedHref}">${escapedTitle}</a> · ${formattedStartTime}${locationSegment}</p>`;
    };

    const locationName = event.location?.name ?? null;

    const result: Record<string, any> = {
      type: this.type,
      id: this.id,
      attributedTo: this.attributedTo,
      name: he.encode(name),
      content: buildContent(name, locationName),
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`https://${domain}/calendars/${calendar.urlName}/followers`],
    };

    // published: when the event was originally created (AS 2.0 vocabulary)
    if (event.createdAt) {
      result.published = event.createdAt.toISOString();
    }

    // url: canonical event page (Mobilizon parity). Omitted entirely when an
    // override was supplied but failed validation — the anchor href still
    // falls back to the local event page above so the Note remains useful.
    if (resolvedUrl !== null) {
      result.url = resolvedUrl;
    }

    // nameMap/contentMap: only when 2+ languages have content (mirrors
    // EventObject's gate). The map values are per-language renderings of the
    // same content shape.
    const contentLanguages = Object.keys(event._content).filter(
      lang => event._content[lang] && !event._content[lang].isEmpty(),
    );
    if (contentLanguages.length >= 2) {
      const nameMap: Record<string, string> = {};
      const contentMap: Record<string, string> = {};

      for (const lang of contentLanguages) {
        const c = event._content[lang];
        if (c.name) {
          nameMap[lang] = he.encode(c.name);
          contentMap[lang] = buildContent(c.name, locationName);
        }
      }

      if (Object.keys(nameMap).length > 0) {
        result.nameMap = nameMap;
      }
      if (Object.keys(contentMap).length > 0) {
        result.contentMap = contentMap;
      }
    }

    return result;
  }

  /**
   * Resolves a human-readable start-time string for the Note content. Uses
   * ISO 8601 so the rendered surface is locale-independent and unambiguous —
   * Mastodon clients render Note content verbatim, so the wire string is what
   * the user sees. Falls back to the event's date field, then to current time
   * (matching EventObject's defensive posture).
   */
  private _formatStartTime(event: CalendarEvent): string {
    const firstSchedule = event.schedules[0];
    if (firstSchedule?.startDate) {
      return firstSchedule.startDate.toISO()!;
    }

    if (event.date) {
      const parsed = DateTime.fromISO(String(event.date), { zone: 'utc' });
      if (parsed.isValid) {
        return parsed.toISO()!;
      }
    }

    return DateTime.utc().toISO()!;
  }
}

export { NoteObject };
