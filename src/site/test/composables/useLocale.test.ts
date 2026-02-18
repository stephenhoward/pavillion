/**
 * Tests for the useLocale composable.
 *
 * Validates that:
 * - currentLocale is initialised correctly from the route path / i18next language
 * - localizedPath() generates correct locale-prefixed paths
 * - switchLocale() navigates via the router, writes the cookie, and updates the ref
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the composable is imported
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRoute = {
  path: '/@mycalendar',
  query: {},
  hash: '',
};

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => mockRoute,
}));

const mockWriteLocaleCookie = vi.fn();
vi.mock('@/common/i18n/cookie', () => ({
  writeLocaleCookie: (...args: unknown[]) => mockWriteLocaleCookie(...args),
  readLocaleCookie: vi.fn(() => null),
  LOCALE_COOKIE_NAME: 'pavilion_locale',
}));

// ---------------------------------------------------------------------------
// Subject under test — imported after mocks are in place
// ---------------------------------------------------------------------------
import { useLocale } from '@/site/composables/useLocale';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setI18nextLanguage(lang: string) {
  Object.defineProperty(i18next, 'language', { value: lang, configurable: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLocale', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockWriteLocaleCookie.mockClear();

    // Reset route to a canonical path (no locale prefix)
    mockRoute.path = '/@mycalendar';
    mockRoute.query = {};
    mockRoute.hash = '';

    // Default i18next language
    setI18nextLanguage('en');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // currentLocale initialisation
  // -------------------------------------------------------------------------

  describe('currentLocale initialisation', () => {
    it('should return the default language when route has no locale prefix', () => {
      mockRoute.path = '/@mycalendar';
      setI18nextLanguage('en');

      const { currentLocale } = useLocale();

      expect(currentLocale.value).toBe('en');
    });

    it('should return the i18next language when the route has no locale prefix', () => {
      mockRoute.path = '/@mycalendar';
      setI18nextLanguage('es');

      const { currentLocale } = useLocale();

      // No locale in the path → falls back to i18next.language
      expect(currentLocale.value).toBe('es');
    });

    it('should be reactive (writable ref)', () => {
      const { currentLocale } = useLocale();

      currentLocale.value = 'es';

      expect(currentLocale.value).toBe('es');
    });
  });

  // -------------------------------------------------------------------------
  // localizedPath()
  // -------------------------------------------------------------------------

  describe('localizedPath', () => {
    it('should return the path unchanged for the default locale', () => {
      setI18nextLanguage('en');
      const { localizedPath } = useLocale();

      expect(localizedPath('/@mycalendar', 'en')).toBe('/@mycalendar');
    });

    it('should prefix the path with the locale for non-default locales', () => {
      const { localizedPath } = useLocale();

      expect(localizedPath('/@mycalendar', 'es')).toBe('/es/@mycalendar');
    });

    it('should use currentLocale when no explicit locale is supplied', () => {
      setI18nextLanguage('en');
      const { currentLocale, localizedPath } = useLocale();

      currentLocale.value = 'es';

      expect(localizedPath('/@mycalendar')).toBe('/es/@mycalendar');
    });

    it('should not double-prefix an already-prefixed path', () => {
      const { localizedPath } = useLocale();

      expect(localizedPath('/es/@mycalendar', 'es')).toBe('/es/@mycalendar');
    });

    it('should handle the root path correctly', () => {
      const { localizedPath } = useLocale();

      expect(localizedPath('/', 'es')).toBe('/es');
    });

    it('should handle event paths', () => {
      const { localizedPath } = useLocale();

      expect(localizedPath('/@mycalendar/events/event-123', 'es')).toBe(
        '/es/@mycalendar/events/event-123',
      );
    });
  });

  // -------------------------------------------------------------------------
  // switchLocale()
  // -------------------------------------------------------------------------

  describe('switchLocale', () => {
    it('should update currentLocale to the new locale', () => {
      mockRoute.path = '/@mycalendar';
      const { currentLocale, switchLocale } = useLocale();

      switchLocale('es');

      expect(currentLocale.value).toBe('es');
    });

    it('should call router.push with the locale-prefixed path', () => {
      mockRoute.path = '/@mycalendar';
      const { switchLocale } = useLocale();

      switchLocale('es');

      expect(mockPush).toHaveBeenCalledOnce();
      const pushArg = mockPush.mock.calls[0][0];
      expect(pushArg.path).toBe('/es/@mycalendar');
    });

    it('should preserve query parameters when switching locale', () => {
      mockRoute.path = '/@mycalendar';
      mockRoute.query = { filter: 'music', page: '2' };
      const { switchLocale } = useLocale();

      switchLocale('es');

      const pushArg = mockPush.mock.calls[0][0];
      expect(pushArg.query).toEqual({ filter: 'music', page: '2' });
    });

    it('should preserve the hash when switching locale', () => {
      mockRoute.path = '/@mycalendar';
      mockRoute.hash = '#section';
      const { switchLocale } = useLocale();

      switchLocale('es');

      const pushArg = mockPush.mock.calls[0][0];
      expect(pushArg.hash).toBe('#section');
    });

    it('should write the cookie with the new locale', () => {
      mockRoute.path = '/@mycalendar';
      const { switchLocale } = useLocale();

      switchLocale('es');

      expect(mockWriteLocaleCookie).toHaveBeenCalledOnce();
      expect(mockWriteLocaleCookie).toHaveBeenCalledWith('es');
    });

    it('should navigate to unprefixed path when switching to the default locale', () => {
      mockRoute.path = '/@mycalendar';
      const { switchLocale } = useLocale();

      switchLocale('en');

      const pushArg = mockPush.mock.calls[0][0];
      // Default locale → no prefix
      expect(pushArg.path).toBe('/@mycalendar');
    });

    it('should strip an existing locale prefix when switching locale', () => {
      // Simulate being on the Spanish version of the page; the router guard
      // would normally have redirected to the canonical path, but in tests
      // the path may still carry the prefix.
      mockRoute.path = '/es/@mycalendar';
      const { switchLocale } = useLocale();

      switchLocale('en');

      const pushArg = mockPush.mock.calls[0][0];
      // Should strip the /es prefix before adding the new one (en has no prefix)
      expect(pushArg.path).toBe('/@mycalendar');
    });

    it('should not trigger a full page reload (router.push, not location.href)', () => {
      mockRoute.path = '/@mycalendar';
      const { switchLocale } = useLocale();

      const hrefSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
        href: '',
      } as Location);

      switchLocale('es');

      // router.push called, not a hard navigation
      expect(mockPush).toHaveBeenCalledOnce();
      // window.location.href should not have been set
      expect(hrefSpy).not.toHaveBeenCalled();
    });
  });
});
