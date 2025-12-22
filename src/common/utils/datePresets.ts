import { DateTime } from 'luxon';
import type { DefaultDateRange } from '@/common/model/calendar';

/**
 * Interface for date range with ISO date strings
 */
export interface DateRange {
  startDate: string;
  endDate: string;
}

/**
 * Map of range type to number of days
 */
const rangeDaysMap: Record<DefaultDateRange, number> = {
  '1week': 7,
  '2weeks': 14,
  '1month': 30,
};

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

/**
 * Get the default date range for public calendar view
 * This is used when no explicit date filter is specified.
 *
 * @param rangeType - The range type ('1week', '2weeks', '1month'), defaults to '2weeks'
 * @param referenceDate - Optional reference date (defaults to now)
 * @returns DateRange with startDate (today) and endDate based on range type
 */
export function getDefaultDateRange(rangeType: DefaultDateRange = '2weeks', referenceDate?: DateTime): DateRange {
  const today = (referenceDate || DateTime.now()).startOf('day');
  const days = rangeDaysMap[rangeType] || 14;
  const endDate = today.plus({ days }).endOf('day');

  return {
    startDate: today.toISODate() as string,
    endDate: endDate.toISODate() as string,
  };
}
