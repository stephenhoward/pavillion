import { describe, it, expect } from 'vitest';

import { shiftDates, findEarliestDate } from '@/server/common/entity/db';

describe('shiftDates', () => {
  it('preserves the time component when shifting a naive datetime string forward', () => {
    // Naive string representing local time "08:00:00.000"
    const input = '2025-05-24T08:00:00.000';
    const result = shiftDates(input, 1);
    // The date should advance by one day but the time digits must remain 08:00:00.000
    expect(result).toBe('2025-05-25T08:00:00.000');
  });

  it('preserves the time component when shifting a naive datetime string backward', () => {
    const input = '2025-05-24T08:00:00.000';
    const result = shiftDates(input, -1);
    expect(result).toBe('2025-05-23T08:00:00.000');
  });

  it('preserves the time component when shifting across DST boundaries', () => {
    // Use an early-morning time that would be affected by DST offset if parsed as local
    const input = '2025-03-09T02:30:00.000';
    const result = shiftDates(input, 1);
    // Time digits must be unchanged — only the date increments
    expect(result).toBe('2025-03-10T02:30:00.000');
  });

  it('shifts a zero-offset by returning the same string unchanged', () => {
    const input = '2025-05-24T08:00:00.000';
    const result = shiftDates(input, 0);
    expect(result).toBe('2025-05-24T08:00:00.000');
  });

  it('does not match strings with timezone suffix (Z)', () => {
    // Strings with Z suffix should not be treated as naive ISO dates
    const input = '2025-05-24T08:00:00.000Z';
    const result = shiftDates(input, 1);
    // Should be returned unchanged since it does not match ISO_DATE_PATTERN
    expect(result).toBe('2025-05-24T08:00:00.000Z');
  });

  it('recursively shifts dates inside an object', () => {
    const input = {
      start_date: '2025-05-24T08:00:00.000',
      end_date: '2025-05-24T10:00:00.000',
      name: 'Test Event',
    };
    const result = shiftDates(input, 3) as Record<string, unknown>;
    expect(result.start_date).toBe('2025-05-27T08:00:00.000');
    expect(result.end_date).toBe('2025-05-27T10:00:00.000');
    expect(result.name).toBe('Test Event');
  });

  it('recursively shifts dates inside an array', () => {
    const input = [
      { start_date: '2025-05-24T08:00:00.000' },
      { start_date: '2025-05-25T09:00:00.000' },
    ];
    const result = shiftDates(input, 7) as Array<Record<string, unknown>>;
    expect(result[0].start_date).toBe('2025-05-31T08:00:00.000');
    expect(result[1].start_date).toBe('2025-06-01T09:00:00.000');
  });

  it('passes through non-date values unchanged', () => {
    expect(shiftDates(42, 1)).toBe(42);
    expect(shiftDates(null, 1)).toBe(null);
    expect(shiftDates('not a date', 1)).toBe('not a date');
    expect(shiftDates(true, 1)).toBe(true);
  });
});

describe('findEarliestDate', () => {
  it('returns null for data with no datetime strings', () => {
    expect(findEarliestDate({ name: 'test', count: 5 })).toBeNull();
    expect(findEarliestDate([])).toBeNull();
    expect(findEarliestDate('not a date')).toBeNull();
  });

  it('finds the earliest date in a flat object', () => {
    const data = {
      start: '2025-05-24T08:00:00.000',
      end: '2025-05-24T10:00:00.000',
    };
    const result = findEarliestDate(data);
    expect(result).not.toBeNull();
    // The earliest is start: 2025-05-24T08:00:00.000 (UTC since we append Z)
    expect(result!.toISOString()).toBe('2025-05-24T08:00:00.000Z');
  });

  it('finds the earliest date across nested objects', () => {
    const data = {
      event1: { start: '2025-06-01T08:00:00.000' },
      event2: { start: '2025-05-01T08:00:00.000' },
      event3: { start: '2025-07-01T08:00:00.000' },
    };
    const result = findEarliestDate(data);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2025-05-01T08:00:00.000Z');
  });

  it('finds the earliest date across an array of records', () => {
    const data = [
      { start_date: '2025-06-15T09:00:00.000' },
      { start_date: '2025-04-10T14:00:00.000' },
      { start_date: '2025-08-20T11:00:00.000' },
    ];
    const result = findEarliestDate(data);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2025-04-10T14:00:00.000Z');
  });

  it('preserves time digits — does not shift hours due to local timezone offset', () => {
    // If time "08:00:00" is parsed as LOCAL time, the resulting UTC toISOString
    // would differ depending on the host timezone. Parsing as UTC must keep "08:00:00Z".
    const data = { date: '2025-05-24T08:00:00.000' };
    const result = findEarliestDate(data);
    expect(result).not.toBeNull();
    // The UTC hour must always be 8, regardless of host timezone
    expect(result!.getUTCHours()).toBe(8);
  });
});
