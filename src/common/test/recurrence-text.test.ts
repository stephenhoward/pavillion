import { describe, test, expect } from 'vitest';

import { CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import { generateRecurrenceSummary, getRecurrenceSummary } from '@/common/utils/recurrence-text';

/**
 * Helper to build a CalendarEventSchedule with the provided recurrence fields.
 */
function buildSchedule(overrides: Partial<CalendarEventSchedule> = {}): CalendarEventSchedule {
  const schedule = new CalendarEventSchedule();
  schedule.frequency = overrides.frequency ?? null;
  schedule.interval = overrides.interval ?? 1;
  schedule.byDay = overrides.byDay ?? [];
  schedule.isExclusion = overrides.isExclusion ?? false;
  return schedule;
}

describe('generateRecurrenceSummary', () => {
  test('returns null when schedule has no frequency', () => {
    const schedule = buildSchedule({ frequency: null });
    expect(generateRecurrenceSummary(schedule)).toBeNull();
  });

  test('daily with interval 1 returns recurrence.every_day', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.DAILY, interval: 1 });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.every_day',
      params: {},
    });
  });

  test('daily with interval > 1 returns recurrence.every_n_days', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.DAILY, interval: 3 });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.every_n_days',
      params: { n: 3 },
    });
  });

  test('weekly with interval 1 and no byDay returns recurrence.weekly_every_week', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.WEEKLY, interval: 1, byDay: [] });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.weekly_every_week',
      params: {},
    });
  });

  test('weekly with interval 1 and byDay returns recurrence.weekly_on_days with raw ISO day codes', () => {
    const schedule = buildSchedule({
      frequency: EventFrequency.WEEKLY,
      interval: 1,
      byDay: ['MO', 'WE', 'FR'],
    });
    const result = generateRecurrenceSummary(schedule);

    expect(result).toEqual({
      key: 'recurrence.weekly_on_days',
      params: { days: ['MO', 'WE', 'FR'] },
    });
    // Explicit guard: raw ISO codes, not English names
    expect(result?.params.days).not.toContain('Monday');
    expect(result?.params.days).not.toContain('Wednesday');
  });

  test('weekly filters out invalid day codes', () => {
    const schedule = buildSchedule({
      frequency: EventFrequency.WEEKLY,
      interval: 1,
      byDay: ['MO', 'XX', 'FR'],
    });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.weekly_on_days',
      params: { days: ['MO', 'FR'] },
    });
  });

  test('weekly with interval > 1 and no byDay returns recurrence.every_n_weeks', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.WEEKLY, interval: 2, byDay: [] });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.every_n_weeks',
      params: { n: 2 },
    });
  });

  test('weekly with interval > 1 and byDay returns recurrence.every_n_weeks_on_days', () => {
    const schedule = buildSchedule({
      frequency: EventFrequency.WEEKLY,
      interval: 2,
      byDay: ['TU', 'TH'],
    });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.every_n_weeks_on_days',
      params: { n: 2, days: ['TU', 'TH'] },
    });
  });

  test('monthly plain with interval 1 returns recurrence.monthly', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.MONTHLY, interval: 1, byDay: [] });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.monthly',
      params: {},
    });
  });

  test('monthly plain with interval > 1 returns recurrence.every_n_months', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.MONTHLY, interval: 3, byDay: [] });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.every_n_months',
      params: { n: 3 },
    });
  });

  test('monthly nth-weekday with interval 1 returns recurrence.nth_weekday_of_month with integer ordinal', () => {
    const schedule = buildSchedule({
      frequency: EventFrequency.MONTHLY,
      interval: 1,
      byDay: ['1MO'],
    });
    const result = generateRecurrenceSummary(schedule);

    expect(result).toEqual({
      key: 'recurrence.nth_weekday_of_month',
      params: { ordinal: 1, day: 'MO' },
    });
    // Explicit guards: integer ordinal and raw ISO day code
    expect(result?.params.ordinal).toBe(1);
    expect(result?.params.ordinal).not.toBe('First');
    expect(result?.params.day).toBe('MO');
    expect(result?.params.day).not.toBe('Monday');
  });

  test('monthly nth-weekday supports negative ordinal (last)', () => {
    const schedule = buildSchedule({
      frequency: EventFrequency.MONTHLY,
      interval: 1,
      byDay: ['-1SA'],
    });
    const result = generateRecurrenceSummary(schedule);

    expect(result).toEqual({
      key: 'recurrence.nth_weekday_of_month',
      params: { ordinal: -1, day: 'SA' },
    });
    expect(result?.params.ordinal).toBe(-1);
    expect(result?.params.ordinal).not.toBe('Last');
  });

  test('monthly nth-weekday with interval > 1 returns recurrence.nth_weekday_every_n_months', () => {
    const schedule = buildSchedule({
      frequency: EventFrequency.MONTHLY,
      interval: 2,
      byDay: ['3FR'],
    });
    const result = generateRecurrenceSummary(schedule);

    expect(result).toEqual({
      key: 'recurrence.nth_weekday_every_n_months',
      params: { ordinal: 3, day: 'FR', n: 2 },
    });
    expect(result?.params.ordinal).toBe(3);
    expect(result?.params.ordinal).not.toBe('Third');
  });

  test('yearly with interval 1 returns recurrence.yearly', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.YEARLY, interval: 1 });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.yearly',
      params: {},
    });
  });

  test('yearly with interval > 1 returns recurrence.every_n_years', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.YEARLY, interval: 5 });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.every_n_years',
      params: { n: 5 },
    });
  });

  test('treats interval 0 or undefined as 1', () => {
    const schedule = buildSchedule({ frequency: EventFrequency.DAILY, interval: 0 });
    expect(generateRecurrenceSummary(schedule)).toEqual({
      key: 'recurrence.every_day',
      params: {},
    });
  });
});

describe('getRecurrenceSummary', () => {
  test('returns null when no schedules are provided', () => {
    expect(getRecurrenceSummary([])).toBeNull();
  });

  test('returns null when no schedule has a frequency', () => {
    const schedule = buildSchedule({ frequency: null });
    expect(getRecurrenceSummary([schedule])).toBeNull();
  });

  test('returns summary for first non-exclusion schedule with a frequency', () => {
    const exclusion = buildSchedule({ frequency: EventFrequency.DAILY, isExclusion: true });
    const primary = buildSchedule({ frequency: EventFrequency.WEEKLY, interval: 1, byDay: ['MO'] });

    expect(getRecurrenceSummary([exclusion, primary])).toEqual({
      key: 'recurrence.weekly_on_days',
      params: { days: ['MO'] },
    });
  });

  test('skips schedules without a frequency', () => {
    const noFreq = buildSchedule({ frequency: null });
    const primary = buildSchedule({ frequency: EventFrequency.YEARLY, interval: 1 });

    expect(getRecurrenceSummary([noFreq, primary])).toEqual({
      key: 'recurrence.yearly',
      params: {},
    });
  });
});
