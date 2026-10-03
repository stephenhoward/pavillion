import { describe, it, expect } from 'vitest';
import { CALENDAR_URL_NAME_RE } from '@/common/validation/calendarUrlName';

/**
 * Calendar url-name shape rule tests.
 *
 * Exercises CALENDAR_URL_NAME_RE, the shape rule only. Reserved-name
 * rejection is a separate check (isValidCalendarUrlName) and is not
 * covered here.
 *
 * Rules:
 *  - 3-24 characters long
 *  - Must start with a letter or digit
 *  - Must end with a letter, digit, or underscore (NOT hyphen)
 *  - Middle characters may be letters, digits, underscores, or hyphens
 */
function isValidCalendarName(name: string): boolean {
  return CALENDAR_URL_NAME_RE.test(name);
}

describe('Calendar name validation', () => {

  describe('valid names', () => {
    const validNames = [
      'legalusername',
      '9alsolegal',
      'alsolegal_',
      'my-calendar',
      'test-calendar-name',
      'my_test-calendar',
      'abc',                    // minimum length (3 chars)
      'abcdefghijklmnopqrstuvwx', // maximum length (24 chars)
      'UPPERCASE',
      'MixedCase',
      'a1b',
      '123',
    ];

    for (const name of validNames) {
      it(`should accept "${name}"`, () => {
        expect(isValidCalendarName(name)).toBe(true);
      });
    }
  });

  describe('leading character restrictions', () => {
    it('should reject leading hyphen', () => {
      expect(isValidCalendarName('-noleading')).toBe(false);
    });

    it('should reject leading underscore', () => {
      expect(isValidCalendarName('_noleadunderscore')).toBe(false);
    });
  });

  describe('trailing character restrictions', () => {
    it('should reject trailing hyphen', () => {
      expect(isValidCalendarName('notrailing-')).toBe(false);
    });

    it('should accept trailing underscore', () => {
      expect(isValidCalendarName('trailingok_')).toBe(true);
    });
  });

  describe('length requirements', () => {
    it('should reject empty string', () => {
      expect(isValidCalendarName('')).toBe(false);
    });

    it('should reject single character', () => {
      expect(isValidCalendarName('a')).toBe(false);
    });

    it('should reject two characters (too short)', () => {
      expect(isValidCalendarName('ab')).toBe(false);
    });

    it('should accept three characters (minimum)', () => {
      expect(isValidCalendarName('abc')).toBe(true);
    });

    it('should accept 24 characters (maximum)', () => {
      expect(isValidCalendarName('abcdefghijklmnopqrstuvwx')).toBe(true);
    });

    it('should reject 25 characters (too long)', () => {
      expect(isValidCalendarName('abcdefghijklmnopqrstuvwxy')).toBe(false);
    });
  });

  describe('special characters', () => {
    it('should reject spaces', () => {
      expect(isValidCalendarName('no spaces')).toBe(false);
    });

    it('should reject @ symbol', () => {
      expect(isValidCalendarName('illegal@char')).toBe(false);
    });

    it('should reject dots', () => {
      expect(isValidCalendarName('no.dots')).toBe(false);
    });

    it('should reject exclamation marks', () => {
      expect(isValidCalendarName('no!bang')).toBe(false);
    });

    it('should reject hash', () => {
      expect(isValidCalendarName('no#hash')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should reject both leading and trailing hyphens', () => {
      expect(isValidCalendarName('-bothinvalid-')).toBe(false);
    });

    it('should accept hyphens in the middle', () => {
      expect(isValidCalendarName('a-b-c')).toBe(true);
    });

    it('should accept underscores in the middle', () => {
      expect(isValidCalendarName('a_b_c')).toBe(true);
    });

    it('should accept mixed hyphens and underscores', () => {
      expect(isValidCalendarName('a-b_c')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isValidCalendarName('ABC')).toBe(true);
      expect(isValidCalendarName('AbCdEf')).toBe(true);
    });
  });
});
