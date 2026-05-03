import { describe, it, expect } from 'vitest';
import { CalendarEventSchedule } from '@/common/model/events';
import { generateRecurrenceText, getRecurrenceText, type TranslateFn } from '@/common/utils/recurrence-text';

function makeSchedule(overrides: Partial<{
  frequency: string | null;
  interval: number;
  byDay: string[];
  isExclusion: boolean;
}>): CalendarEventSchedule {
  const schedule = new CalendarEventSchedule();
  schedule.frequency = (overrides.frequency as any) ?? null;
  schedule.interval = overrides.interval ?? 1;
  schedule.byDay = overrides.byDay ?? [];
  schedule.isExclusion = overrides.isExclusion ?? false;
  return schedule;
}

/**
 * Identity-style translator stub: returns the key, optionally suffixed with a
 * deterministic JSON-serialized params object. This lets the tests assert on
 * key-routing logic (which is what the function is now responsible for)
 * without coupling the assertions to translation-file contents.
 */
const stubT: TranslateFn = (key, params) => {
  if (!params || Object.keys(params).length === 0) {
    return key;
  }
  // Stable param ordering for deterministic assertion strings
  const sortedKeys = Object.keys(params).sort();
  const sortedParams: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sortedParams[k] = params[k];
  }
  return key + ':' + JSON.stringify(sortedParams);
};

describe('generateRecurrenceText', () => {
  describe('null frequency', () => {
    it('should return empty string for schedule without frequency', () => {
      const schedule = makeSchedule({ frequency: null });
      expect(generateRecurrenceText(schedule, stubT)).toBe('');
    });
  });

  describe('daily frequency', () => {
    it('should return every_day key for interval=1', () => {
      const schedule = makeSchedule({ frequency: 'daily', interval: 1 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.every_day');
    });

    it('should return every_n_days key with n=2', () => {
      const schedule = makeSchedule({ frequency: 'daily', interval: 2 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.every_n_days:{"n":2}');
    });

    it('should return every_n_days key with n=3', () => {
      const schedule = makeSchedule({ frequency: 'daily', interval: 3 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.every_n_days:{"n":3}');
    });
  });

  describe('weekly frequency', () => {
    it('should return weekly_every_week key when no byDay specified', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.weekly_every_week');
    });

    it('should return weekly_on_days key with single day translated via stub', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['SA'] });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.weekly_on_days:{"days":"recurrence.SA"}');
    });

    it('should return weekly_on_days key for single Monday', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['MO'] });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.weekly_on_days:{"days":"recurrence.MO"}');
    });

    it('should join two days via Intl.ListFormat in en', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['MO', 'WE'] });
      // Intl.ListFormat('en', conjunction) for ['recurrence.MO', 'recurrence.WE']
      // produces "recurrence.MO and recurrence.WE"
      expect(generateRecurrenceText(schedule, stubT, 'en'))
        .toBe('recurrence.weekly_on_days:{"days":"recurrence.MO and recurrence.WE"}');
    });

    it('should join three days via Intl.ListFormat in en', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] });
      expect(generateRecurrenceText(schedule, stubT, 'en'))
        .toBe('recurrence.weekly_on_days:{"days":"recurrence.MO, recurrence.WE, and recurrence.FR"}');
    });

    it('should return every_n_weeks key for biweekly without days', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 2 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.every_n_weeks:{"n":2}');
    });

    it('should return every_n_weeks_on_days key for biweekly with one day', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 2, byDay: ['SA'] });
      expect(generateRecurrenceText(schedule, stubT))
        .toBe('recurrence.every_n_weeks_on_days:{"days":"recurrence.SA","n":2}');
    });

    it('should return every_n_weeks_on_days key for biweekly with two days', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 2, byDay: ['MO', 'FR'] });
      expect(generateRecurrenceText(schedule, stubT, 'en'))
        .toBe('recurrence.every_n_weeks_on_days:{"days":"recurrence.MO and recurrence.FR","n":2}');
    });

    it('uses locale-correct conjunction for non-English language', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['MO', 'TU'] });
      // Spanish Intl.ListFormat conjunction joins with " y " for two items
      const enResult = generateRecurrenceText(schedule, stubT, 'en');
      const esResult = generateRecurrenceText(schedule, stubT, 'es');
      expect(enResult).toContain('recurrence.MO and recurrence.TU');
      expect(esResult).toContain('recurrence.MO y recurrence.TU');
      expect(esResult).not.toEqual(enResult);
    });
  });

  describe('monthly frequency', () => {
    it('should return monthly key for plain monthly without byDay', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.monthly');
    });

    it('should return nth_weekday_of_month key for 1SA', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['1SA'] });
      expect(generateRecurrenceText(schedule, stubT))
        .toBe('recurrence.nth_weekday_of_month:{"day":"recurrence.SA","ordinal":"recurrence.1ord"}');
    });

    it('should return nth_weekday_of_month key for 2MO', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['2MO'] });
      expect(generateRecurrenceText(schedule, stubT))
        .toBe('recurrence.nth_weekday_of_month:{"day":"recurrence.MO","ordinal":"recurrence.2ord"}');
    });

    it('should return nth_weekday_of_month key for 3FR', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['3FR'] });
      expect(generateRecurrenceText(schedule, stubT))
        .toBe('recurrence.nth_weekday_of_month:{"day":"recurrence.FR","ordinal":"recurrence.3ord"}');
    });

    it('should return nth_weekday_of_month key for 4WE', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['4WE'] });
      expect(generateRecurrenceText(schedule, stubT))
        .toBe('recurrence.nth_weekday_of_month:{"day":"recurrence.WE","ordinal":"recurrence.4ord"}');
    });

    it('should return nth_weekday_of_month key for -1SA (last)', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['-1SA'] });
      expect(generateRecurrenceText(schedule, stubT))
        .toBe('recurrence.nth_weekday_of_month:{"day":"recurrence.SA","ordinal":"recurrence.-1ord"}');
    });

    it('should return nth_weekday_every_n_months key for 1SA with interval=2', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 2, byDay: ['1SA'] });
      expect(generateRecurrenceText(schedule, stubT))
        .toBe('recurrence.nth_weekday_every_n_months:{"day":"recurrence.SA","n":2,"ordinal":"recurrence.1ord"}');
    });

    it('should return every_n_months key for interval=3 without byDay', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 3 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.every_n_months:{"n":3}');
    });
  });

  describe('yearly frequency', () => {
    it('should return yearly key for interval=1', () => {
      const schedule = makeSchedule({ frequency: 'yearly', interval: 1 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.yearly');
    });

    it('should return every_n_years key for interval=2', () => {
      const schedule = makeSchedule({ frequency: 'yearly', interval: 2 });
      expect(generateRecurrenceText(schedule, stubT)).toBe('recurrence.every_n_years:{"n":2}');
    });
  });
});

describe('getRecurrenceText', () => {
  it('should return empty string for empty schedules array', () => {
    expect(getRecurrenceText([], stubT)).toBe('');
  });

  it('should return empty string when all schedules are exclusions', () => {
    const schedule = makeSchedule({ frequency: 'weekly', isExclusion: true });
    expect(getRecurrenceText([schedule], stubT)).toBe('');
  });

  it('should return empty string when all schedules have no frequency', () => {
    const schedule = makeSchedule({ frequency: null });
    expect(getRecurrenceText([schedule], stubT)).toBe('');
  });

  it('should return text for the first non-exclusion schedule', () => {
    const exclusion = makeSchedule({ frequency: 'weekly', isExclusion: true, byDay: ['MO'] });
    const primary = makeSchedule({ frequency: 'weekly', byDay: ['SA'] });
    expect(getRecurrenceText([exclusion, primary], stubT))
      .toBe('recurrence.weekly_on_days:{"days":"recurrence.SA"}');
  });

  it('should return text from the first schedule with frequency', () => {
    const noFreq = makeSchedule({ frequency: null });
    const weekly = makeSchedule({ frequency: 'weekly', byDay: ['FR'] });
    expect(getRecurrenceText([noFreq, weekly], stubT))
      .toBe('recurrence.weekly_on_days:{"days":"recurrence.FR"}');
  });

  it('should return text for a single weekly schedule', () => {
    const schedule = makeSchedule({ frequency: 'weekly', byDay: ['SA'] });
    expect(getRecurrenceText([schedule], stubT))
      .toBe('recurrence.weekly_on_days:{"days":"recurrence.SA"}');
  });
});
