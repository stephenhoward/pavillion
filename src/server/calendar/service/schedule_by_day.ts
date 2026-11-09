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
