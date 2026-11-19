/**
 * Whether the recurrence rule being edited would expand to fewer than two
 * occurrences — a "recurring" event that never recurs. The recurrence sheet
 * warns on it.
 *
 * The answer must match what the server will store, so the rrule options here
 * mirror `buildScheduleRule()` in `src/server/calendar/service/event_instance.ts`
 * field for field. Change the two together. A shared builder was rejected:
 * the server's is bound to its wall-clock frame and the client may not import
 * server code.
 *
 * Exclusions are not consulted: the sheet edits the base rule only.
 */
import { RRule, Weekday } from 'rrule';
import { DateTime } from 'luxon';
import { parseByDayEntry } from '@/common/utils/recurrence-by-day';

/** The sheet's live recurrence state. */
export interface RecurrenceOccurrenceInput {
  /** `daily`, `weekly`, `monthly`, `yearly`, or empty/null for no recurrence. */
  frequency: string | null;
  interval: number;
  /** Stored BYDAY entries, e.g. `MO`, `1MO`, `-1FR`. */
  byDay: string[];
  /** The schedule's start, in the schedule's zone. */
  startDate: DateTime | null;
  endType: 'none' | 'after' | 'on' | string;
  count: number;
  /** The "ends on" date as an ISO date (`YYYY-MM-DD`), read in the start's zone. */
  endDate: string;
}

/** Mirrors the server's FREQUENCY_MAP. */
const FREQUENCY_MAP: Record<string, number> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};

/**
 * A wall-clock time in `zone` carried in a Date's UTC fields, which rrule
 * steps. Same conversion as the server's `WallClockFrame.toFloating()`.
 */
function toFloating(dt: DateTime, zone: string): Date {
  return dt.setZone(zone).setZone('utc', { keepLocalTime: true }).toJSDate();
}

/** BYDAY entries as rrule weekdays, skipping unparseable ones, as the server does. */
function toWeekdays(byDay: string[]): Weekday[] {
  return byDay.flatMap((entry) => {
    const parsed = parseByDayEntry(entry);
    if (!parsed) {
      return [];
    }
    const weekday = Weekday.fromStr(parsed.dayCode);
    return [parsed.ordinal !== null ? weekday.nth(parsed.ordinal) : weekday];
  });
}

/**
 * True when the rule yields fewer than two occurrences.
 *
 * - No frequency, or no end: false.
 * - Ends after a count: true below 2.
 * - Ends on a date: expands with rrule up to that date at 00:00 in the
 *   schedule's zone (the until the server stores), counting rrule's own
 *   output — a start that BYDAY excludes is not an occurrence.
 */
export function hasFewerThanTwoOccurrences(input: RecurrenceOccurrenceInput): boolean {
  const freq = input.frequency ? FREQUENCY_MAP[input.frequency] : undefined;
  // RRule.YEARLY === 0, so compare against undefined rather than truthiness.
  if (freq === undefined) {
    return false;
  }

  if (input.endType === 'after') {
    return input.count < 2;
  }
  if (input.endType !== 'on' || !input.endDate || !input.startDate) {
    return false;
  }

  const zone = input.startDate.zoneName ?? 'UTC';
  const until = DateTime.fromISO(input.endDate, { zone });
  if (!until.isValid) {
    return false;
  }

  const options: Partial<ConstructorParameters<typeof RRule>[0]> = {
    freq,
    interval: Number.isInteger(input.interval) && input.interval > 0 ? input.interval : 1,
    dtstart: toFloating(input.startDate, zone),
    until: toFloating(until, zone),
  };
  const weekdays = toWeekdays(input.byDay ?? []);
  if (weekdays.length) {
    options.byweekday = weekdays;
  }

  // Stop after two hits instead of expanding the whole rule.
  return new RRule(options).all((_date, i) => i < 2).length < 2;
}
