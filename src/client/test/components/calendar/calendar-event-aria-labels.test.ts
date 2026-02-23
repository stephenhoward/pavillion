import { describe, it, expect, beforeEach } from 'vitest';
import i18next from 'i18next';
import { initI18Next } from '@/client/service/locale';

/**
 * Tests: Event action button aria-label translation keys
 *
 * Verifies that the Edit and Duplicate event buttons use translated strings
 * rather than hardcoded English prefixes, satisfying WCAG AA accessibility
 * requirements for non-English users.
 *
 * Related: calendar.vue lines 585, 594
 */
describe('Calendar event action aria-label translations', () => {
  beforeEach(() => {
    initI18Next();
  });

  it('should have translation key for edit event aria-label', () => {
    const result = i18next.t('calendar.event.edit_label', {
      ns: 'calendars',
      name: 'Test Event',
    });
    expect(result).toBe('Edit event: Test Event');
  });

  it('should have translation key for duplicate event aria-label', () => {
    const result = i18next.t('calendar.event.duplicate_label', {
      ns: 'calendars',
      name: 'Test Event',
    });
    expect(result).toBe('Duplicate event: Test Event');
  });

  it('should interpolate event name into edit label', () => {
    const eventName = 'Community Workshop';
    const result = i18next.t('calendar.event.edit_label', {
      ns: 'calendars',
      name: eventName,
    });
    expect(result).toBe(`Edit event: ${eventName}`);
  });

  it('should interpolate event name into duplicate label', () => {
    const eventName = 'Community Workshop';
    const result = i18next.t('calendar.event.duplicate_label', {
      ns: 'calendars',
      name: eventName,
    });
    expect(result).toBe(`Duplicate event: ${eventName}`);
  });

  it('should not return the raw key for edit_label (key must exist in namespace)', () => {
    const result = i18next.t('calendar.event.edit_label', {
      ns: 'calendars',
      name: 'Test',
    });
    expect(result).not.toBe('calendar.event.edit_label');
  });

  it('should not return the raw key for duplicate_label (key must exist in namespace)', () => {
    const result = i18next.t('calendar.event.duplicate_label', {
      ns: 'calendars',
      name: 'Test',
    });
    expect(result).not.toBe('calendar.event.duplicate_label');
  });
});
