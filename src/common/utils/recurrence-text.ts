import { CalendarEventSchedule, EventFrequency } from '@/common/model/events';

/**
 * Structured, locale-agnostic recurrence intent suitable for i18n rendering
 * at the presentation layer. Consumers resolve `key` against their own
 * translation catalog and interpolate `params`.
 */
export interface RecurrenceSummary {
  key: string;
  params: Record<string, unknown>;
}

/**
 * Valid ISO day codes for weekly recurrence (BYDAY RFC 5545 values).
 */
const VALID_DAY_CODES = new Set(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);

/**
 * Maps day code abbreviations to human-readable English day names.
 * Retained for the legacy {@link generateRecurrenceText} helper only.
 */
const DAY_NAMES: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

/**
 * Maps ordinal position numbers to human-readable English ordinal words.
 * Retained for the legacy {@link generateRecurrenceText} helper only.
 */
const ORDINAL_NAMES: Record<string, string> = {
  '1': 'First',
  '2': 'Second',
  '3': 'Third',
  '4': 'Fourth',
  '-1': 'Last',
};

/**
 * Formats a list of day names into a readable joined English string.
 * Retained for the legacy {@link generateRecurrenceText} helper only.
 */
function formatDayList(days: string[]): string {
  if (days.length === 0) return '';
  if (days.length === 1) return days[0];
  if (days.length === 2) return `${days[0]} and ${days[1]}`;
  return `${days.slice(0, -1).join(', ')}, and ${days[days.length - 1]}`;
}

/**
 * Pattern matching nth-weekday BYDAY codes such as `1MO`, `3FR`, `-1SA`.
 */
const NTH_WEEKDAY_PATTERN = /^(-?\d+)([A-Z]{2})$/;

/**
 * Parses a BYDAY entry expected to encode an nth-weekday pattern.
 *
 * @param entry - A BYDAY token such as `1MO` or `-1SA`
 * @returns `{ ordinal, day }` on success, or `null` if the token does not match
 */
function parseNthWeekday(entry: string): { ordinal: number; day: string } | null {
  const match = entry.match(NTH_WEEKDAY_PATTERN);
  if (!match) {
    return null;
  }
  const ordinal = parseInt(match[1], 10);
  const day = match[2];
  if (!VALID_DAY_CODES.has(day) || Number.isNaN(ordinal)) {
    return null;
  }
  return { ordinal, day };
}

/**
 * Generates a structured, locale-agnostic recurrence summary from a schedule.
 *
 * The returned shape is `{ key, params }`: `key` is a translation key (e.g.
 * `recurrence.weekly_on_days`) and `params` carries raw interpolation values
 * (raw ISO day codes and integer ordinals). Rendering is deferred to the
 * presentation layer so the server and shared models stay locale-agnostic.
 *
 * @param schedule - The CalendarEventSchedule to summarize
 * @returns Structured summary, or `null` when the schedule is not recurring
 */
export function generateRecurrenceSummary(schedule: CalendarEventSchedule): RecurrenceSummary | null {
  if (!schedule.frequency) {
    return null;
  }

  const interval = schedule.interval && schedule.interval > 0 ? schedule.interval : 1;
  const byDay = schedule.byDay ?? [];

  switch (schedule.frequency) {
    case EventFrequency.DAILY: {
      if (interval === 1) {
        return { key: 'recurrence.every_day', params: {} };
      }
      return { key: 'recurrence.every_n_days', params: { n: interval } };
    }

    case EventFrequency.WEEKLY: {
      const days = byDay.filter(d => VALID_DAY_CODES.has(d));

      if (interval === 1) {
        if (days.length === 0) {
          return { key: 'recurrence.weekly_every_week', params: {} };
        }
        return { key: 'recurrence.weekly_on_days', params: { days } };
      }

      if (days.length === 0) {
        return { key: 'recurrence.every_n_weeks', params: { n: interval } };
      }
      return { key: 'recurrence.every_n_weeks_on_days', params: { n: interval, days } };
    }

    case EventFrequency.MONTHLY: {
      // Detect "Nth weekday of the month" patterns (e.g. '1MO', '-1SA').
      const nthEntry = byDay
        .map(parseNthWeekday)
        .find((entry): entry is { ordinal: number; day: string } => entry !== null);

      if (nthEntry) {
        if (interval === 1) {
          return {
            key: 'recurrence.nth_weekday_of_month',
            params: { ordinal: nthEntry.ordinal, day: nthEntry.day },
          };
        }
        return {
          key: 'recurrence.nth_weekday_every_n_months',
          params: { ordinal: nthEntry.ordinal, day: nthEntry.day, n: interval },
        };
      }

      if (interval === 1) {
        return { key: 'recurrence.monthly', params: {} };
      }
      return { key: 'recurrence.every_n_months', params: { n: interval } };
    }

    case EventFrequency.YEARLY: {
      if (interval === 1) {
        return { key: 'recurrence.yearly', params: {} };
      }
      return { key: 'recurrence.every_n_years', params: { n: interval } };
    }

    default:
      return null;
  }
}

/**
 * Picks the first non-exclusion schedule with a frequency from an array and
 * returns its structured recurrence summary.
 *
 * @param schedules - Array of CalendarEventSchedule objects
 * @returns Structured summary, or `null` if no recurring schedule is present
 */
export function getRecurrenceSummary(schedules: CalendarEventSchedule[]): RecurrenceSummary | null {
  const primarySchedule = schedules.find(s => !s.isExclusion && s.frequency);
  if (!primarySchedule) {
    return null;
  }
  return generateRecurrenceSummary(primarySchedule);
}

/**
 * Generates a human-readable English recurrence pattern string from a
 * CalendarEventSchedule.
 *
 * Retained as the legacy English helper for authenticated-client callers
 * (event_recurrence.vue, events-tab.vue) that have not yet migrated to the
 * structured {@link generateRecurrenceSummary} API. Do not use for new code.
 *
 * Examples:
 * - Daily: "Every day"
 * - Weekly on specific days: "Every Saturday" / "Every Monday and Wednesday"
 * - Monthly by weekday: "First Saturday of the month" / "Third Friday of the month"
 * - Monthly by date: "Monthly"
 * - Yearly: "Yearly"
 * - With interval > 1: "Every 2 weeks on Monday" / "Every 3 months"
 *
 * @param schedule - The CalendarEventSchedule to generate text for
 * @returns Human-readable recurrence pattern string, or empty string if not recurring
 * @deprecated Use {@link generateRecurrenceSummary} and render at the presentation layer.
 */
export function generateRecurrenceText(schedule: CalendarEventSchedule): string {
  if (!schedule.frequency) {
    return '';
  }

  const interval = schedule.interval || 1;
  const byDay = schedule.byDay ?? [];

  switch (schedule.frequency) {
    case EventFrequency.DAILY: {
      if (interval === 1) {
        return 'Every day';
      }
      return `Every ${interval} days`;
    }

    case EventFrequency.WEEKLY: {
      const dayNames = byDay
        .filter(d => DAY_NAMES[d])
        .map(d => DAY_NAMES[d]);

      const daysText = dayNames.length > 0
        ? formatDayList(dayNames)
        : '';

      if (interval === 1) {
        return daysText ? `Every ${daysText}` : 'Every week';
      }
      return daysText
        ? `Every ${interval} weeks on ${daysText}`
        : `Every ${interval} weeks`;
    }

    case EventFrequency.MONTHLY: {
      // Check for "Nth weekday of the month" pattern (e.g., '1MO', '3FR', '-1SA')
      const nthWeekdayPattern = /^(-?\d+)([A-Z]{2})$/;
      const nthEntries = byDay
        .map(d => {
          const match = d.match(nthWeekdayPattern);
          if (match) {
            return { ordinal: match[1], dayCode: match[2] };
          }
          return null;
        })
        .filter((e): e is { ordinal: string; dayCode: string } => e !== null);

      if (nthEntries.length > 0) {
        // Use the first nth-weekday entry for display
        const entry = nthEntries[0];
        const ordinalName = ORDINAL_NAMES[entry.ordinal] ?? `${entry.ordinal}th`;
        const dayName = DAY_NAMES[entry.dayCode] ?? entry.dayCode;

        if (interval === 1) {
          return `${ordinalName} ${dayName} of the month`;
        }
        return `${ordinalName} ${dayName} every ${interval} months`;
      }

      // Plain monthly recurrence
      if (interval === 1) {
        return 'Monthly';
      }
      return `Every ${interval} months`;
    }

    case EventFrequency.YEARLY: {
      if (interval === 1) {
        return 'Yearly';
      }
      return `Every ${interval} years`;
    }

    default:
      return '';
  }
}

/**
 * Generates recurrence text from the first non-exclusion schedule in an array.
 *
 * @param schedules - Array of CalendarEventSchedule objects
 * @returns Human-readable recurrence pattern string, or empty string if no recurring schedule
 * @deprecated Use {@link getRecurrenceSummary} and render at the presentation layer.
 */
export function getRecurrenceText(schedules: CalendarEventSchedule[]): string {
  const primarySchedule = schedules.find(s => !s.isExclusion && s.frequency !== null);
  if (!primarySchedule) {
    return '';
  }
  return generateRecurrenceText(primarySchedule);
}
