/**
 * The view modes a calendar can be rendered in.
 *
 * This is the canonical declaration, shared by the public site, the embedded
 * widget and the server. It used to be `WidgetView` in
 * `src/common/model/widget_config.ts`, named for the only surface that had a
 * view switcher; once the public site gained the same week/month views the
 * widget-specific name stopped describing what the type means, and a second
 * declaration next to the site's own switcher would have let the two sets of
 * allowed values drift apart.
 *
 * The persisted widget field is still called `view` (column, API body and
 * admin form all keep that name) — only the type moved.
 */

/** A calendar view mode. */
export type CalendarViewMode = 'list' | 'week' | 'month';

/**
 * The allowed view modes, in the order a view switcher presents them.
 */
export const CALENDAR_VIEW_MODES: readonly CalendarViewMode[] = ['list', 'week', 'month'];

/**
 * Checks whether a value is an allowed calendar view mode.
 *
 * @param value - The value to check
 * @returns True if the value is one of 'list', 'week', or 'month'
 */
export function isCalendarViewMode(value: unknown): value is CalendarViewMode {
  return typeof value === 'string'
    && (CALENDAR_VIEW_MODES as readonly string[]).includes(value);
}
