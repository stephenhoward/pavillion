import { CalendarEventSchedule, EventFrequency } from '@/common/model/events';

/**
 * Maps day code abbreviations to human-readable day names.
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
 * Maps ordinal position numbers to human-readable ordinal words.
 * Used for monthly recurrence patterns like "First Monday".
 */
const ORDINAL_NAMES: Record<string, string> = {
  '1': 'First',
  '2': 'Second',
  '3': 'Third',
  '4': 'Fourth',
  '-1': 'Last',
};

/**
 * Formats a list of day names into a readable joined string.
 * e.g., ['Monday', 'Wednesday', 'Friday'] -> 'Monday, Wednesday, and Friday'
 */
function formatDayList(days: string[]): string {
  if (days.length === 0) return '';
  if (days.length === 1) return days[0];
  if (days.length === 2) return `${days[0]} and ${days[1]}`;
  return `${days.slice(0, -1).join(', ')}, and ${days[days.length - 1]}`;
}

/**
 * Generates a human-readable recurrence pattern string from a CalendarEventSchedule.
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
 */
export function getRecurrenceText(schedules: CalendarEventSchedule[]): string {
  const primarySchedule = schedules.find(s => !s.isExclusion && s.frequency !== null);
  if (!primarySchedule) {
    return '';
  }
  return generateRecurrenceText(primarySchedule);
}
