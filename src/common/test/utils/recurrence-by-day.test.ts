import { describe, it, expect } from 'vitest';
import { parseByDayEntry } from '@/common/utils/recurrence-by-day';

describe('parseByDayEntry', () => {
  describe('plain weekday codes (no ordinal)', () => {
    it('parses a plain code with a null ordinal', () => {
      expect(parseByDayEntry('MO')).toEqual({ ordinal: null, dayCode: 'MO' });
    });

    it('accepts every valid ISO weekday code', () => {
      for (const code of ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']) {
        expect(parseByDayEntry(code)).toEqual({ ordinal: null, dayCode: code });
      }
    });
  });

  describe('ordinal-prefixed codes', () => {
    it('parses a positive ordinal', () => {
      expect(parseByDayEntry('1MO')).toEqual({ ordinal: 1, dayCode: 'MO' });
    });

    it('parses a multi-digit positive ordinal', () => {
      expect(parseByDayEntry('10TU')).toEqual({ ordinal: 10, dayCode: 'TU' });
    });

    it('parses a negative ordinal', () => {
      expect(parseByDayEntry('-1FR')).toEqual({ ordinal: -1, dayCode: 'FR' });
    });

    it('parses a zero ordinal as 0 rather than null', () => {
      expect(parseByDayEntry('0SA')).toEqual({ ordinal: 0, dayCode: 'SA' });
    });
  });

  describe('invalid input', () => {
    it('rejects an unknown two-letter day code', () => {
      expect(parseByDayEntry('XX')).toBeNull();
      expect(parseByDayEntry('1XX')).toBeNull();
    });

    it('rejects lowercase codes', () => {
      expect(parseByDayEntry('mo')).toBeNull();
      expect(parseByDayEntry('1mo')).toBeNull();
    });

    it('rejects an empty string', () => {
      expect(parseByDayEntry('')).toBeNull();
    });

    it('rejects malformed tokens', () => {
      expect(parseByDayEntry('MON')).toBeNull();
      expect(parseByDayEntry('M')).toBeNull();
      expect(parseByDayEntry('1')).toBeNull();
      expect(parseByDayEntry('MO1')).toBeNull();
      expect(parseByDayEntry('1 MO')).toBeNull();
      expect(parseByDayEntry('1.5MO')).toBeNull();
    });
  });
});
