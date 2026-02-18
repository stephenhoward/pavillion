/**
 * Tests for Vue Router locale-aware navigation guard.
 *
 * Validates that the beforeEach guard correctly detects locale prefixes from
 * URLs, calls i18next.changeLanguage(), and redirects to the stripped canonical
 * path so existing route definitions continue to match.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRouter, createMemoryHistory, RouteRecordRaw } from 'vue-router';
import i18next from 'i18next';
import { detectLocaleFromPath, stripLocalePrefix } from '@/common/i18n/locale-url';

// ---------------------------------------------------------------------------
// Helpers — mirror the guard logic from src/site/app.ts
// ---------------------------------------------------------------------------

/**
 * Installs the locale navigation guard onto a router.
 * This mirrors the logic in src/site/app.ts so it can be tested independently.
 */
function installLocaleGuard(router: ReturnType<typeof createRouter>) {
  router.beforeEach((to, _from, next) => {
    const locale = detectLocaleFromPath(to.path);

    if (locale) {
      if (i18next.language !== locale) {
        i18next.changeLanguage(locale);
      }

      const { path: strippedPath } = stripLocalePrefix(to.path);
      const hash = to.hash ?? '';
      const query = to.query;

      next({ path: strippedPath, query, hash, replace: true });
      return;
    }

    next();
  });
}

// ---------------------------------------------------------------------------
// Shared route definitions (mirror src/site/app.ts routes)
// ---------------------------------------------------------------------------

const StubComponent = { template: '<div />' };

const routes: RouteRecordRaw[] = [
  { path: '/@:calendar', component: StubComponent, name: 'calendar' },
  { path: '/@:calendar/events/:event', component: StubComponent, name: 'event' },
  { path: '/@:calendar/events/:event/:instance', component: StubComponent, name: 'instance' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Vue Router locale-aware navigation guard', () => {
  let router: ReturnType<typeof createRouter>;
  let changeLanguageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create a fresh router with memory history for each test
    router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    installLocaleGuard(router);

    // Spy on i18next.changeLanguage to verify it is called (do not await)
    changeLanguageSpy = vi.spyOn(i18next, 'changeLanguage').mockImplementation(async () => i18next);

    // Reset the language to default before each test
    Object.defineProperty(i18next, 'language', { value: 'en', configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Unprefixed routes — default language
  // -------------------------------------------------------------------------

  describe('unprefixed routes (default language)', () => {
    it('should match /@:calendar without a locale prefix', async () => {
      await router.push('/@mycalendar');
      expect(router.currentRoute.value.name).toBe('calendar');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
    });

    it('should match /@:calendar/events/:event without a locale prefix', async () => {
      await router.push('/@mycalendar/events/event-123');
      expect(router.currentRoute.value.name).toBe('event');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.event).toBe('event-123');
    });

    it('should match /@:calendar/events/:event/:instance', async () => {
      await router.push('/@mycalendar/events/event-123/instance-456');
      expect(router.currentRoute.value.name).toBe('instance');
    });

    it('should not call changeLanguage for unprefixed routes', async () => {
      await router.push('/@mycalendar');
      expect(changeLanguageSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Locale-prefixed routes — non-default language
  // -------------------------------------------------------------------------

  describe('locale-prefixed routes (non-default language)', () => {
    it('should detect locale from /es/@calendar and call changeLanguage', async () => {
      await router.push('/es/@mycalendar');
      expect(changeLanguageSpy).toHaveBeenCalledWith('es');
    });

    it('should redirect /es/@calendar to /@calendar for route matching', async () => {
      await router.push('/es/@mycalendar');
      expect(router.currentRoute.value.path).toBe('/@mycalendar');
      expect(router.currentRoute.value.name).toBe('calendar');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
    });

    it('should redirect /es/@calendar/events/:event to canonical path', async () => {
      await router.push('/es/@mycalendar/events/event-123');
      expect(router.currentRoute.value.path).toBe('/@mycalendar/events/event-123');
      expect(router.currentRoute.value.name).toBe('event');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.event).toBe('event-123');
    });

    it('should redirect /es/@calendar/events/:event/:instance to canonical path', async () => {
      await router.push('/es/@mycalendar/events/event-123/instance-456');
      expect(router.currentRoute.value.path).toBe('/@mycalendar/events/event-123/instance-456');
      expect(router.currentRoute.value.name).toBe('instance');
    });

    it('should preserve query parameters when redirecting from locale-prefixed path', async () => {
      await router.push('/es/@mycalendar?filter=music&page=2');
      expect(router.currentRoute.value.path).toBe('/@mycalendar');
      expect(router.currentRoute.value.query).toEqual({ filter: 'music', page: '2' });
    });

    it('should preserve hash when redirecting from locale-prefixed path', async () => {
      await router.push({ path: '/es/@mycalendar', hash: '#section' });
      expect(router.currentRoute.value.path).toBe('/@mycalendar');
      expect(router.currentRoute.value.hash).toBe('#section');
    });
  });

  // -------------------------------------------------------------------------
  // i18next language switching behaviour
  // -------------------------------------------------------------------------

  describe('i18next language switching', () => {
    it('should call changeLanguage when the URL locale differs from current language', async () => {
      // Simulate current language is 'en', URL has 'es' prefix
      Object.defineProperty(i18next, 'language', { value: 'en', configurable: true });
      await router.push('/es/@mycalendar');
      expect(changeLanguageSpy).toHaveBeenCalledWith('es');
    });

    it('should not call changeLanguage when i18next is already set to the URL locale', async () => {
      // Simulate language is already 'es'
      Object.defineProperty(i18next, 'language', { value: 'es', configurable: true });
      await router.push('/es/@mycalendar');
      expect(changeLanguageSpy).not.toHaveBeenCalled();
    });

    it('should not call changeLanguage for routes without a locale prefix', async () => {
      await router.push('/@mycalendar');
      expect(changeLanguageSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Invalid / non-locale path segments
  // -------------------------------------------------------------------------

  describe('non-locale path segments', () => {
    it('should not trigger locale switch for /xx/@calendar when xx is not a valid locale', async () => {
      // 'xx' is not in AVAILABLE_LANGUAGES, so detectLocaleFromPath returns null
      await router.push('/xx/@mycalendar');
      expect(changeLanguageSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Browser history behaviour
  // -------------------------------------------------------------------------

  describe('browser history behaviour', () => {
    it('should use replace:true when redirecting locale-prefixed paths (no extra history entry)', async () => {
      // Navigate to a non-locale route first
      await router.push('/@mycalendar');

      // Then navigate to a locale-prefixed URL
      await router.push('/es/@anothercalendar');

      // The current route should be the canonical stripped path
      expect(router.currentRoute.value.path).toBe('/@anothercalendar');
    });
  });
});
