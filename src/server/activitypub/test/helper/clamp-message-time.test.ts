import { describe, it, expect } from 'vitest';
import { clampMessageTime } from '@/server/activitypub/helper/clamp-message-time';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Match the helper's own definition of two years: 2 * 365 days.
const MS_PER_TWO_YEARS = 2 * 365 * MS_PER_DAY;

describe('clampMessageTime', () => {
  // Use a fixed reference clock so all expectations are deterministic.
  const now = new Date('2026-05-16T12:00:00.000Z');

  describe('within-window passthrough', () => {
    it('returns the parsed published value when within the window (ISO string)', () => {
      const published = new Date(now.getTime() - MS_PER_DAY).toISOString();
      const result = clampMessageTime(published, now);
      expect(result.toISOString()).toBe(published);
    });

    it('returns the parsed published value when within the window (Date instance)', () => {
      const published = new Date(now.getTime() - MS_PER_DAY);
      const result = clampMessageTime(published, now);
      expect(result.getTime()).toBe(published.getTime());
    });

    it('returns published at the lower boundary (now - 2y) unchanged', () => {
      const published = new Date(now.getTime() - MS_PER_TWO_YEARS);
      const result = clampMessageTime(published, now);
      expect(result.getTime()).toBe(published.getTime());
    });

    it('returns published at the upper boundary (now + 1h) unchanged', () => {
      const published = new Date(now.getTime() + MS_PER_HOUR);
      const result = clampMessageTime(published, now);
      expect(result.getTime()).toBe(published.getTime());
    });
  });

  describe('below-floor clamp', () => {
    it('clamps a published value older than now - 2y up to the floor', () => {
      // 3 years in the past — well below the 2y floor.
      const published = new Date(now.getTime() - 3 * 365 * MS_PER_DAY).toISOString();
      const result = clampMessageTime(published, now);
      expect(result.getTime()).toBe(now.getTime() - MS_PER_TWO_YEARS);
    });
  });

  describe('above-ceiling clamp', () => {
    it('clamps a published value newer than now + 1h down to the ceiling', () => {
      const published = new Date(now.getTime() + 2 * MS_PER_HOUR).toISOString();
      const result = clampMessageTime(published, now);
      expect(result.getTime()).toBe(now.getTime() + MS_PER_HOUR);
    });
  });

  describe('fallback to arrival time (now)', () => {
    it('returns now when published is undefined', () => {
      const result = clampMessageTime(undefined, now);
      expect(result.getTime()).toBe(now.getTime());
    });

    it('returns now when published is an empty string', () => {
      const result = clampMessageTime('', now);
      expect(result.getTime()).toBe(now.getTime());
    });

    it('returns now when published is a malformed string', () => {
      const result = clampMessageTime('not-a-date', now);
      expect(result.getTime()).toBe(now.getTime());
    });

    it('returns now when published parses to NaN (Invalid Date instance)', () => {
      const invalid = new Date('not-a-date');
      expect(Number.isNaN(invalid.getTime())).toBe(true);
      const result = clampMessageTime(invalid, now);
      expect(result.getTime()).toBe(now.getTime());
    });
  });
});
