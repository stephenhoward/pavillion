/**
 * Unit coverage for the alt-text helpers shared by every image panel.
 *
 * "Described" is derived in three places — `anyLanguageHasAlt` here,
 * `localizedField` on the public site, and the AS2 `altMap` loop — and all
 * three must agree on whitespace, because the server trims alt text on write.
 * A helper that counted a whitespace-only value would seed the editor to
 * Describe and come back Decorative on the next mount.
 */
import { describe, it, expect } from 'vitest';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { anyLanguageHasAlt, clearImageAlt } from '@/client/components/common/media/image-alt';

function calendarWithAlts(alts: Record<string, string>): Calendar {
  const calendar = new Calendar('cal-1', 'mycalendar');
  for (const [lang, alt] of Object.entries(alts)) {
    calendar.addContent(new CalendarContent(lang, `Name in ${lang}`, '', alt));
  }
  return calendar;
}

describe('anyLanguageHasAlt', () => {
  it('is false for a model with no languages', () => {
    expect(anyLanguageHasAlt(new Calendar('cal-1', 'mycalendar'))).toBe(false);
  });

  it('is false when every language has empty alt text', () => {
    expect(anyLanguageHasAlt(calendarWithAlts({ en: '', fr: '' }))).toBe(false);
  });

  it('is true when one language carries alt text', () => {
    expect(anyLanguageHasAlt(calendarWithAlts({ en: '', fr: 'Une salle comble' }))).toBe(true);
  });

  it('is false for whitespace-only alt text, as the site and the wire both are', () => {
    // The write path normalizes this to '', so counting it here would put the
    // editor in Describe over text no reader will ever be given.
    expect(anyLanguageHasAlt(calendarWithAlts({ en: '   ' }))).toBe(false);
    expect(anyLanguageHasAlt(calendarWithAlts({ en: '\t\n' }))).toBe(false);
  });
});

describe('clearImageAlt', () => {
  it('clears the alt text in every language, leaving other fields alone', () => {
    const calendar = calendarWithAlts({ en: 'A packed room', fr: 'Une salle comble' });

    clearImageAlt(calendar);

    expect(anyLanguageHasAlt(calendar)).toBe(false);
    expect(calendar.content('en').imageAlt).toBe('');
    expect(calendar.content('fr').imageAlt).toBe('');
    expect(calendar.content('fr').name).toBe('Name in fr');
  });
});
