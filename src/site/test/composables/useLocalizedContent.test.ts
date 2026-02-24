/**
 * Tests for the useLocalizedContent composable.
 *
 * Validates that:
 * - Content is returned in the current locale when available
 * - Falls back to the default language (English) when the current locale has no content
 * - Falls back to the first available language when neither current nor default has content
 * - Returns empty content for the current locale when no content exists at all
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import i18next from 'i18next';
import { Calendar, CalendarContent } from '@/common/model/calendar';

// ---------------------------------------------------------------------------
// Mocks -- must be declared before the composable is imported
// ---------------------------------------------------------------------------

const mockRoute = {
  path: '/view/mycalendar',
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

function makeCalendar(contents: { lang: string; name: string }[]): Calendar {
  const cal = new Calendar('cal-1', 'mycalendar');
  for (const { lang, name } of contents) {
    const content = new CalendarContent(lang, name, `Description in ${lang}`);
    cal.addContent(content);
  }
  return cal;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLocalizedContent', () => {
  beforeEach(() => {
    mockRoute.path = '/view/mycalendar';
    setI18nextLanguage('en');
  });

  describe('when current locale content exists', () => {
    it('should return content in the current locale', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
        { lang: 'es', name: 'Nombre en Espanol' },
      ]);

      // Simulate Spanish locale via route prefix
      mockRoute.path = '/es/view/mycalendar';
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
      mockRoute.path = '/fr/view/mycalendar';
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
      mockRoute.path = '/fr/view/mycalendar';
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

  describe('locale detection from route path', () => {
    it('should detect locale from URL prefix', () => {
      const cal = makeCalendar([
        { lang: 'en', name: 'English Name' },
        { lang: 'es', name: 'Nombre en Espanol' },
      ]);

      mockRoute.path = '/es/view/mycalendar';
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

      mockRoute.path = '/view/mycalendar';
      setI18nextLanguage('en');

      const { localizedContent } = useLocalizedContent();
      const result = localizedContent(cal);

      expect(result.name).toBe('English Name');
    });
  });
});
