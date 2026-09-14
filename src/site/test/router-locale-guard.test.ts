/**
 * Tests for Vue Router locale-aware navigation guard.
 *
 * Validates that the beforeEach guard correctly detects locale prefixes from
 * route params, calls i18next.changeLanguage(), and keeps the locale prefix
 * in the URL (no redirect) so locale-prefixed URLs are natively supported.
 *
 * Also covers the root-URL route shape: calendars live at '/:calendar' and the
 * discovery page at the static '/discover', so the table is exercised for the
 * static-beats-param precedence that keeps '/discover' out of the calendar route.
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
  { path: '/discover', component: StubComponent, name: 'discovery' },
  { path: '/:calendar', component: StubComponent, name: 'calendar' },
  { path: '/:calendar/events/:event', component: StubComponent, name: 'event' },
  { path: '/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: StubComponent, name: 'instance' },
  { path: '/:calendar/series/:series', component: StubComponent, name: 'series' },
  // Locale-prefixed variants — unnamed intentionally (mirrors app.ts).
  // Use dynamic :locale param so the guard can read to.params.locale.
  { path: '/:locale(es|fr)/discover', component: StubComponent },
  { path: '/:locale(es|fr)/:calendar', component: StubComponent },
  { path: '/:locale(es|fr)/:calendar/events/:event', component: StubComponent },
  { path: '/:locale(es|fr)/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: StubComponent },
  { path: '/:locale(es|fr)/:calendar/series/:series', component: StubComponent },
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

  /** The path template of the route record that matched, for unnamed routes. */
  const matchedPath = () => router.currentRoute.value.matched.at(-1)?.path;

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
    it('should match /:calendar without a locale prefix', async () => {
      await router.push('/mycalendar');
      expect(router.currentRoute.value.name).toBe('calendar');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
    });

    it('should match /:calendar/events/:event without a locale prefix', async () => {
      await router.push('/mycalendar/events/event-123');
      expect(router.currentRoute.value.name).toBe('event');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.event).toBe('event-123');
    });

    it('should match /:calendar/events/:event/:startTime with a valid slug', async () => {
      await router.push('/mycalendar/events/event-123/20260508-1800');
      expect(router.currentRoute.value.name).toBe('instance');
      expect(router.currentRoute.value.params.startTime).toBe('20260508-1800');
    });

    it('should match /:calendar/series/:series without a locale prefix', async () => {
      await router.push('/mycalendar/series/series-123');
      expect(router.currentRoute.value.name).toBe('series');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.series).toBe('series-123');
    });

    it('should fall through to 404 for a non-slug :startTime segment', async () => {
      await router.push('/mycalendar/events/event-123/not-a-slug');
      expect(router.currentRoute.value.name).toBe('not-found');
    });

    it('should fall through to 404 for a UUID-shaped :startTime segment', async () => {
      await router.push('/mycalendar/events/event-123/550e8400-e29b-41d4-a716-446655440000');
      expect(router.currentRoute.value.name).toBe('not-found');
    });

    it('should not match the site root as a calendar', async () => {
      await router.push('/');
      expect(router.currentRoute.value.name).toBe('not-found');
    });

    it('should not call changeLanguage for unprefixed routes', async () => {
      await router.push('/mycalendar');
      expect(changeLanguageSpy.called).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Discovery — the static segment must outrank the calendar param
  // -------------------------------------------------------------------------

  describe('discovery route precedence', () => {
    it('should match /discover as the discovery route, not as a calendar', async () => {
      await router.push('/discover');
      expect(router.currentRoute.value.name).toBe('discovery');
      expect(router.currentRoute.value.params.calendar).toBeUndefined();
    });

    it('should match /:locale/discover as the locale-prefixed discovery route', async () => {
      await router.push('/es/discover');
      expect(matchedPath()).toBe('/:locale(es|fr)/discover');
      expect(router.currentRoute.value.params.locale).toBe('es');
      expect(router.currentRoute.value.params.calendar).toBeUndefined();
    });

    it('should switch language on a locale-prefixed discovery URL', async () => {
      await router.push('/fr/discover');
      expect(changeLanguageSpy.calledWith('fr')).toBe(true);
    });

    it('should treat a deeper /discover path as a calendar page', async () => {
      // Only the bare segment is the discovery page; '/discover/events/x' is not
      // reachable as a calendar in practice because 'discover' is a reserved
      // url name, but the route table must still resolve by shape alone.
      await router.push('/discover/events/event-123');
      expect(router.currentRoute.value.name).toBe('event');
      expect(router.currentRoute.value.params.calendar).toBe('discover');
    });
  });

  // -------------------------------------------------------------------------
  // Locale-prefixed routes — non-default language
  // -------------------------------------------------------------------------

  describe('locale-prefixed routes (non-default language)', () => {
    it('should detect locale from /es/:calendar and call changeLanguage', async () => {
      await router.push('/es/mycalendar');
      expect(changeLanguageSpy.calledWith('es')).toBe(true);
    });

    it('should match /es/:calendar natively and keep locale prefix in URL', async () => {
      await router.push('/es/mycalendar');
      expect(router.currentRoute.value.path).toBe('/es/mycalendar');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.locale).toBe('es');
    });

    it('should match /fr/:calendar natively and keep locale prefix in URL', async () => {
      await router.push('/fr/mycalendar');
      expect(router.currentRoute.value.path).toBe('/fr/mycalendar');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.locale).toBe('fr');
    });

    it('should match /es/:calendar/events/:event natively', async () => {
      await router.push('/es/mycalendar/events/event-123');
      expect(router.currentRoute.value.path).toBe('/es/mycalendar/events/event-123');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.event).toBe('event-123');
    });

    it('should match /fr/:calendar/events/:event natively', async () => {
      await router.push('/fr/mycalendar/events/event-123');
      expect(matchedPath()).toBe('/:locale(es|fr)/:calendar/events/:event');
      expect(router.currentRoute.value.params.locale).toBe('fr');
    });

    it('should match /es/:calendar/events/:event/:startTime with a valid slug', async () => {
      await router.push('/es/mycalendar/events/event-123/20260508-1800');
      expect(router.currentRoute.value.path).toBe('/es/mycalendar/events/event-123/20260508-1800');
      expect(router.currentRoute.value.params.calendar).toBe('mycalendar');
      expect(router.currentRoute.value.params.startTime).toBe('20260508-1800');
    });

    it('should match /fr/:calendar/series/:series natively', async () => {
      await router.push('/fr/mycalendar/series/series-123');
      expect(matchedPath()).toBe('/:locale(es|fr)/:calendar/series/:series');
      expect(router.currentRoute.value.params.series).toBe('series-123');
    });

    it('should fall through to 404 for a non-slug :startTime on a locale-prefixed route', async () => {
      await router.push('/es/mycalendar/events/event-123/not-a-slug');
      expect(router.currentRoute.value.name).toBe('not-found');
    });

    it('should preserve query parameters on locale-prefixed routes', async () => {
      await router.push('/es/mycalendar?filter=music&page=2');
      expect(router.currentRoute.value.path).toBe('/es/mycalendar');
      expect(router.currentRoute.value.query).toEqual({ filter: 'music', page: '2' });
    });

    it('should preserve hash on locale-prefixed routes', async () => {
      await router.push({ path: '/es/mycalendar', hash: '#section' });
      expect(router.currentRoute.value.path).toBe('/es/mycalendar');
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
      await router.push('/es/mycalendar');
      expect(changeLanguageSpy.calledWith('es')).toBe(true);
    });

    it('should not call changeLanguage when i18next is already set to the URL locale', async () => {
      // Simulate language is already 'es'
      Object.defineProperty(i18next, 'language', { value: 'es', configurable: true });
      await router.push('/es/mycalendar');
      expect(changeLanguageSpy.called).toBe(false);
    });

    it('should not call changeLanguage for routes without a locale prefix', async () => {
      await router.push('/mycalendar');
      expect(changeLanguageSpy.called).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid / non-locale path segments
  // -------------------------------------------------------------------------

  describe('non-locale path segments', () => {
    it('should not trigger locale switch for /xx/:calendar when xx is not a valid locale', async () => {
      // '/xx/mycalendar' does not match the locale-prefixed route (the :locale
      // param is constrained to the supported codes), so the guard never fires
      // with a locale param.
      await router.push('/xx/mycalendar');
      expect(changeLanguageSpy.called).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Browser history behaviour
  // -------------------------------------------------------------------------

  describe('browser history behaviour', () => {
    it('should keep locale prefix in URL with no extra history redirect', async () => {
      // Navigate to a non-locale route first
      await router.push('/mycalendar');

      // Then navigate to a locale-prefixed URL — no redirect occurs
      await router.push('/es/anothercalendar');

      // The current route should stay at the locale-prefixed path
      expect(router.currentRoute.value.path).toBe('/es/anothercalendar');
    });
  });
});
