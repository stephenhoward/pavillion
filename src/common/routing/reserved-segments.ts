import { isValidLanguageCode } from '@/common/i18n/languages';

/**
 * Top-level URL segments a calendar may never claim as its url name.
 *
 * Public calendar URLs live at the domain root, so any segment already routed
 * by the server or by one of the single-page apps would shadow — or be shadowed
 * by — a calendar of the same name. This set is the single source of truth for
 * that collision list: the url-name validator and the server router both read
 * it rather than keeping lists of their own.
 *
 * Entries are lower case; `isReservedRouteSegment` does the case folding, which
 * matches the case-insensitive route regexes in src/server/app_routes.ts.
 *
 * Sources enumerated here:
 * - server: the client catch-all exclusions and the dev asset/coverage
 *   redirects in src/server/app_routes.ts, the federation routers mounted at
 *   '/' in src/server/activitypub/api/v1.ts, and /health in src/server/server.ts
 * - client SPA: every top-level route in src/client/app.ts
 * - public site: the discovery page, plus `view`, which stays reserved
 *   permanently so the redirects away from the old URL shape stay unambiguous
 *
 * Locale codes are deliberately absent — they are reserved by delegating to
 * `isValidLanguageCode` so this list cannot drift from the supported languages.
 */
export const RESERVED_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  '.well-known',
  'admin',
  'api',
  'assets',
  'auth',
  'calendar',
  'calendars',
  'coverage',
  'discover',
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

/**
 * Reports whether a single URL path segment is reserved for application routing.
 *
 * Any supported locale code is reserved too: /:lang/:calendarName would make a
 * calendar named after a locale unroutable.
 *
 * @param segment - One path segment, without surrounding slashes
 * @returns true when a calendar may not claim this segment as its url name
 */
export function isReservedRouteSegment(segment: string): boolean {
  const normalized = segment.toLowerCase();

  return RESERVED_ROUTE_SEGMENTS.has(normalized) || isValidLanguageCode(normalized);
}
