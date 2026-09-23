/**
 * Date math for the shared week and month calendar grids.
 *
 * Pure by design: no Vue, no router, no store, no clock. Every function takes
 * the dates it reasons about — including "today" — so a caller in any app can
 * render the same grid, and so the whole module is testable without freezing
 * time. Luxon is the only import.
 *
 * Weeks start on Sunday. That matches getWeekStart in
 * src/common/utils/datePresets.ts, which decides the window the calendar
 * fetches events for; the grid and the fetch window have to agree on where a
 * week begins or the first and last columns come back empty. The arithmetic is
 * reproduced here rather than imported because getWeekStart is module-private
 * there.
 */
import { DateTime, Info, Interval } from 'luxon';

/** Events a month cell shows before collapsing the rest into a "+N more". */
export const MAX_VISIBLE_EVENTS = 3;

/** Sunday through Saturday. */
const DAYS_IN_WEEK = 7;

/**
 * Rows in the month grid.
 *
 * Six is the fixed height rather than the minimum needed: a month can require
 * six rows (31 days starting on a Friday or Saturday), and a grid that changed
 * height between months would make the whole page jump on every navigation.
 */
const MONTH_GRID_ROWS = 6;

/** Luxon numbers weekdays Monday=1 through Sunday=7. */
const SUNDAY = 7;

/** One day of a week or month grid. */
export interface GridCell {
  /** Start of the day, in the anchor's zone. */
  date: DateTime;
  /** Local ISO date (yyyy-MM-dd) — the key events are grouped under. */
  dateKey: string;
  /** Day of the month, as the cell displays it. */
  dayNumber: number;
  /** Whether the day belongs to the month being displayed, rather than to the padding around it. */
  isCurrentMonth: boolean;
  isToday: boolean;
}

/**
 * The Sunday starting the week that contains `date`.
 *
 * With Monday=1..Sunday=7, a weekday number is also the number of days back to
 * the preceding Sunday — except on Sunday itself, which is already the start.
 */
function startOfWeek(date: DateTime): DateTime {
  return date.weekday === SUNDAY
    ? date.startOf('day')
    : date.minus({ days: date.weekday }).startOf('day');
}

/**
 * `count` consecutive day cells beginning at `start`.
 *
 * Each step re-applies startOf('day') because adding days across a DST
 * transition preserves the local clock time, which lands on a nonexistent
 * midnight in the zones whose transition happens at midnight; Luxon shifts
 * that to the first valid instant of the day, and startOf('day') normalises
 * the rest back.
 */
function days(start: DateTime, count: number, month: DateTime, today: DateTime): GridCell[] {
  return Array.from({ length: count }, (_, offset) => {
    const date = start.plus({ days: offset }).startOf('day');

    return {
      date,
      dateKey: date.toISODate()!,
      dayNumber: date.day,
      isCurrentMonth: date.hasSame(month, 'month'),
      isToday: date.hasSame(today, 'day'),
    };
  });
}

/**
 * The seven cells of the week containing `anchor`, Sunday through Saturday.
 *
 * `isCurrentMonth` is read against the anchor's own month, so a week straddling
 * a month boundary can still tell the two halves apart.
 */
export function weekDays(anchor: DateTime, today: DateTime): GridCell[] {
  return days(startOfWeek(anchor), DAYS_IN_WEEK, anchor, today);
}

/**
 * The 42 cells of the month containing `anchor`, padded at both ends with the
 * neighbouring months' days so the grid is always six whole weeks.
 */
export function monthCells(anchor: DateTime, today: DateTime): GridCell[] {
  const month = anchor.startOf('month');

  return days(startOfWeek(month), DAYS_IN_WEEK * MONTH_GRID_ROWS, month, today);
}

/**
 * The heading for the period a view is showing: a date range for the week,
 * the month and year for the month.
 *
 * Both are formatted by ICU for the given locale, which also decides how a
 * range is punctuated and how much of it is elided ("March 9 - 15, 2025" in
 * English, "9-15 de marzo de 2025" in Spanish). Nothing here is hardcoded
 * English.
 */
export function periodLabel(view: 'week' | 'month', anchor: DateTime, locale: string): string {
  if (view === 'month') {
    return anchor.toLocaleString({ month: 'long', year: 'numeric' }, { locale });
  }

  const start = startOfWeek(anchor);

  return Interval
    .fromDateTimes(start, start.plus({ days: DAYS_IN_WEEK - 1 }))
    .toLocaleString({ month: 'long', day: 'numeric', year: 'numeric' }, { locale });
}

/**
 * The seven column headings for a grid, Sunday first.
 *
 * Luxon returns weekdays Monday-first, so the last entry is rotated to the
 * front.
 */
export function weekdayLabels(locale: string): string[] {
  const mondayFirst = Info.weekdays('short', { locale });

  return [mondayFirst[DAYS_IN_WEEK - 1], ...mondayFirst.slice(0, DAYS_IN_WEEK - 1)];
}
