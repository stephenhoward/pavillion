/**
 * Tests for the useLocalizedContent composable.
 *
 * Validates that:
 * - Content is returned in the current locale when available
 * - Falls back to the default language (English) when the current locale has no content
 * - Falls back to the first available language when neither current nor default has content
 * - Returns empty content for the current locale when no content exists at all
 * - localizedField resolves a single field per language, not per content row
 * - resolveImageAlt picks the alt belonging to the image actually rendered
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import i18next from 'i18next';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { Media } from '@/common/model/media';

// ---------------------------------------------------------------------------
// Mocks -- must be declared before the composable is imported
// ---------------------------------------------------------------------------

const mockRoute = {
  path: '/mycalendar',
  query: {},
  hash: '',
};

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => mockRoute,
}));

vi.mock('i18next', () => ({
  default: {
    changeLanguage: vi.fn(),
    language: 'en',
  },
}));

vi.mock('@/common/i18n/cookie', () => ({
  writeLocaleCookie: vi.fn(),
  readLocaleCookie: vi.fn(() => null),
  LOCALE_COOKIE_NAME: 'pavilion_locale',
}));

// ---------------------------------------------------------------------------
// Subject under test -- imported after mocks are in place
// ---------------------------------------------------------------------------
import { useLocalizedContent } from '@/site/composables/useLocalizedContent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setI18nextLanguage(lang: string) {
  Object.defineProperty(i18next, 'language', { value: lang, configurable: true });
}

function makeCalendar(contents: { lang: string; name: string; imageAlt?: string }[]): Calendar {
  const cal = new Calendar('cal-1', 'mycalendar');
  for (const { lang, name, imageAlt } of contents) {
    const content = new CalendarContent(lang, name, `Description in ${lang}`, imageAlt);
    cal.addContent(content);
  }
  return cal;
}

function makeEvent(
  contents: { lang: string; name: string; imageAlt?: string }[],
  media: Media | null = null,
): CalendarEvent {
  const event = new CalendarEvent('event-1');
  for (const { lang, name, imageAlt } of contents) {
    event.addContent(
      new CalendarEventContent(lang, name, `Description in ${lang}`, '', imageAlt),
    );
  }
  event.media = media;
  return event;
}

function makeMedia(): Media {
  return new Media('media-1', 'cal-1', 'sha', 'DSC_0042.jpg', 'image/jpeg', 1024, 'approved');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLocalizedContent', () => {
  beforeEach(() => {
    mockRoute.path = '/mycalendar';
    setI18nextLanguage('en');
  });

  describe('when current locale content exists', () => {
    it('should return content in the current locale', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
        { lang: 'es', name: 'Nombre en Espanol' },
      ]);

      // Simulate Spanish locale via route prefix
      mockRoute.path = '/es/mycalendar';
      setI18nextLanguage('es');

      const { localizedContent } = useLocalizedContent();
      const result = localizedContent(cal);

      expect(result.name).toBe('Nombre en Espanol');
      expect(result.language).toBe('es');
    });

    it('should return English content when locale is English', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
        { lang: 'es', name: 'Nombre en Espanol' },
      ]);

      setI18nextLanguage('en');

      const { localizedContent } = useLocalizedContent();
      const result = localizedContent(cal);

      expect(result.name).toBe('English Name');
      expect(result.language).toBe('en');
    });
  });

  describe('when current locale content does not exist', () => {
    it('should fall back to English', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
      ]);

      // Request French locale, but only English exists
      mockRoute.path = '/fr/mycalendar';
      setI18nextLanguage('fr');

      const { localizedContent } = useLocalizedContent();
      const result = localizedContent(cal);

      expect(result.name).toBe('English Name');
      expect(result.language).toBe('en');
    });

    it('should fall back to first available language when English is not present', () => {
      const cal = makeCalendar([
        { lang: 'de', name: 'Deutscher Name' },
      ]);

      // Request French locale, no English, only German exists
      mockRoute.path = '/fr/mycalendar';
      setI18nextLanguage('fr');

      const { localizedContent } = useLocalizedContent();
      const result = localizedContent(cal);

      expect(result.name).toBe('Deutscher Name');
      expect(result.language).toBe('de');
    });
  });

  describe('when no content exists', () => {
    it('should return empty content for the current locale', () => {
      const cal = new Calendar('cal-1', 'mycalendar');
      // No content added

      setI18nextLanguage('en');

      const { localizedContent } = useLocalizedContent();
      const result = localizedContent(cal);

      // Should return an empty CalendarContent for 'en'
      expect(result.name).toBe('');
      expect(result.language).toBe('en');
    });
  });

  describe('localizedField', () => {
    it('should return the current locale value when it is populated', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'A packed room' },
        { lang: 'fr', name: 'Nom francais', imageAlt: 'Une salle comble' },
      ]);

      mockRoute.path = '/fr/mycalendar';
      setI18nextLanguage('fr');

      const { localizedField } = useLocalizedContent();

      expect(localizedField(cal, 'imageAlt')).toBe('Une salle comble');
    });

    it('should fall back to English per field when the locale row exists but the field is empty', () => {
      // The French row exists and has a name, but no alt text. Row-level
      // resolution would make the image decorative for French visitors only.
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'A packed room' },
        { lang: 'fr', name: 'Nom francais' },
      ]);

      mockRoute.path = '/fr/mycalendar';
      setI18nextLanguage('fr');

      const { localizedContent, localizedField } = useLocalizedContent();

      // Row selection still picks French -- only the field resolution differs.
      expect(localizedContent(cal).language).toBe('fr');
      expect(localizedField(cal, 'imageAlt')).toBe('A packed room');
    });

    it('should fall back to the first language with a value when English is empty', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
        { lang: 'de', name: 'Deutscher Name', imageAlt: 'Ein voller Raum' },
      ]);

      mockRoute.path = '/fr/mycalendar';
      setI18nextLanguage('fr');

      const { localizedField } = useLocalizedContent();

      expect(localizedField(cal, 'imageAlt')).toBe('Ein voller Raum');
    });

    it('should return an empty string when no language has a value', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
        { lang: 'fr', name: 'Nom francais' },
      ]);

      const { localizedField } = useLocalizedContent();

      expect(localizedField(cal, 'imageAlt')).toBe('');
    });

    it('should treat a whitespace-only value as empty and fall through', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'A packed room' },
        { lang: 'fr', name: 'Nom francais', imageAlt: '   ' },
      ]);

      mockRoute.path = '/fr/mycalendar';
      setI18nextLanguage('fr');

      const { localizedField } = useLocalizedContent();

      expect(localizedField(cal, 'imageAlt')).toBe('A packed room');
    });

    it('should return the selected value exactly as stored', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: '  A packed room  ' },
      ]);

      const { localizedField } = useLocalizedContent();

      expect(localizedField(cal, 'imageAlt')).toBe('  A packed room  ');
    });

    it('should return an empty string for a null or undefined model', () => {
      const { localizedField } = useLocalizedContent();

      expect(localizedField(null, 'imageAlt')).toBe('');
      expect(localizedField(undefined, 'imageAlt')).toBe('');
    });

    it('should not materialize a content row for a language the model lacks', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'A packed room' },
      ]);

      mockRoute.path = '/fr/mycalendar';
      setI18nextLanguage('fr');

      const { localizedField } = useLocalizedContent();
      localizedField(cal, 'imageAlt');

      expect(cal.getLanguages()).toEqual(['en']);
    });
  });

  describe('resolveImageAlt', () => {
    it("should use the event's own alt when the event has its own media", () => {
      const event = makeEvent(
        [{ lang: 'en', name: 'Concert', imageAlt: 'The band on stage' }],
        makeMedia(),
      );
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'Calendar default alt' },
      ]);

      const { resolveImageAlt } = useLocalizedContent();

      expect(resolveImageAlt(event, cal, false)).toBe('The band on stage');
    });

    it("should prefer the event's alt even when the caller allows the calendar default", () => {
      const event = makeEvent(
        [{ lang: 'en', name: 'Concert', imageAlt: 'The band on stage' }],
        makeMedia(),
      );
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'Calendar default alt' },
      ]);

      const { resolveImageAlt } = useLocalizedContent();

      expect(resolveImageAlt(event, cal, true)).toBe('The band on stage');
    });

    it("should use the calendar's alt when the calendar default image is shown", () => {
      const event = makeEvent([{ lang: 'en', name: 'Concert' }]);
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'Calendar default alt' },
      ]);

      const { resolveImageAlt } = useLocalizedContent();

      expect(resolveImageAlt(event, cal, true)).toBe('Calendar default alt');
    });

    it('should resolve the calendar alt per locale', () => {
      const event = makeEvent([{ lang: 'en', name: 'Concert' }]);
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'Calendar default alt' },
        { lang: 'es', name: 'Nombre', imageAlt: 'Texto alternativo' },
      ]);

      mockRoute.path = '/es/mycalendar';
      setI18nextLanguage('es');

      const { resolveImageAlt } = useLocalizedContent();

      expect(resolveImageAlt(event, cal, true)).toBe('Texto alternativo');
    });

    it('should return an empty string when no image is shown', () => {
      const event = makeEvent([{ lang: 'en', name: 'Concert', imageAlt: 'Unused alt' }]);
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'Calendar default alt' },
      ]);

      const { resolveImageAlt } = useLocalizedContent();

      expect(resolveImageAlt(event, cal, false)).toBe('');
    });

    it("should return an empty string when the caller withholds the calendar default (repost)", () => {
      // A reposted event without its own media never shows the local
      // calendar's default image, so it must not borrow that image's alt.
      const event = makeEvent([{ lang: 'en', name: 'Reposted concert' }]);
      event.repostStatus = 'auto';
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'Calendar default alt' },
      ]);

      const { resolveImageAlt } = useLocalizedContent();

      expect(resolveImageAlt(event, cal, false)).toBe('');
    });

    it('should return an empty string when the calendar is unavailable', () => {
      const event = makeEvent([{ lang: 'en', name: 'Concert' }]);

      const { resolveImageAlt } = useLocalizedContent();

      expect(resolveImageAlt(event, null, true)).toBe('');
    });

    it('should return an empty string when the event has media but no alt in any language', () => {
      const event = makeEvent([{ lang: 'en', name: 'Concert' }], makeMedia());
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name', imageAlt: 'Calendar default alt' },
      ]);

      const { resolveImageAlt } = useLocalizedContent();

      expect(resolveImageAlt(event, cal, true)).toBe('');
    });
  });

  describe('locale detection from route path', () => {
    it('should detect locale from URL prefix', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
        { lang: 'es', name: 'Nombre en Espanol' },
      ]);

      mockRoute.path = '/es/mycalendar';
      setI18nextLanguage('es');

      const { localizedContent } = useLocalizedContent();
      const result = localizedContent(cal);

      expect(result.name).toBe('Nombre en Espanol');
    });

    it('should use default locale when no prefix in URL', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
        { lang: 'es', name: 'Nombre en Espanol' },
      ]);

      mockRoute.path = '/mycalendar';
      setI18nextLanguage('en');

      const { localizedContent } = useLocalizedContent();
      const result = localizedContent(cal);

      expect(result.name).toBe('English Name');
    });
  });
});
