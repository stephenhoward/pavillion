import { ValidationError } from '@/common/exceptions/base';
import { CalendarEventSchedule } from '@/common/model/events';
import { findInvalidByDayEntry } from '@/common/utils/recurrence-by-day';

/**
 * Rejects a schedule whose byDay holds an ordinal that can never match, before
 * anything is persisted. Author-facing paths only; peer-supplied schedules are
 * handled on the read side by skipping unreachable rules.
 *
 * Non-array input and non-object entries are left for reconcileSchedules.
 *
 * @param {unknown} schedules - The raw `schedules` request value
 * @throws {ValidationError} On the first schedule with an invalid byDay
 */
export function validateSchedulesByDay(schedules: unknown): void {
  if (!Array.isArray(schedules)) {
    return;
  }
  schedules.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const raw = (entry as Record<string, unknown>).frequency;
    const frequency = typeof raw === 'string' ? CalendarEventSchedule.parseFrequency(raw) : null;
    const reason = findInvalidByDayEntry(frequency, (entry as Record<string, unknown>).byDay);
    if (reason) {
      throw new ValidationError(`schedules[${i}].byDay: ${reason}`, { schedules: [reason] });
    }
  });
}

/**
 * Rejects a schedule whose event ends strictly before it starts. Author-facing
 * paths only. Schedules without an end time and exclusion rows are skipped, and
 * `end` (the recurrence-until) is deliberately not compared.
 *
 * Non-array input and non-object entries are left for reconcileSchedules.
 *
 * @param {unknown} schedules - The raw `schedules` request value
 * @throws {ValidationError} On the first schedule whose end is before its start
 */
export function validateSchedulesEndTime(schedules: unknown): void {
  if (!Array.isArray(schedules)) {
    return;
  }
  schedules.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const schedule = CalendarEventSchedule.fromObject(entry as Record<string, any>);
    if (schedule.isExclusion || !schedule.eventEndTime || !schedule.startDate) {
      return;
    }
    if (schedule.eventEndTime < schedule.startDate) {
      throw new ValidationError(
        `schedules[${i}].eventEndTime: end is before start`,
        { schedules: ['end is before start'] },
      );
    }
  });
}
