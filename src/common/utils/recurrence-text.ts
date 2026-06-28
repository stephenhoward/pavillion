import { CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import { parseByDayEntry } from '@/common/utils/recurrence-by-day';

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
 * Parses a BYDAY entry expected to encode an nth-weekday pattern.
 *
 * Wraps the shared {@link parseByDayEntry} and applies this helper's policy:
 * an ordinal is REQUIRED. Plain weekday codes (no ordinal) are rejected here
 * so they fall through to the generic 'Monthly' rendering, preserving the
 * original behavior of this display path.
 *
 * @param entry - A BYDAY token such as `1MO` or `-1SA`
 * @returns `{ ordinal, day }` on success, or `null` if the token does not
 *   match or carries no ordinal
 */
function parseNthWeekday(entry: string): { ordinal: number; day: string } | null {
  const parsed = parseByDayEntry(entry);
  if (!parsed || parsed.ordinal === null) {
    return null;
  }
  return { ordinal: parsed.ordinal, day: parsed.dayCode };
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
 * Translation function shape compatible with i18next's `t`. Accepts a key and
 * optional interpolation params and returns the rendered string.
 */
export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * Joins a list of pre-translated day names into a single locale-correct string
 * using `Intl.ListFormat` so multi-day phrases respect the active locale's
 * conjunction conventions (e.g. "Monday and Tuesday" vs. "Monday y Tuesday").
 *
 * @param days - Array of pre-translated day names
 * @param language - BCP-47 language tag (defaults to 'en')
 */
function joinDayList(days: string[], language: string): string {
  if (days.length === 0) return '';
  if (days.length === 1) return days[0];
  try {
    const formatter = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' });
    return formatter.format(days);
  }
  catch {
    // Defensive fallback for environments without Intl.ListFormat support
    if (days.length === 2) return `${days[0]} and ${days[1]}`;
    return `${days.slice(0, -1).join(', ')}, and ${days[days.length - 1]}`;
  }
}

/**
 * Generates a localized, human-readable recurrence pattern string from a
 * CalendarEventSchedule.
 *
 * The function is i18n-aware: callers pass an UNPREFIXED i18next `t` (i.e. one
 * obtained via `useTranslation('event_editor')` without `keyPrefix`) so the
 * utility can resolve full keys like `recurrence.every_day`. The optional
 * `language` parameter feeds `Intl.ListFormat` for locale-correct day-list
 * conjunction joining; defaults to `'en'` when omitted.
 *
 * Used by authenticated-client callers (event_recurrence.vue) that need a
 * compact rendered summary. Server / public site code should prefer the
 * structured {@link generateRecurrenceSummary} API and render at the
 * presentation layer.
 *
 * @param schedule - The CalendarEventSchedule to generate text for
 * @param t - Unprefixed i18next translation function for `event_editor` namespace
 * @param language - Optional BCP-47 language tag for `Intl.ListFormat`
 * @returns Localized recurrence pattern string, or empty string if not recurring
 * @deprecated Prefer {@link generateRecurrenceSummary} and render at the presentation layer.
 */
export function generateRecurrenceText(
  schedule: CalendarEventSchedule,
  t: TranslateFn,
  language: string = 'en',
): string {
  if (!schedule.frequency) {
    return '';
  }

  const interval = schedule.interval || 1;
  const byDay = schedule.byDay ?? [];

  switch (schedule.frequency) {
    case EventFrequency.DAILY: {
      if (interval === 1) {
        return t('recurrence.every_day');
      }
      return t('recurrence.every_n_days', { n: interval });
    }

    case EventFrequency.WEEKLY: {
      const dayNames = byDay
        .filter(d => VALID_DAY_CODES.has(d))
        .map(d => t('recurrence.' + d));

      const daysText = joinDayList(dayNames, language);

      if (interval === 1) {
        return daysText
          ? t('recurrence.weekly_on_days', { days: daysText })
          : t('recurrence.weekly_every_week');
      }
      return daysText
        ? t('recurrence.every_n_weeks_on_days', { n: interval, days: daysText })
        : t('recurrence.every_n_weeks', { n: interval });
    }

    case EventFrequency.MONTHLY: {
      // Detect "Nth weekday of the month" patterns (e.g. '1MO', '3FR', '-1SA')
      const nthEntry = byDay
        .map(parseNthWeekday)
        .find((entry): entry is { ordinal: number; day: string } => entry !== null);

      if (nthEntry) {
        const ordinalText = t('recurrence.' + nthEntry.ordinal + 'ord');
        const dayText = t('recurrence.' + nthEntry.day);

        if (interval === 1) {
          return t('recurrence.nth_weekday_of_month', {
            ordinal: ordinalText,
            day: dayText,
          });
        }
        return t('recurrence.nth_weekday_every_n_months', {
          ordinal: ordinalText,
          day: dayText,
          n: interval,
        });
      }

      // Plain monthly recurrence
      if (interval === 1) {
        return t('recurrence.monthly');
      }
      return t('recurrence.every_n_months', { n: interval });
    }

    case EventFrequency.YEARLY: {
      if (interval === 1) {
        return t('recurrence.yearly');
      }
      return t('recurrence.every_n_years', { n: interval });
    }

    default:
      return '';
  }
}

/**
 * Generates localized recurrence text from the first non-exclusion schedule in
 * an array.
 *
 * @param schedules - Array of CalendarEventSchedule objects
 * @param t - Unprefixed i18next translation function for `event_editor` namespace
 * @param language - Optional BCP-47 language tag for `Intl.ListFormat`
 * @returns Localized recurrence pattern string, or empty string if no recurring schedule
 * @deprecated Prefer {@link getRecurrenceSummary} and render at the presentation layer.
 */
export function getRecurrenceText(
  schedules: CalendarEventSchedule[],
  t: TranslateFn,
  language: string = 'en',
): string {
  const primarySchedule = schedules.find(s => !s.isExclusion && s.frequency !== null);
  if (!primarySchedule) {
    return '';
  }
  return generateRecurrenceText(primarySchedule, t, language);
}
