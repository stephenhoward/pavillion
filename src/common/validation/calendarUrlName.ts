import { isReservedRouteSegment } from '@/common/routing/reserved-segments';

/** Canonical calendar url-name rules, shared by client and server. */

/**
 * The shape rule: 3–24 characters, leading letter or digit, no leading `_`/`-`,
 * no trailing `-`. Not a gate: lookups use `isResolvableCalendarUrlName`,
 * claims use `isClaimableCalendarUrlName`.
 */
export const CALENDAR_URL_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9_]$/i;

/**
 * Shape only. Gates every lookup of a calendar that already exists; reservation
 * governs claiming, never resolving (DEC-018 rule 4).
 */
export function isResolvableCalendarUrlName(urlName: string): boolean {
  return typeof urlName === 'string' && CALENDAR_URL_NAME_RE.test(urlName);
}

/**
 * Shape and not reserved. Gates every path that claims a new name.
 * `isResolvableCalendarUrlName` runs first so `isReservedRouteSegment` only
 * ever sees a charset-validated string — callers hand this untrusted request
 * bodies.
 */
export function isClaimableCalendarUrlName(urlName: string): boolean {
  return isResolvableCalendarUrlName(urlName) && !isReservedRouteSegment(urlName);
}
