import { isValidLanguageCode } from '@/common/i18n/languages';

/**
 * Top-level URL segments a calendar may never claim as its url name.
 *
 * Public calendar URLs live at the domain root, so any segment already routed
 * by the server or by one of the single-page apps would shadow — or be shadowed
 * by — a calendar of the same name. This is the single source of truth for one
 * question only: which names a calendar may not claim. `isValidCalendarUrlName`
 * is its consumer, and via `SeriesService.isValidUrlName` — which delegates to
 * that same composite validator — the list gates series url names too, so an
 * entry added for root-routing reasons silently narrows the series namespace
 * as well.
 *
 * It is **not** a routing table. Membership means one thing to the validator
 * (reject) and four different things to a router: some segments must not reach
 * the site SPA because the server serves them, others because the client SPA
 * shell does, `discover` is a site SPA route, and `view` is neither — it
 * redirects. A router consuming this list therefore has to decide each
 * segment's disposition separately; an alternation built straight from the
 * array would exclude `discover` and `view` from exactly the handler that must
 * serve them.
 *
 * Entries are lower case; `isReservedRouteSegment` does the case folding, which
 * matches the case-insensitive route regexes in src/server/app_routes.ts. The
 * array is frozen so a consumer that builds a route regex alternation from it
 * cannot have the alternation changed out from under it at runtime.
 *
 * Sources enumerated here:
 * - server: the client catch-all exclusions and the dev asset/coverage
 *   redirects in src/server/app_routes.ts, the federation routers mounted at
 *   '/' in src/server/activitypub/api/v1.ts, and /health in src/server/server.ts
 * - client SPA: every top-level route in src/client/app.ts
 * - public site: the discovery page, plus `view`, which stays reserved
 *   permanently so the redirects away from the old URL shape stay unambiguous
 *
 * `.well-known` is inert to the validator — `CALENDAR_URL_NAME_RE` rejects a
 * leading dot whether or not the segment is listed — and is carried here for a
 * router consumer that does not exist yet.
 *
 * `metrics` was considered and deliberately excluded: per DEC-017 the telemetry
 * exposition is served by a second HTTP listener, so it claims no path on the
 * main Express app. Moving `/metrics` onto the main listener would overturn that
 * decision and would have to add the segment here.
 *
 * Locale codes are deliberately absent — they are reserved by delegating to
 * `isValidLanguageCode` so this list cannot drift from the supported languages.
 */
export const RESERVED_ROUTE_SEGMENTS: readonly string[] = Object.freeze([
  '.well-known',
  'admin',
  'api',
  'assets',
  'auth',
  'calendar',
  'calendars',
  'coverage',
  'discover', // emitted as DISCOVER_PATH in src/common/routing/public-paths.ts
  'event',
  'feed',
  'funding',
  'health',
  'inbox',
  'login',
  'policy',
  'profile',
  'setup',
  'users',
  'view',
  'widget',
]);

/** Module-private index over the frozen list, for O(1) membership tests. */
const RESERVED_SEGMENT_LOOKUP: ReadonlySet<string> = new Set<string>(RESERVED_ROUTE_SEGMENTS);

/**
 * Reports whether a single URL path segment is reserved for application routing.
 *
 * Any supported locale code is reserved too: /:lang/:calendarName would make a
 * calendar named after a locale unroutable.
 *
 * Caller precondition: `segment` must already be percent-decoded and validated
 * against `CALENDAR_URL_NAME_RE` (src/common/validation/calendarUrlName.ts).
 * This function does no decoding, trimming, or normalization beyond case
 * folding, so it answers `false` for '%61dmin', ' admin' and 'admin.' — those
 * are the charset validator's job to reject. The distinction matters to route
 * matching: Express matches on the raw, undecoded pathname and only decodes
 * `:params` afterwards, so a router consuming this function must decide
 * deliberately where decoding happens relative to the reservation check.
 *
 * @param segment - One decoded, charset-validated path segment, without slashes
 * @returns true when a calendar may not claim this segment as its url name
 */
export function isReservedRouteSegment(segment: string): boolean {
  const normalized = segment.toLowerCase();

  return RESERVED_SEGMENT_LOOKUP.has(normalized) || isValidLanguageCode(normalized);
}
