import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  hasFewerThanTwoOccurrences,
  type RecurrenceOccurrenceInput,
} from '@/client/components/logged_in/calendar/recurrence-occurrences';

const ZONE = 'America/Los_Angeles';

/** A wall-clock start in the schedule's zone, independent of the runner's TZ. */
const start = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });

/** An "ends on" rule with the given end date. */
const endsOn = (overrides: Partial<RecurrenceOccurrenceInput>, endDate: string): RecurrenceOccurrenceInput => ({
  frequency: 'weekly',
  interval: 1,
  byDay: [],
  startDate: start('2026-03-03T10:00'),
  count: 0,
  ...overrides,
  endType: 'on',
  endDate,
});

describe('hasFewerThanTwoOccurrences', () => {
  describe('no end', () => {
    it('is false for endType none', () => {
      expect(hasFewerThanTwoOccurrences({
        frequency: 'weekly', interval: 1, byDay: [], startDate: start('2026-03-03T10:00'),
        endType: 'none', count: 0, endDate: '',
      })).toBe(false);
    });

    it('is false when there is no frequency, whatever the end type', () => {
      expect(hasFewerThanTwoOccurrences({
        frequency: '', interval: 1, byDay: [], startDate: start('2026-03-03T10:00'),
        endType: 'after', count: 1, endDate: '',
      })).toBe(false);
    });
  });

  describe('ends after a count', () => {
    const after = (count: number): RecurrenceOccurrenceInput => ({
      frequency: 'daily', interval: 1, byDay: [], startDate: start('2026-03-03T10:00'),
      endType: 'after', count, endDate: '',
    });

    it('warns after 1', () => {
      expect(hasFewerThanTwoOccurrences(after(1))).toBe(true);
    });

    it('does not warn after 2', () => {
      expect(hasFewerThanTwoOccurrences(after(2))).toBe(false);
    });
  });

  describe('ends on a date', () => {
    // Weekly from Tuesday 2026-03-03 10:00: the second occurrence is 2026-03-10 10:00.
    it('warns when the end date is the second occurrence\'s date, because until is 00:00 that day', () => {
      expect(hasFewerThanTwoOccurrences(endsOn({}, '2026-03-10'))).toBe(true);
    });

    it('warns when the end date is one day before the second occurrence', () => {
      expect(hasFewerThanTwoOccurrences(endsOn({}, '2026-03-09'))).toBe(true);
    });

    it('does not warn when the end date is the day after the second occurrence', () => {
      expect(hasFewerThanTwoOccurrences(endsOn({}, '2026-03-11'))).toBe(false);
    });

    it('is false with no end date chosen yet', () => {
      expect(hasFewerThanTwoOccurrences(endsOn({}, ''))).toBe(false);
    });

    it('does not count a Wednesday start for a Monday-only weekly rule', () => {
      // Occurrences are Mon 03-09 and Mon 03-16; the Wednesday start is not one.
      const wednesday = { byDay: ['MO'], startDate: start('2026-03-04T10:00') };
      expect(hasFewerThanTwoOccurrences(endsOn(wednesday, '2026-03-12'))).toBe(true);
      expect(hasFewerThanTwoOccurrences(endsOn(wednesday, '2026-03-17'))).toBe(false);
    });

    it('counts both weekdays of a two-weekday weekly rule', () => {
      const monWed = { byDay: ['MO', 'WE'], startDate: start('2026-03-02T10:00') };
      expect(hasFewerThanTwoOccurrences(endsOn(monWed, '2026-03-05'))).toBe(false);
      expect(hasFewerThanTwoOccurrences(endsOn(monWed, '2026-03-03'))).toBe(true);
    });

    it('expands a monthly nth-weekday rule', () => {
      // First Mondays: 2026-03-02, then 2026-04-06.
      const firstMonday = { frequency: 'monthly', byDay: ['1MO'], startDate: start('2026-03-02T10:00') };
      expect(hasFewerThanTwoOccurrences(endsOn(firstMonday, '2026-04-05'))).toBe(true);
      expect(hasFewerThanTwoOccurrences(endsOn(firstMonday, '2026-04-07'))).toBe(false);
    });

    it('steps by the interval', () => {
      // Every second week from 03-03: the second occurrence is 03-17.
      expect(hasFewerThanTwoOccurrences(endsOn({ interval: 2 }, '2026-03-16'))).toBe(true);
      expect(hasFewerThanTwoOccurrences(endsOn({ interval: 2 }, '2026-03-18'))).toBe(false);
    });

    it('treats an interval that is not a positive integer as 1', () => {
      expect(hasFewerThanTwoOccurrences(endsOn({ interval: 0 }, '2026-03-11'))).toBe(false);
    });

    it('expands a yearly rule', () => {
      const yearly = { frequency: 'yearly', startDate: start('2026-03-03T10:00') };
      expect(hasFewerThanTwoOccurrences(endsOn(yearly, '2027-03-02'))).toBe(true);
      expect(hasFewerThanTwoOccurrences(endsOn(yearly, '2027-03-04'))).toBe(false);
    });

    it('expands a late-evening Los Angeles start in its own wall clock, not UTC', () => {
      // 23:30 in Los Angeles is the next day in UTC. Daily from 03-10 23:30,
      // the second occurrence is 03-11 23:30, before 03-12 00:00 in Los Angeles.
      const lateDaily = { frequency: 'daily', startDate: start('2026-03-10T23:30') };
      expect(hasFewerThanTwoOccurrences(endsOn(lateDaily, '2026-03-12'))).toBe(false);
      expect(hasFewerThanTwoOccurrences(endsOn(lateDaily, '2026-03-11'))).toBe(true);
    });
  });
});
