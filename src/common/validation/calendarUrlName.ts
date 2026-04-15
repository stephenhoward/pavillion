/**
 * Canonical urlName validator shared by client and server.
 *
 * Server-side CalendarService.isValidUrlName and any client-side mirrors
 * must delegate here so they can never drift.
 */
export const CALENDAR_URL_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9_]$/i;

export function isValidCalendarUrlName(urlName: string): boolean {
  return CALENDAR_URL_NAME_RE.test(urlName);
}
