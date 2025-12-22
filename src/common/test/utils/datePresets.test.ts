import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { getThisWeek, getNextWeek, getDefaultDateRange } from '@/common/utils/datePresets';

describe('Date Preset Utilities', () => {
  describe('getThisWeek', () => {
    it('should return Sunday-Saturday of current week', () => {
      const { startDate, endDate } = getThisWeek();

      // Parse the dates
      const start = DateTime.fromISO(startDate);
      const end = DateTime.fromISO(endDate);

      // Start should be a Sunday
      expect(start.weekday).toBe(7); // Luxon: Sunday is 7
      // End should be a Saturday
      expect(end.weekday).toBe(6); // Luxon: Saturday is 6

      // Should be 6 days apart
      expect(end.diff(start, 'days').days).toBe(6);
    });

    it('should return dates in ISO format (YYYY-MM-DD)', () => {
      const { startDate, endDate } = getThisWeek();

      // Should match ISO date format
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should handle year boundary correctly', () => {
      // Test a date in late December
      const testDate = DateTime.fromISO('2024-12-30'); // Monday
      const { startDate, endDate } = getThisWeek(testDate);

      const start = DateTime.fromISO(startDate);
      const end = DateTime.fromISO(endDate);

      // Should span year boundary
      expect(start.year).toBe(2024);
      expect(start.month).toBe(12);
      expect(start.day).toBe(29); // Sunday before Monday 12/30

      expect(end.year).toBe(2025);
      expect(end.month).toBe(1);
      expect(end.day).toBe(4); // Saturday after Sunday 12/29
    });
  });

  describe('getNextWeek', () => {
    it('should return Sunday-Saturday of next week', () => {
      const { startDate, endDate } = getNextWeek();

      const start = DateTime.fromISO(startDate);
      const end = DateTime.fromISO(endDate);

      // Start should be a Sunday
      expect(start.weekday).toBe(7);
      // End should be a Saturday
      expect(end.weekday).toBe(6);

      // Should be 6 days apart
      expect(end.diff(start, 'days').days).toBe(6);
    });

    it('should be exactly one week after this week', () => {
      const thisWeek = getThisWeek();
      const nextWeek = getNextWeek();

      const thisStart = DateTime.fromISO(thisWeek.startDate);
      const nextStart = DateTime.fromISO(nextWeek.startDate);

      // Next week should start 7 days after this week
      expect(nextStart.diff(thisStart, 'days').days).toBe(7);
    });

    it('should return dates in ISO format (YYYY-MM-DD)', () => {
      const { startDate, endDate } = getNextWeek();

      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should handle year boundary correctly', () => {
      // Test a date in late December where next week spans into new year
      const testDate = DateTime.fromISO('2024-12-30'); // Monday
      const { startDate, endDate } = getNextWeek(testDate);

      const start = DateTime.fromISO(startDate);
      const end = DateTime.fromISO(endDate);

      // Next week starts on Sunday Jan 5, 2025 (one week after Dec 29)
      expect(start.year).toBe(2025);
      expect(start.month).toBe(1);
      expect(start.day).toBe(5); // Sunday of next week

      expect(end.year).toBe(2025);
      expect(end.month).toBe(1);
      expect(end.day).toBe(11); // Saturday of next week
    });
  });

  describe('Browser timezone handling', () => {
    it('should use system timezone when no date provided', () => {
      const { startDate } = getThisWeek();
      const start = DateTime.fromISO(startDate);

      // Should have a valid timezone (system default)
      expect(start.zoneName).toBeTruthy();
      expect(start.isValid).toBe(true);
    });

    it('should respect provided date timezone', () => {
      const testDate = DateTime.fromISO('2024-11-15T12:00:00', { zone: 'America/New_York' });
      const { startDate } = getThisWeek(testDate);
      const start = DateTime.fromISO(startDate);

      expect(start.isValid).toBe(true);
    });
  });

  describe('getDefaultDateRange', () => {
    it('should return today as start date', () => {
      const testDate = DateTime.fromISO('2025-01-15');
      const { startDate } = getDefaultDateRange('2weeks', testDate);

      expect(startDate).toBe('2025-01-15');
    });

    it('should return 14 days from today as end date by default', () => {
      const testDate = DateTime.fromISO('2025-01-15');
      const { endDate } = getDefaultDateRange('2weeks', testDate);

      expect(endDate).toBe('2025-01-29');
    });

    it('should return dates in ISO format (YYYY-MM-DD)', () => {
      const { startDate, endDate } = getDefaultDateRange();

      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should handle year boundary correctly', () => {
      const testDate = DateTime.fromISO('2024-12-25');
      const { startDate, endDate } = getDefaultDateRange('2weeks', testDate);

      expect(startDate).toBe('2024-12-25');
      expect(endDate).toBe('2025-01-08');
    });

    it('should span exactly 14 days for 2weeks range', () => {
      const { startDate, endDate } = getDefaultDateRange('2weeks');

      const start = DateTime.fromISO(startDate);
      const end = DateTime.fromISO(endDate);

      expect(end.diff(start, 'days').days).toBe(14);
    });

    it('should span exactly 7 days for 1week range', () => {
      const testDate = DateTime.fromISO('2025-01-15');
      const { startDate, endDate } = getDefaultDateRange('1week', testDate);

      expect(startDate).toBe('2025-01-15');
      expect(endDate).toBe('2025-01-22');

      const start = DateTime.fromISO(startDate);
      const end = DateTime.fromISO(endDate);
      expect(end.diff(start, 'days').days).toBe(7);
    });

    it('should span exactly 30 days for 1month range', () => {
      const testDate = DateTime.fromISO('2025-01-15');
      const { startDate, endDate } = getDefaultDateRange('1month', testDate);

      expect(startDate).toBe('2025-01-15');
      expect(endDate).toBe('2025-02-14');

      const start = DateTime.fromISO(startDate);
      const end = DateTime.fromISO(endDate);
      expect(end.diff(start, 'days').days).toBe(30);
    });

    it('should default to 2weeks if no range type specified', () => {
      const testDate = DateTime.fromISO('2025-01-15');
      const defaultResult = getDefaultDateRange(undefined, testDate);
      const explicitResult = getDefaultDateRange('2weeks', testDate);

      expect(defaultResult.startDate).toBe(explicitResult.startDate);
      expect(defaultResult.endDate).toBe(explicitResult.endDate);
    });
  });
});
