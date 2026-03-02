import { describe, it, expect } from 'vitest';
import { CalendarEventSchedule } from '@/common/model/events';
import { generateRecurrenceText, getRecurrenceText } from '@/common/utils/recurrence-text';

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

describe('generateRecurrenceText', () => {
  describe('null frequency', () => {
    it('should return empty string for schedule without frequency', () => {
      const schedule = makeSchedule({ frequency: null });
      expect(generateRecurrenceText(schedule)).toBe('');
    });
  });

  describe('daily frequency', () => {
    it('should return "Every day" for interval=1', () => {
      const schedule = makeSchedule({ frequency: 'daily', interval: 1 });
      expect(generateRecurrenceText(schedule)).toBe('Every day');
    });

    it('should return "Every 2 days" for interval=2', () => {
      const schedule = makeSchedule({ frequency: 'daily', interval: 2 });
      expect(generateRecurrenceText(schedule)).toBe('Every 2 days');
    });

    it('should return "Every 3 days" for interval=3', () => {
      const schedule = makeSchedule({ frequency: 'daily', interval: 3 });
      expect(generateRecurrenceText(schedule)).toBe('Every 3 days');
    });
  });

  describe('weekly frequency', () => {
    it('should return "Every week" when no byDay specified', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1 });
      expect(generateRecurrenceText(schedule)).toBe('Every week');
    });

    it('should return "Every Saturday" for single day', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['SA'] });
      expect(generateRecurrenceText(schedule)).toBe('Every Saturday');
    });

    it('should return "Every Monday" for single day', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['MO'] });
      expect(generateRecurrenceText(schedule)).toBe('Every Monday');
    });

    it('should return "Every Monday and Wednesday" for two days', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['MO', 'WE'] });
      expect(generateRecurrenceText(schedule)).toBe('Every Monday and Wednesday');
    });

    it('should return "Every Monday, Wednesday, and Friday" for three days', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] });
      expect(generateRecurrenceText(schedule)).toBe('Every Monday, Wednesday, and Friday');
    });

    it('should return "Every 2 weeks" for biweekly without days', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 2 });
      expect(generateRecurrenceText(schedule)).toBe('Every 2 weeks');
    });

    it('should return "Every 2 weeks on Saturday" for biweekly with one day', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 2, byDay: ['SA'] });
      expect(generateRecurrenceText(schedule)).toBe('Every 2 weeks on Saturday');
    });

    it('should return "Every 2 weeks on Monday and Friday" for biweekly with two days', () => {
      const schedule = makeSchedule({ frequency: 'weekly', interval: 2, byDay: ['MO', 'FR'] });
      expect(generateRecurrenceText(schedule)).toBe('Every 2 weeks on Monday and Friday');
    });
  });

  describe('monthly frequency', () => {
    it('should return "Monthly" for plain monthly without byDay', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1 });
      expect(generateRecurrenceText(schedule)).toBe('Monthly');
    });

    it('should return "First Saturday of the month" for 1SA', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['1SA'] });
      expect(generateRecurrenceText(schedule)).toBe('First Saturday of the month');
    });

    it('should return "Second Monday of the month" for 2MO', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['2MO'] });
      expect(generateRecurrenceText(schedule)).toBe('Second Monday of the month');
    });

    it('should return "Third Friday of the month" for 3FR', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['3FR'] });
      expect(generateRecurrenceText(schedule)).toBe('Third Friday of the month');
    });

    it('should return "Fourth Wednesday of the month" for 4WE', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['4WE'] });
      expect(generateRecurrenceText(schedule)).toBe('Fourth Wednesday of the month');
    });

    it('should return "Last Saturday of the month" for -1SA', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 1, byDay: ['-1SA'] });
      expect(generateRecurrenceText(schedule)).toBe('Last Saturday of the month');
    });

    it('should return "First Saturday every 2 months" for 1SA with interval=2', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 2, byDay: ['1SA'] });
      expect(generateRecurrenceText(schedule)).toBe('First Saturday every 2 months');
    });

    it('should return "Every 3 months" for interval=3 without byDay', () => {
      const schedule = makeSchedule({ frequency: 'monthly', interval: 3 });
      expect(generateRecurrenceText(schedule)).toBe('Every 3 months');
    });
  });

  describe('yearly frequency', () => {
    it('should return "Yearly" for interval=1', () => {
      const schedule = makeSchedule({ frequency: 'yearly', interval: 1 });
      expect(generateRecurrenceText(schedule)).toBe('Yearly');
    });

    it('should return "Every 2 years" for interval=2', () => {
      const schedule = makeSchedule({ frequency: 'yearly', interval: 2 });
      expect(generateRecurrenceText(schedule)).toBe('Every 2 years');
    });
  });
});

describe('getRecurrenceText', () => {
  it('should return empty string for empty schedules array', () => {
    expect(getRecurrenceText([])).toBe('');
  });

  it('should return empty string when all schedules are exclusions', () => {
    const schedule = makeSchedule({ frequency: 'weekly', isExclusion: true });
    expect(getRecurrenceText([schedule])).toBe('');
  });

  it('should return empty string when all schedules have no frequency', () => {
    const schedule = makeSchedule({ frequency: null });
    expect(getRecurrenceText([schedule])).toBe('');
  });

  it('should return text for the first non-exclusion schedule', () => {
    const exclusion = makeSchedule({ frequency: 'weekly', isExclusion: true, byDay: ['MO'] });
    const primary = makeSchedule({ frequency: 'weekly', byDay: ['SA'] });
    expect(getRecurrenceText([exclusion, primary])).toBe('Every Saturday');
  });

  it('should return text from the first schedule with frequency', () => {
    const noFreq = makeSchedule({ frequency: null });
    const weekly = makeSchedule({ frequency: 'weekly', byDay: ['FR'] });
    expect(getRecurrenceText([noFreq, weekly])).toBe('Every Friday');
  });

  it('should return text for a single weekly schedule', () => {
    const schedule = makeSchedule({ frequency: 'weekly', byDay: ['SA'] });
    expect(getRecurrenceText([schedule])).toBe('Every Saturday');
  });
});
