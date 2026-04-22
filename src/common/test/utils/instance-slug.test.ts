import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { formatInstanceSlug, parseInstanceSlug } from '@/common/utils/instance-slug';

describe('formatInstanceSlug', () => {
  it('formats a UTC DateTime to yyyymmdd-hhmm', () => {
    const dt = DateTime.fromISO('2026-05-01T18:30:00Z', { zone: 'utc' });
    expect(formatInstanceSlug(dt)).toBe('20260501-1830');
  });

  it('converts a zoned DateTime to UTC before formatting', () => {
    const dt = DateTime.fromISO('2026-05-01T14:30:00-04:00');
    expect(formatInstanceSlug(dt)).toBe('20260501-1830');
  });

  it('pads single-digit components with zeros', () => {
    const dt = DateTime.fromISO('2026-01-02T03:04:00Z', { zone: 'utc' });
    expect(formatInstanceSlug(dt)).toBe('20260102-0304');
  });
});

describe('parseInstanceSlug', () => {
  it('parses a valid slug to a UTC DateTime', () => {
    const result = parseInstanceSlug('20260501-1830');
    expect(result).not.toBeNull();
    expect(result!.zoneName).toBe('UTC');
    expect(result!.toISO()).toBe('2026-05-01T18:30:00.000Z');
  });

  it('round-trips through formatInstanceSlug', () => {
    const dt = DateTime.fromISO('2026-07-15T09:45:00Z', { zone: 'utc' });
    expect(parseInstanceSlug(formatInstanceSlug(dt))!.toMillis()).toBe(dt.toMillis());
  });

  it('returns null for structurally-malformed slugs', () => {
    expect(parseInstanceSlug('')).toBeNull();
    expect(parseInstanceSlug('20260501')).toBeNull();
    expect(parseInstanceSlug('2026-05-01-18-30')).toBeNull();
    expect(parseInstanceSlug('20260501_1830')).toBeNull();
    expect(parseInstanceSlug('abcd0501-1830')).toBeNull();
    expect(parseInstanceSlug('20260501-18300')).toBeNull();
  });

  it('rejects over-length input without triggering regex work', () => {
    // Length cap is defense-in-depth: the anchored regex would reject these
    // anyway, but the explicit guard avoids any regex engine work on
    // pathologically long inputs from untrusted callers.
    expect(parseInstanceSlug('202605011-1830')).toBeNull(); // 14 chars, extra digit
    expect(parseInstanceSlug('2'.repeat(200))).toBeNull();  // pathological length
  });

  it('returns null for semantically-invalid values', () => {
    expect(parseInstanceSlug('20261301-1830')).toBeNull(); // month 13
    expect(parseInstanceSlug('20260532-1830')).toBeNull(); // day 32
    expect(parseInstanceSlug('20260501-2500')).toBeNull(); // hour 25
    expect(parseInstanceSlug('20260501-1860')).toBeNull(); // minute 60
    expect(parseInstanceSlug('20260229-1200')).toBeNull(); // 2026 is not a leap year
  });

  it('rejects years outside the plausible bookmark range', () => {
    // Year bounds: [currentYear - 5, currentYear + 10].
    // These tests stay stable over time because they test the extremes.
    expect(parseInstanceSlug('00010101-0000')).toBeNull();
    expect(parseInstanceSlug('18000101-0000')).toBeNull();
    expect(parseInstanceSlug('99991231-2359')).toBeNull();
    // A year 50 years in the future should always be out of bounds.
    const farFuture = String(new Date().getUTCFullYear() + 50).padStart(4, '0');
    expect(parseInstanceSlug(`${farFuture}0101-0000`)).toBeNull();
  });
});
