/**
 * The query-string vocabulary for "which calendar view, anchored where".
 *
 * Three surfaces read or write this pair of keys — the public calendar page,
 * the embedded widget, and the admin widget preview that drives the widget's
 * iframe — and each one used to spell `view` (and would have spelled `date`)
 * inline. This module is the single declaration of both the key names and
 * the rules that decide when each key appears, so a link built on one surface
 * is read the same way on another. It also names the list filter's two date
 * keys, because the precedence rule below has to refer to them.
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
 * ## `view` carries two meanings on the widget's URL
 *
 * 1. **A visitor's deviation from the default.** This is the meaning the rules
 *    above describe. It is written only through `calendarViewQuery` (by
 *    `useCalendarViewState` in `src/common/ui/calendar-views/`), and read only
 *    through `parseCalendarViewQuery`.
 * 2. **The owner-configured starting view.** The admin widget preview
 *    (`widget-config.vue`) puts the owner's unsaved `view` on the widget
 *    iframe's URL, and the widget store's `parseConfig` reads it as the
 *    widget's default — the value later handed to `calendarViewQuery` and
 *    `parseCalendarViewQuery` as `defaultView`.
 *
 * The preview is therefore a writer that **always** emits `view`, whatever
 * the value: it states a default rather than deviating from one, so the
 * default-omission rule does not apply to it and it does not call
 * `calendarViewQuery`. It is the one sanctioned exception to that rule.
 * Applying default-omission there would drop the very value the preview
 * exists to state. When the owner picks another view, the preview's src
 * changes with it, so the iframe reloads and `parseConfig` re-reads `view`
 * as the new default. The preview also posts a `pavillion:updateConfig`
 * message whose `view` updates the default in place, but that only changes
 * what renders while the route carries no visitor view.
 *
 * The two meanings share a key only because of an ordering invariant:
 * `parseConfig` reads `view` exactly once, at load, from
 * `window.location.search`, before anything writes the route; from then on
 * the key in the route query means the visitor's view and the view-state
 * reader owns it. At load the two readings agree by construction (the URL's
 * `view` is the default, so the visitor has not deviated). Re-reading
 * `window.location.search` as configuration after a `router.replace` would
 * read the visitor's choice as the owner's config — never do it. A full
 * reload is a fresh load, though: reloading a URL that carries a visitor's
 * `view` makes `parseConfig` treat it as the starting view. That is an
 * accepted consequence; the SDK never puts `view` on the iframe URL, so only
 * a visitor who navigated inside the frame and then reloaded it meets it.
 *
 * ## Precedence between `date` and the list filters `startDate` / `endDate`
 *
 * Both public surfaces — the site's calendar page and the widget, which
 * mounts the same `search-filter-public.vue` — also carry the list filter's
 * `startDate` / `endDate` (LIST_START_DATE_QUERY_KEY / LIST_END_DATE_QUERY_KEY,
 * including the filter's this-week / next-week presets). They and `date` can
 * disagree on the same URL. The rule binds every writer on either surface:
 * `router.replace` callers and link builders alike.
 *
 * - **Each vocabulary is backed by its own state.** `date` drives the view
 *   window, which reaches the events source through its own slot
 *   (`setViewWindow`, via `useCalendarWindowSync`). `startDate` / `endDate`
 *   are the list filter's state, read and written by the list filter alone.
 *   The view window is never written into the list filter's dates, nor the
 *   list filter's dates into the view window.
 * - **The displayed view decides which vocabulary is in force.** In `week` or
 *   `month`, the view window — from `date` alone — decides the period shown
 *   and fetched, and takes precedence over the list filter's dates. In
 *   `list`, there is no view window: `startDate` / `endDate` decide, and
 *   `date` is ignored (and never written).
 * - **Neither writer removes the other's keys.** Entering an anchored view
 *   leaves `startDate` / `endDate` in the URL and in the list filter's state
 *   untouched, so returning to the list restores the visitor's list filter by
 *   construction; returning to the list drops only `date`.
 * - **The one crossing is a seed, not an override.** Switching from a list
 *   view into `week` or `month` anchors on `startDate` when present (else
 *   today), because the list's period is what the visitor was looking at. It
 *   happens once, at that transition, and only when the URL's own view is
 *   the list — when `date` is absent by construction. A week or month that a
 *   narrow layout is displaying as a list keeps its `date`: `startDate` never
 *   overrides a `date` already in the URL.
 * - **A link that omits `view` lands on the surface's default view**, which
 *   is not always the list. A link meant to open a list period (a day link
 *   from a week or month cell, for instance) must emit `view` through
 *   `calendarViewQuery('list', …, defaultView)` alongside its list-filter
 *   dates, or on a surface whose default is `month` it opens the month.
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

/** The query-string key carrying the list filter's first day (yyyy-MM-dd). */
export const LIST_START_DATE_QUERY_KEY = 'startDate';

/** The query-string key carrying the list filter's last day (yyyy-MM-dd). */
export const LIST_END_DATE_QUERY_KEY = 'endDate';

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
 * Read one list-filter date (`startDate` or `endDate`) out of a route query.
 *
 * The value arrives from a URL anyone can edit, so only a real calendar day
 * written as yyyy-MM-dd is accepted; anything else reads as absent.
 *
 * @param value - The raw query value (may be a string, array, or null)
 * @returns The date string unchanged, or `null` when it is not a valid day
 */
export function parseListDateQuery(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return DateTime.fromFormat(value, DATE_QUERY_FORMAT).isValid ? value : null;
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
