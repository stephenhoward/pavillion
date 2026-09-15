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

import { buildSiteRoutes } from '@/site/routes';

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
// Shared route definitions (the shipped table, bound to stubs)
// ---------------------------------------------------------------------------

const StubComponent = { template: '<div />' };

/**
 * The shipped site route table, imported rather than mirrored.
 *
 * A copy of it here could not stay honest: the locale-prefixed shapes derive
 * their alternation from AVAILABLE_LANGUAGES, so a literal `es|fr` would go on
 * passing while quietly ceasing to describe what ships. The factory binds the
 * views, so this file supplies stubs and keeps to the routing question.
 *
 * A test-only route must go in `routes` below, never here.
 */
const siteRoutes: RouteRecordRaw[] = buildSiteRoutes({
  discovery: StubComponent,
  calendar: StubComponent,
  event: StubComponent,
  instance: StubComponent,
  series: StubComponent,
});

/**
 * The path template of the shipped locale-prefixed route ending in `suffix`.
 *
 * The locale-prefixed records are unnamed, so a matched-record assertion has
 * only the template to identify them by — and naming the template literally
 * would reintroduce the `es|fr` hardcoding this fixture just removed.
 *
 * @param suffix - The tail of the route template, after the locale segment
 * @returns The matching route's path template
 */
function localePrefixedTemplate(suffix: string): string {
  const record = siteRoutes.find(route => route.path.includes(':locale') && route.path.endsWith(suffix));

  if (!record) {
    throw new Error(`No locale-prefixed site route ends with '${suffix}'`);
  }
  return record.path;
}

/**
 * The production table plus a test-only catch-all, so the fall-through cases
 * below have a named route to assert on.
 *
 * app.ts ships no catch-all: 'not-found' exists here and nowhere else. A test
 * that asserts `name === 'not-found'` is therefore saying "no site route
 * claims this path", not "the site renders a 404 page" — it does not. See the
 * unmatched-path test for what production actually does.
 */
const routes: RouteRecordRaw[] = [
  ...siteRoutes,
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

    it('should leave the site root unmatched by every shipped route', async () => {
      // Runs against the production table with no test-only catch-all, so this
      // pins what the browser really does: '/:calendar' requires a non-empty
      // segment, so '/' matches nothing and <RouterView /> renders a blank
      // page. That blank page is a known gap, not a designed 404 — asserting
      // an empty `matched` keeps this test honest about it. Fixing it means
      // adding a route to app.ts, which is a product decision tracked
      // separately; when that lands, this test must change with it.
      const productionRouter = createRouter({
        history: createMemoryHistory(),
        routes: siteRoutes,
      });

      await productionRouter.push('/');

      expect(productionRouter.currentRoute.value.matched).toHaveLength(0);
      expect(productionRouter.currentRoute.value.name).toBeUndefined();
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
      // Precedence is a property of the bare segment only: vue-router ranks the
      // static '/discover' above '/:calendar'. Deeper paths like
      // '/discover/events/x' are not a precedence question at all — they match
      // '/:calendar/events/:event' by shape like any other name would, and are
      // unreachable in practice because 'discover' is a reserved url name.
      await router.push('/discover');
      expect(router.currentRoute.value.name).toBe('discovery');
      expect(router.currentRoute.value.params.calendar).toBeUndefined();
    });

    it('should match /:locale/discover as the locale-prefixed discovery route', async () => {
      await router.push('/es/discover');
      expect(matchedPath()).toBe(localePrefixedTemplate('/discover'));
      expect(router.currentRoute.value.params.locale).toBe('es');
      expect(router.currentRoute.value.params.calendar).toBeUndefined();
    });

    it('should switch language on a locale-prefixed discovery URL', async () => {
      await router.push('/fr/discover');
      expect(changeLanguageSpy.calledWith('fr')).toBe(true);
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
      expect(matchedPath()).toBe(localePrefixedTemplate('/:calendar/events/:event'));
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
      expect(matchedPath()).toBe(localePrefixedTemplate('/:calendar/series/:series'));
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
