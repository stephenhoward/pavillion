import { expect, describe, it } from 'vitest';
import { CALENDAR_URL_NAME_RE, isClaimableCalendarUrlName } from '@/common/validation/calendarUrlName';

/**
 * Unit Tests: Calendar Name Auto-fill Slug Generation
 *
 * Tests the slug generation algorithm used to auto-populate
 * the Calendar Name field from the Calendar Title.
 *
 * Generated slugs are checked against the shape rule, CALENDAR_URL_NAME_RE.
 * A slug can be shape-valid yet reserved; CreateCalendarForm.vue reports
 * that on submit rather than altering the slug.
 */

// Replicated from CreateCalendarForm.vue for isolated unit testing
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 24)
    .replace(/^[-_]|[-_]$/g, '');
}

describe('Calendar Name Auto-fill Slug Generation', () => {
  describe('Basic slug generation', () => {
    it('lowercases the title', () => {
      expect(slugify('MyCalendar')).toBe('mycalendar');
    });

    it('replaces spaces with hyphens', () => {
      expect(slugify('my community calendar')).toBe('my-community-calendar');
    });

    it('converts a typical title to a valid slug', () => {
      const slug = slugify('My Community Calendar');
      expect(slug).toBe('my-community-calendar');
    });

    it('strips special characters except underscores and hyphens', () => {
      expect(slugify('Hello! World@2025')).toBe('hello-world2025');
    });

    it('preserves underscores', () => {
      expect(slugify('my_calendar')).toBe('my_calendar');
    });

    it('preserves existing hyphens', () => {
      expect(slugify('my-calendar')).toBe('my-calendar');
    });

    it('collapses multiple spaces into a single hyphen', () => {
      expect(slugify('too  many   spaces')).toBe('too-many-spaces');
    });

    it('collapses multiple hyphens into one', () => {
      expect(slugify('a--b---c')).toBe('a-b-c');
    });
  });

  describe('Length truncation', () => {
    it('truncates to 24 characters', () => {
      const long = 'this is a very long title that exceeds the limit';
      const slug = slugify(long);
      expect(slug.length).toBeLessThanOrEqual(24);
    });

    it('does not add a trailing hyphen after truncation', () => {
      // 'abcdefghij klmnopqrstu vwxyz' — space at position 10 would produce hyphen at edge
      const title = 'abcdefghijklmnopqrstu vwxyz';
      const slug = slugify(title);
      expect(slug).not.toMatch(/[-_]$/);
    });
  });

  describe('Edge-case inputs', () => {
    it('handles empty string', () => {
      expect(slugify('')).toBe('');
    });

    it('handles all-special-character string', () => {
      expect(slugify('!!!???')).toBe('');
    });

    it('strips leading hyphens', () => {
      // "-hello" after special char removal should have leading hyphen stripped
      expect(slugify('-hello')).toBe('hello');
    });

    it('strips trailing hyphens', () => {
      expect(slugify('hello-')).toBe('hello');
    });
  });

  describe('Server-side validation compatibility', () => {
    it('slug for "My Community Calendar" passes server urlName pattern', () => {
      const slug = slugify('My Community Calendar');
      expect(CALENDAR_URL_NAME_RE.test(slug)).toBe(true);
    });

    it('slug for "Arts & Culture Events" passes server urlName pattern', () => {
      const slug = slugify('Arts & Culture Events');
      expect(CALENDAR_URL_NAME_RE.test(slug)).toBe(true);
    });

    it('slug for "Summer Festival 2025" passes server urlName pattern', () => {
      const slug = slugify('Summer Festival 2025');
      expect(CALENDAR_URL_NAME_RE.test(slug)).toBe(true);
    });

    it('slug for "Springfield Chamber of Commerce" passes server urlName pattern', () => {
      const slug = slugify('Springfield Chamber of Commerce');
      expect(CALENDAR_URL_NAME_RE.test(slug)).toBe(true);
    });

    it('slug for "Admin" is shape-valid but reserved', () => {
      const slug = slugify('Admin');
      expect(slug).toBe('admin');
      expect(CALENDAR_URL_NAME_RE.test(slug)).toBe(true);
      expect(isClaimableCalendarUrlName(slug)).toBe(false);
    });
  });
});
