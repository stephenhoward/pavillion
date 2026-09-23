/**
 * The query-string vocabulary for "which calendar view, anchored where".
 *
 * Three surfaces read or write this pair of keys — the public calendar page,
 * the embedded widget, and the admin widget preview that drives the widget's
 * iframe — and each one used to spell `view` (and would have spelled `date`)
 * inline. These four exports are the single declaration of both the key names
 * and the rules that decide when each key appears, so a link built on one
 * surface is read the same way on another.
 *
 * This is query vocabulary, not a path shape, so it sits outside DEC-018's
 * builder surface in `public-paths.ts` — a path builder answers "what does a
 * link to this page look like", this module answers "what does a link to this
 * *state* of that page carry". It follows the same single-declaration
 * discipline for the same reason.
 *
 * The rules, in both directions:
 *
 * - **view** is present only when it differs from the caller's default. The
 *   default is the surface's own (the widget's stored config, the site's
 *   list), so `view=list` IS emitted when the default is `month` — the key is
 *   omitted for the default, never for a particular value.
 * - **date** is present only for `week` and `month`, the views that show a
 *   bounded period. A list view has no anchor to restore.
 * - Anything unrecognized falls back rather than throwing: an unknown view
 *   becomes the default, an unparseable date becomes today. These values
 *   arrive from a URL bar, so a bad one must render a page, not an error.
 *
 * `calendarViewQuery` returns `undefined` for the keys to drop so a caller can
 * spread it over an existing query and hand the result to `router.replace` —
 * `undefined` values are omitted from the serialized URL, which is the same
 * merge convention `search-filter-public.vue`'s `updateURL()` uses for its own
 * filters.
 */

import { DateTime } from 'luxon';

import { type CalendarViewMode, isCalendarViewMode } from '@/common/model/calendar_view';

/** The query-string key carrying the view mode. */
export const VIEW_QUERY_KEY = 'view';

/** The query-string key carrying the anchor date of a week or month view. */
export const DATE_QUERY_KEY = 'date';

/** The format the anchor date is written in: a local calendar day. */
const DATE_QUERY_FORMAT = 'yyyy-MM-dd';

/** The view modes that are anchored to a period, and so carry a date. */
function isAnchoredView(viewMode: CalendarViewMode): boolean {
  return viewMode === 'week' || viewMode === 'month';
}

/**
 * Read the view mode and anchor date out of a route query.
 *
 * Both keys are optional and neither is trusted: an absent, malformed, or
 * unknown value falls back without throwing.
 *
 * @param query - The route query, as vue-router exposes it (values may be
 *   strings, arrays, or null)
 * @param defaultView - The view to use when the query names none
 * @returns The view mode, and the local start of day the view is anchored to
 */
export function parseCalendarViewQuery(
  query: Record<string, unknown>,
  defaultView: CalendarViewMode,
): { viewMode: CalendarViewMode; anchorDate: DateTime } {
  const rawView = query[VIEW_QUERY_KEY];
  const viewMode = isCalendarViewMode(rawView) ? rawView : defaultView;

  const rawDate = query[DATE_QUERY_KEY];
  const parsedDate = typeof rawDate === 'string'
    ? DateTime.fromFormat(rawDate, DATE_QUERY_FORMAT)
    : null;
  const anchorDate = parsedDate !== null && parsedDate.isValid
    ? parsedDate.startOf('day')
    : DateTime.now().startOf('day');

  return { viewMode, anchorDate };
}

/**
 * Build the query keys describing a view state, for merging over an existing
 * route query.
 *
 * A key whose value is `undefined` is one the caller should drop; spreading
 * the result over the current query does exactly that.
 *
 * @param viewMode - The view mode being displayed
 * @param anchorDate - The date the view is anchored to
 * @param defaultView - The surface's default view, omitted from the URL
 * @returns The `view` and `date` keys, each either a string or `undefined`
 */
export function calendarViewQuery(
  viewMode: CalendarViewMode,
  anchorDate: DateTime,
  defaultView: CalendarViewMode,
): Record<string, string | undefined> {
  return {
    [VIEW_QUERY_KEY]: viewMode === defaultView ? undefined : viewMode,
    [DATE_QUERY_KEY]: isAnchoredView(viewMode)
      ? anchorDate.toFormat(DATE_QUERY_FORMAT)
      : undefined,
  };
}
