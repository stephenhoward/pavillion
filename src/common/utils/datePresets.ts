import { DateTime } from 'luxon';

/**
 * Interface for date range with ISO date strings
 */
export interface DateRange {
  startDate: string;
  endDate: string;
}

/**
 * Get the start of the week (Sunday) for a given date
 *
 * @param date - DateTime to find week start for (defaults to today)
 * @returns DateTime for the Sunday of that week
 */
function getWeekStart(date?: DateTime): DateTime {
  const now = date || DateTime.now();

  // Luxon weekday: Monday=1, Sunday=7
  // We want Sunday as the start of the week
  const currentWeekday = now.weekday;

  if (currentWeekday === 7) {
    // Already Sunday
    return now.startOf('day');
  }
  else {
    // Go back to previous Sunday
    const daysToSubtract = currentWeekday; // Monday=1 day back, Saturday=6 days back
    return now.minus({ days: daysToSubtract }).startOf('day');
  }
}

/**
 * Get the end of the week (Saturday) for a given date
 *
 * @param date - DateTime to find week end for (defaults to today)
 * @returns DateTime for the Saturday of that week
 */
function getWeekEnd(date?: DateTime): DateTime {
  const weekStart = getWeekStart(date);
  return weekStart.plus({ days: 6 }).endOf('day');
}

/**
 * Get the date range for "This Week" (Sunday-Saturday of current week)
 * Uses browser timezone for calculating "today"
 *
 * @param referenceDate - Optional reference date (defaults to now)
 * @returns DateRange with startDate and endDate as ISO date strings (YYYY-MM-DD)
 */
export function getThisWeek(referenceDate?: DateTime): DateRange {
  const weekStart = getWeekStart(referenceDate);
  const weekEnd = getWeekEnd(referenceDate);

  return {
    startDate: weekStart.toISODate() as string,
    endDate: weekEnd.toISODate() as string,
  };
}

/**
 * Get the date range for "Next Week" (Sunday-Saturday of following week)
 * Uses browser timezone for calculating "today"
 *
 * @param referenceDate - Optional reference date (defaults to now)
 * @returns DateRange with startDate and endDate as ISO date strings (YYYY-MM-DD)
 */
export function getNextWeek(referenceDate?: DateTime): DateRange {
  const thisWeekStart = getWeekStart(referenceDate);
  const nextWeekStart = thisWeekStart.plus({ days: 7 });
  const nextWeekEnd = nextWeekStart.plus({ days: 6 }).endOf('day');

  return {
    startDate: nextWeekStart.toISODate() as string,
    endDate: nextWeekEnd.toISODate() as string,
  };
}
