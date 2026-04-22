/**
 * Tests for Vue Router locale-aware navigation guard.
 *
 * Validates that the beforeEach guard correctly detects locale prefixes from
 * route params, calls i18next.changeLanguage(), and keeps the locale prefix
 * in the URL (no redirect) so locale-prefixed URLs are natively supported.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRouter, createMemoryHistory, RouteRecordRaw } from 'vue-router';
import i18next from 'i18next';
import sinon from 'sinon';

// ---------------------------------------------------------------------------
// Helpers — mirror the guard logic from src/site/app.ts
// ---------------------------------------------------------------------------

/**
 * Installs the locale navigation guard onto a router.
 * This mirrors the logic in src/site/app.ts so it can be tested independently.
 */
function installLocaleGuard(router: ReturnType<typeof createRouter>) {
  router.beforeEach((to) => {
    const locale = to.params.locale as string | undefined;
    if (locale) {
      if (i18next.language !== locale) {
        i18next.changeLanguage(locale);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Shared route definitions (mirror src/site/app.ts routes)
// ---------------------------------------------------------------------------

const StubComponent = { template: '<div />' };

const routes: RouteRecordRaw[] = [
  { path: '/view/:calendar', component: StubComponent, name: 'calendar' },
  { path: '/view/:calendar/events/:event', component: StubComponent, name: 'event' },
  { path: '/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: StubComponent, name: 'instance' },
  // Locale-prefixed variants — unnamed intentionally (mirrors app.ts).
  // Use dynamic :locale param so the guard can read to.params.locale.
  { path: '/:locale(es)/view/:calendar', component: StubComponent },
  { path: '/:locale(es)/view/:calendar/events/:event', component: StubComponent },
  { path: '/:locale(es)/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: StubComponent },
  // Catch-all for 404 fall-through tests.
  { path: '/:pathMatch(.*)*', component: StubComponent, name: 'not-found' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Vue Router locale-aware navigation guard', () => {
  let router: ReturnType<typeof createRouter>;
  let sandbox: sinon.SinonSandbox;
  let changeLanguageSpy: sinon.SinonSpy;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create a fresh router with memory history for each test
    router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    installLocaleGuard(router);

    // Spy on i18next.changeLanguage to verify it is called (do not await)
    changeLanguageSpy = sandbox.stub(i18next, 'changeLanguage').resolves(i18next);

    // Reset the language to default before each test
    Object.defineProperty(i18next, 'language', { value: 'en', configurable: true });
  });

  afterEach(() => {
    sandbox.restore();
  });

  // -------------------------------------------------------------------------
  // Unprefixed routes — default language
  // -------------------------------------------------------------------------

  describe('unprefixed routes (default language)', () => {
    it('should match /view/:calendar without a locale prefix', async () => {
      await router.push('/view/mycalendar');
      expect(router.currentRoute.value.name).toBe('calendar');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
    });

    it('should match /view/:calendar/events/:event without a locale prefix', async () => {
      await router.push('/view/mycalendar/events/event-123');
      expect(router.currentRoute.value.name).toBe('event');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.event).toBe('event-123');
    });

    it('should match /view/:calendar/events/:event/:startTime with a valid slug', async () => {
      await router.push('/view/mycalendar/events/event-123/20260508-1800');
      expect(router.currentRoute.value.name).toBe('instance');
      expect(router.currentRoute.value.params.startTime).toBe('20260508-1800');
    });

    it('should fall through to 404 for a non-slug :startTime segment', async () => {
      await router.push('/view/mycalendar/events/event-123/not-a-slug');
      expect(router.currentRoute.value.name).toBe('not-found');
    });

    it('should fall through to 404 for a UUID-shaped :startTime segment', async () => {
      await router.push('/view/mycalendar/events/event-123/550e8400-e29b-41d4-a716-446655440000');
      expect(router.currentRoute.value.name).toBe('not-found');
    });

    it('should not call changeLanguage for unprefixed routes', async () => {
      await router.push('/view/mycalendar');
      expect(changeLanguageSpy.called).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Locale-prefixed routes — non-default language
  // -------------------------------------------------------------------------

  describe('locale-prefixed routes (non-default language)', () => {
    it('should detect locale from /es/view/calendar and call changeLanguage', async () => {
      await router.push('/es/view/mycalendar');
      expect(changeLanguageSpy.calledWith('es')).toBe(true);
    });

    it('should match /es/view/calendar natively and keep locale prefix in URL', async () => {
      await router.push('/es/view/mycalendar');
      expect(router.currentRoute.value.path).toBe('/es/view/mycalendar');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.locale).toBe('es');
    });

    it('should match /es/view/calendar/events/:event natively', async () => {
      await router.push('/es/view/mycalendar/events/event-123');
      expect(router.currentRoute.value.path).toBe('/es/view/mycalendar/events/event-123');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.event).toBe('event-123');
    });

    it('should match /es/view/calendar/events/:event/:startTime with a valid slug', async () => {
      await router.push('/es/view/mycalendar/events/event-123/20260508-1800');
      expect(router.currentRoute.value.path).toBe('/es/view/mycalendar/events/event-123/20260508-1800');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.startTime).toBe('20260508-1800');
    });

    it('should fall through to 404 for a non-slug :startTime on a locale-prefixed route', async () => {
      await router.push('/es/view/mycalendar/events/event-123/not-a-slug');
      expect(router.currentRoute.value.name).toBe('not-found');
    });

    it('should preserve query parameters on locale-prefixed routes', async () => {
      await router.push('/es/view/mycalendar?filter=music&page=2');
      expect(router.currentRoute.value.path).toBe('/es/view/mycalendar');
      expect(router.currentRoute.value.query).toEqual({ filter: 'music', page: '2' });
    });

    it('should preserve hash on locale-prefixed routes', async () => {
      await router.push({ path: '/es/view/mycalendar', hash: '#section' });
      expect(router.currentRoute.value.path).toBe('/es/view/mycalendar');
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
      await router.push('/es/view/mycalendar');
      expect(changeLanguageSpy.calledWith('es')).toBe(true);
    });

    it('should not call changeLanguage when i18next is already set to the URL locale', async () => {
      // Simulate language is already 'es'
      Object.defineProperty(i18next, 'language', { value: 'es', configurable: true });
      await router.push('/es/view/mycalendar');
      expect(changeLanguageSpy.called).toBe(false);
    });

    it('should not call changeLanguage for routes without a locale prefix', async () => {
      await router.push('/view/mycalendar');
      expect(changeLanguageSpy.called).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid / non-locale path segments
  // -------------------------------------------------------------------------

  describe('non-locale path segments', () => {
    it('should not trigger locale switch for /xx/view/calendar when xx is not a valid locale', async () => {
      // '/xx/view/mycalendar' does not match any locale-prefixed route (no route defined for /xx prefix),
      // so the guard never fires with a locale param
      await router.push('/xx/view/mycalendar');
      expect(changeLanguageSpy.called).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Browser history behaviour
  // -------------------------------------------------------------------------

  describe('browser history behaviour', () => {
    it('should keep locale prefix in URL with no extra history redirect', async () => {
      // Navigate to a non-locale route first
      await router.push('/view/mycalendar');

      // Then navigate to a locale-prefixed URL — no redirect occurs
      await router.push('/es/view/anothercalendar');

      // The current route should stay at the locale-prefixed path
      expect(router.currentRoute.value.path).toBe('/es/view/anothercalendar');
    });
  });
});
