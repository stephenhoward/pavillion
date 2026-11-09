import { describe, it, expect } from 'vitest';
import { parseByDayEntry, findInvalidByDayEntry, hasUnreachableByDayOrdinal } from '@/common/utils/recurrence-by-day';
import { EventFrequency } from '@/common/model/events';

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

describe('findInvalidByDayEntry', () => {
  const { DAILY, WEEKLY, MONTHLY, YEARLY } = EventFrequency;

  it('accepts plain codes for every frequency', () => {
    for (const f of [DAILY, WEEKLY, MONTHLY, YEARLY]) {
      expect(findInvalidByDayEntry(f, ['MO', 'FR'])).toBeNull();
    }
  });

  it('accepts monthly ordinals from -5 to 5 except 0', () => {
    expect(findInvalidByDayEntry(MONTHLY, ['1MO', '5TU', '-1FR', '-5SU'])).toBeNull();
  });

  it('accepts yearly ordinals from -53 to 53 except 0', () => {
    expect(findInvalidByDayEntry(YEARLY, ['53MO', '-53MO', '20TU'])).toBeNull();
  });

  it('accepts anything for a one-off and absent byDay', () => {
    expect(findInvalidByDayEntry(null, ['6MO'])).toBeNull();
    expect(findInvalidByDayEntry(MONTHLY, undefined)).toBeNull();
    expect(findInvalidByDayEntry(MONTHLY, null)).toBeNull();
  });

  it('rejects a zero ordinal', () => {
    expect(findInvalidByDayEntry(MONTHLY, ['0MO'])).toEqual(expect.any(String));
    expect(findInvalidByDayEntry(YEARLY, ['0MO'])).toEqual(expect.any(String));
  });

  it('rejects monthly ordinals beyond 5', () => {
    expect(findInvalidByDayEntry(MONTHLY, ['6MO'])).toEqual(expect.any(String));
    expect(findInvalidByDayEntry(MONTHLY, ['-6MO'])).toEqual(expect.any(String));
  });

  it('rejects yearly ordinals beyond 53', () => {
    expect(findInvalidByDayEntry(YEARLY, ['54MO'])).toEqual(expect.any(String));
  });

  it('rejects any ordinal on daily and weekly rules', () => {
    expect(findInvalidByDayEntry(DAILY, ['1MO'])).toEqual(expect.any(String));
    expect(findInvalidByDayEntry(WEEKLY, ['-1MO'])).toEqual(expect.any(String));
  });

  it('rejects unparsable tokens and malformed input', () => {
    expect(findInvalidByDayEntry(WEEKLY, ['garbage'])).toEqual(expect.any(String));
    expect(findInvalidByDayEntry(WEEKLY, ['XX'])).toEqual(expect.any(String));
    expect(findInvalidByDayEntry(WEEKLY, [5])).toEqual(expect.any(String));
    expect(findInvalidByDayEntry(WEEKLY, 'MO')).toEqual(expect.any(String));
  });
});

describe('hasUnreachableByDayOrdinal', () => {
  const { WEEKLY, MONTHLY, YEARLY } = EventFrequency;

  it('flags ordinals that can never match', () => {
    expect(hasUnreachableByDayOrdinal(MONTHLY, ['6MO'])).toBe(true);
    expect(hasUnreachableByDayOrdinal(MONTHLY, ['-6MO'])).toBe(true);
    expect(hasUnreachableByDayOrdinal(MONTHLY, ['0MO'])).toBe(true);
    expect(hasUnreachableByDayOrdinal(YEARLY, ['54MO'])).toBe(true);
    expect(hasUnreachableByDayOrdinal(MONTHLY, ['1MO', '6TU'])).toBe(true);
  });

  it('does not flag reachable or ignored entries', () => {
    expect(hasUnreachableByDayOrdinal(MONTHLY, ['5MO'])).toBe(false);
    expect(hasUnreachableByDayOrdinal(YEARLY, ['53MO'])).toBe(false);
    expect(hasUnreachableByDayOrdinal(WEEKLY, ['2MO'])).toBe(false);
    expect(hasUnreachableByDayOrdinal(MONTHLY, ['garbage'])).toBe(false);
    expect(hasUnreachableByDayOrdinal(MONTHLY, [])).toBe(false);
    expect(hasUnreachableByDayOrdinal(null, ['6MO'])).toBe(false);
    expect(hasUnreachableByDayOrdinal(MONTHLY, undefined)).toBe(false);
  });
});
