import config from 'config';
import { CalendarEvent } from '@/common/model/events';
import { calendarPath } from '@/common/routing/public-paths';
import type { EventSourceActor } from '@/server/activitypub/interface';

/**
 * Contextual information needed to detect whether an event is a repost
 * and resolve its source calendar.
 */
export interface RepostContext {
  /** The event model to enrich */
  event: CalendarEvent;
  /** The calendar_id of the instance displaying this event */
  displayCalendarId: string;
  /** The event's owning calendar_id (null for remote/federated events) */
  eventCalendarId: string | null;
  /** The url_name from the eager-loaded CalendarEntity, if available */
  sourceCalendarUrlName?: string;
}

/**
 * Enriches events with sourceCalendar information based on repost status.
 *
 * Repost detection:
 * - event.calendarId === null -> remote repost (federated event)
 * - event.calendarId !== displayCalendarId -> local repost
 * - otherwise -> not a repost
 *
 * For local reposts, source calendar info is resolved from the eager-loaded
 * CalendarEntity. For remote reposts, the caller provides a pre-resolved map
 * of eventId -> source actor (fetched via ActivityPubInterface).
 *
 * @param contexts - Array of repost contexts to enrich
 * @param remoteSourceActorMap - Pre-resolved map of eventId to source actor
 */
export async function resolveSourceCalendars(
  contexts: RepostContext[],
  remoteSourceActorMap: Map<string, EventSourceActor>,
): Promise<void> {
  for (const ctx of contexts) {
    if (ctx.eventCalendarId === null) {
      // Remote repost — resolve via the pre-resolved source actor map.
      // Without SharedEventEntity context here we default to 'manual';
      // callers that know the actual auto/manual distinction should set it.
      if (ctx.event.repostStatus === 'none') {
        ctx.event.repostStatus = 'manual';
      }
      const sourceActor = remoteSourceActorMap.get(ctx.event.id);
      if (sourceActor) {
        const parsed = parseAttributedToUri(sourceActor.actorUri, sourceActor.pageUrl);
        if (parsed) {
          ctx.event.sourceCalendar = parsed;
        }
      }
    }
    else if (ctx.eventCalendarId !== ctx.displayCalendarId) {
      // Local repost — resolve from eager-loaded calendar data.
      // Default to 'manual' when no more specific status has been set.
      if (ctx.event.repostStatus === 'none') {
        ctx.event.repostStatus = 'manual';
      }
      if (ctx.sourceCalendarUrlName) {
        const domain: string = config.get('domain');
        // Our own domain, so the shared builder applies — unlike the remote
        // branch in parseAttributedToUri below, which must keep guessing the
        // retired spelling on a peer's host.
        ctx.event.sourceCalendar = {
          urlName: ctx.sourceCalendarUrlName,
          host: domain,
          url: calendarPath(ctx.sourceCalendarUrlName),
        };
      }
    }
    // else: not a repost — defaults are already correct
  }
}

/**
 * Parses an ActivityPub attributed_to URI to extract source calendar information.
 * Expected format: https://{host}/calendars/{urlName}
 *
 * `urlName` and `host` always come from the URI path — the site renders them as
 * the `urlName@host` label — so a peer that declares no page URL still gets its
 * repost attribution shown, just with a guessed link.
 *
 * The URI is trimmed before it is parsed, for the same reason the ActivityPub
 * domain trims it before pinning against it: `String.prototype.trim()` strips
 * NBSP, BOM and the Unicode space separators that the WHATWG parser does not.
 * Parsing the raw value here while the population side pinned against a trimmed
 * one made the two disagree on an axis the equivalence table cannot see (it
 * holds the actor URI constant) — a whitespace-prefixed `attributed_to` threw
 * internally and dropped the entire attribution, not just the declared link.
 *
 * @param uri - The attributed_to URI to parse
 * @param declaredPageUrl - The page URL the peer declared in its actor
 *   document, cached by the ActivityPub domain; null when we have none
 * @returns Source calendar info or null if parsing fails
 */
export function parseAttributedToUri(
  uri: string,
  declaredPageUrl?: string | null,
): { urlName: string; host: string; url: string } | null {
  try {
    const url = new URL(uri.trim());

    // Only allow HTTP(S) schemes — reject javascript:, data:, ftp:, etc.
    // to prevent stored XSS via crafted federation data.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    // Remove trailing slash and split path segments
    const segments = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);

    // Expected pattern: /calendars/{urlName}
    const calendarIndex = segments.indexOf('calendars');
    if (calendarIndex === -1 || calendarIndex + 1 >= segments.length) {
      return null;
    }

    const urlName = segments[calendarIndex + 1];

    // The peer's own declared `url` is the source of truth for its public page;
    // see DEC-018 rule 2. We fall back to guessing only when the peer declared
    // no usable one.
    //
    // The guess is `/view/{urlName}` — deliberately NOT the root shape DEC-018
    // gave our own pages — and this call site is exempt from the pv-l04s.3
    // sweep. The two spellings are not equivalent across peer versions:
    //   /view/{urlName}  resolves on a pre-DEC-018 peer directly, and on an
    //                    upgraded peer via that peer's permanent 301.
    //   /{urlName}       resolves ONLY on an upgraded peer; on a pre-DEC-018
    //                    peer the root namespace is still the client SPA, which
    //                    answers with its own app shell rather than the calendar.
    // So the retired spelling is the strictly safer guess when we have to guess.
    const declared = pinnedPageUrl(declaredPageUrl, url.host);

    return {
      urlName,
      host: url.host,
      url: declared ?? `${url.protocol}//${url.host}/view/${urlName}`,
    };
  }
  catch {
    // Malformed URI — return null gracefully
    return null;
  }
}

/**
 * Longest page URL this module will render. Deliberately the same number as
 * `MAX_EXTERNAL_URL_LENGTH` in the ActivityPub domain's `url-sanitizer.ts`,
 * duplicated rather than imported because DEC-003 forbids the import — the
 * same reason the whole check below is a restatement rather than a call.
 *
 * Exported for the equivalence test alone, which asserts the two numbers are
 * equal directly rather than inferring it from fixtures. No production code
 * outside this module reads it.
 */
export const MAX_PAGE_URL_LENGTH = 2048;

/**
 * Accepts a peer-declared page URL only if it survives every check the
 * ActivityPub domain applied before caching it, and returns the **normalized**
 * parse rather than the stored bytes.
 *
 * The ActivityPub domain applies exactly this rule before the value is cached
 * (`sanitizePeerPageUrl`, which is the rule of record). That module cannot be
 * imported here — domain boundaries forbid it (DEC-003) — so the check is
 * restated at the render boundary, where the value becomes an anchor href on an
 * anonymous public page. The two must agree on **every** axis, not only the two
 * that are easy to restate:
 *
 *   - scheme allowlist (http/https)
 *   - exact host match, port included
 *   - no userinfo — `URL.host` ignores credentials, so they pass the host pin
 *   - WHATWG normalization: returning the raw stored string instead of
 *     `parsed.toString()` would emit whitespace, quotes, newlines and control
 *     characters verbatim, which the population side percent-encodes away
 *   - length, after normalization (percent-encoding can triple a string), and
 *     before it too: normalization can also shrink a string, so an input over
 *     the cap is refused even where it would have normalized under it. Both
 *     sides do this, so it is part of the agreement rather than an asymmetry —
 *     see the `sanitizeExternalUrlHref` doc comment.
 *   - hygiene of the value the host is pinned against: the actor URI is trimmed
 *     before it is parsed on both sides, because `trim()` strips characters the
 *     WHATWG parser does not
 *
 * `src/server/activitypub/test/helper/url-sanitizer.test.ts` holds the
 * table-driven equivalence test that fails if either side drifts. It asserts
 * `MAX_PAGE_URL_LENGTH === MAX_EXTERNAL_URL_LENGTH` directly, and pins the
 * behaviour at the exact cap from both sides, so drift is caught whichever
 * constant moves and in whichever direction.
 *
 * @param declared - The cached page URL, or null/undefined when we have none
 * @param actorHost - The host of the actor URI that declared it
 * @returns The normalized URL if it passes, otherwise null so the caller falls
 *   back
 */
function pinnedPageUrl(declared: string | null | undefined, actorHost: string): string | null {
  if (typeof declared !== 'string') return null;
  const trimmed = declared.trim();
  if (trimmed === '' || trimmed.length > MAX_PAGE_URL_LENGTH) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.host !== actorHost) return null;
    if (parsed.username || parsed.password) return null;
    const normalized = parsed.toString();
    if (normalized.length > MAX_PAGE_URL_LENGTH) return null;
    return normalized;
  }
  catch {
    return null;
  }
}
