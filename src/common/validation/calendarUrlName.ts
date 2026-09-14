import { isReservedRouteSegment } from '@/common/routing/reserved-segments';

/**
 * Canonical urlName validator shared by client and server.
 *
 * Server-side CalendarService.isValidUrlName and any client-side mirrors
 * must delegate here so they can never drift.
 */

/**
 * The shape rule alone: 3-24 characters, no leading underscore or hyphen, no
 * trailing hyphen.
 *
 * Exported separately from `isValidCalendarUrlName` for callers that must
 * accept a name an instance may legitimately have issued before reservation
 * existed — a *lookup* of an already-created calendar must not apply a rule
 * that only governs *creation*. Every lookup and follow path uses this:
 * `CalendarService.getCalendarByName` (the single name->calendar resolver for
 * the public API, widget, SSR meta tags and the ActivityPub surface),
 * `ActivityPubService.normalizeIdentifier`, and the client's follow modal.
 * Use `isValidCalendarUrlName` anywhere a new name is being claimed.
 */
export const CALENDAR_URL_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9_]$/i;

/**
 * Reports whether a calendar may claim `urlName`.
 *
 * Shape and reservation both have to hold: public calendars live at the domain
 * root, so a name matching a top-level route would shadow — or be shadowed by —
 * that route. The type guard and the shape test run first and short-circuit,
 * which is what satisfies `isReservedRouteSegment`'s precondition that its
 * argument be a decoded, charset-validated string — callers hand this untrusted
 * request bodies, where a number or an array would coerce past the regex and
 * then throw inside the reservation check.
 */
export function isValidCalendarUrlName(urlName: string): boolean {
  return typeof urlName === 'string'
    && CALENDAR_URL_NAME_RE.test(urlName)
    && !isReservedRouteSegment(urlName);
}
