import { test, expect, Browser, Page } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  Theme,
  opposite,
  expectThemedText,
  expectColorSide,
  expectThemedSurface,
} from './helpers/color-mode';

/**
 * E2E Tests: Public site colour mode
 *
 * The public site never sets `data-theme`, so the self-guarding
 * `public-dark-mode` mixin must leave it following the visitor's OS
 * preference exactly as it did before the widget's forced colour mode moved
 * onto `data-theme` (pv-l3my Phase 1). These scenarios pin that: every
 * surface below is asserted in both OS modes, on the calendar page, an event
 * page, the not-found page and the discovery empty state (the shared
 * EmptyState component, whose colours come from the --pav-* token layer).
 *
 * The `public-*` mixins that read --pav-* tokens (sticky date heading,
 * focus ring, primary button, sidebar card, loading state) each get one
 * representative check, since they paint nothing if the token layer does not
 * reach them.
 *
 * The widget's forced-mode counterpart lives in widget-config-roundtrip.spec.ts.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer();
});

test.afterAll(async () => {
  await env.cleanup();
});

async function openWithColorScheme(
  browser: Browser,
  colorScheme: Theme,
): Promise<{ page: Page; cleanup: () => Promise<void> }> {
  const context = await browser.newContext({ colorScheme });
  const page = await context.newPage();
  return { page, cleanup: () => context.close() };
}

/**
 * Assert that a computed colour of `selector` (or its pseudo-element) is the
 * site's theme-switched accent. The accent is resolved by the browser from
 * `var(--pav-accent)` on a probe inside `#app`, so the check follows the
 * token rather than a hex value; it also rejects an unresolved token, which
 * computes to transparent or to the text colour.
 */
async function expectAccent(
  page: Page,
  selector: string,
  property: 'backgroundColor' | 'outlineColor',
  pseudo?: '::before',
): Promise<void> {
  await expect.poll(
    async () => page.evaluate(({ selector, property, pseudo }) => {
      const app = document.querySelector('#app')!;
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--pav-accent)';
      app.appendChild(probe);
      const accent = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const el = document.querySelector(selector);
      const value = el ? getComputedStyle(el, pseudo ?? null)[property] : null;
      return { matches: value === accent, resolved: accent !== 'rgba(0, 0, 0, 0)' };
    }, { selector, property, pseudo }),
    { message: `${selector}${pseudo ?? ''} ${property} is the accent`, timeout: 15000, intervals: [200, 500, 1000] },
  ).toEqual({ matches: true, resolved: true });
}

for (const osScheme of ['light', 'dark'] as const) {
  test(`public site follows a ${osScheme} OS preference on every page`, async ({ browser }) => {
    const { page, cleanup } = await openWithColorScheme(browser, osScheme);

    await test.step('calendar page', async () => {
      await page.goto(env.baseURL + '/test_calendar');
      await expect(page.locator('.calendar-title')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('li.day-event-item').first()).toBeVisible({ timeout: 15000 });

      // The site leaves the theme to the OS: no forced mode is ever set.
      await expect(page.locator('html[data-theme]')).toHaveCount(0);

      await expectThemedSurface(page, '#app', osScheme);
      await expectThemedText(page, '.calendar-title', osScheme);
      await expectThemedText(page, '.category-filter-section .filter-label', osScheme);
      await expectThemedText(page, 'li.day-event-item h3', osScheme);
      await expectThemedText(page, '#app footer div.logo', osScheme);
      await expectColorSide(page, '#app footer', 'borderTopColor', opposite(osScheme));
      await expectColorSide(page, '#app footer div.pavillion-logo', 'backgroundColor', opposite(osScheme));

      // public-sticky-date-heading: the day marker and the sticky surface.
      await expectAccent(page, '.day-heading', 'backgroundColor', '::before');
      await expectThemedSurface(page, '.day-heading', osScheme);

      // public-focus-visible: the keyboard focus ring. No pointer input has
      // happened, so programmatic focus matches :focus-visible.
      await page.locator('li.day-event-item h3 a').first().focus();
      await expectAccent(page, 'li.day-event-item h3 a:focus-visible', 'outlineColor');
    });

    await test.step('event page', async () => {
      await page.locator('li.day-event-item h3 a').first().click();
      await expect(page.locator('.instance-title')).toBeVisible({ timeout: 15000 });

      await expectThemedSurface(page, '#app', osScheme);
      await expectThemedText(page, '.instance-title', osScheme);
      await expectThemedText(page, '.back-link', osScheme);

      // public-sidebar-card: its own surface and border.
      await expectThemedSurface(page, '.sidebar-card', osScheme);
      await expectColorSide(page, '.sidebar-card', 'borderTopColor', opposite(osScheme));

      // public-button-primary: the report dialog's submit button.
      await page.locator('.report-link').click();
      await expect(page.locator('.report-dialog__btn--primary')).toBeVisible({ timeout: 15000 });
      await expectAccent(page, '.report-dialog__btn--primary', 'backgroundColor');
      await page.keyboard.press('Escape');
    });

    await test.step('not-found page', async () => {
      await page.goto(env.baseURL + '/test_calendar/events/00000000-0000-4000-8000-000000000000/20260101-1200');
      await expect(page.locator('.not-found h1')).toBeVisible({ timeout: 15000 });

      await expectThemedText(page, '.not-found h1', osScheme);
      await expectThemedText(page, '.not-found p', osScheme);
    });

    await test.step('loading state', async () => {
      // Hold the events request so public-loading-state stays on screen.
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      const eventsRoute = '**/api/public/v1/calendar/test_calendar/events**';
      await page.route(eventsRoute, async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(env.baseURL + '/test_calendar');
      await expect(page.locator('.loading')).toBeVisible({ timeout: 15000 });

      await expectThemedText(page, '.loading', osScheme);

      // Let the held request through and wait for it to land before
      // unrouting, so the handler never races the unroute.
      release();
      await expect(page.locator('li.day-event-item').first()).toBeVisible({ timeout: 15000 });
      await page.unroute(eventsRoute);
    });

    await test.step('discovery empty state', async () => {
      // No listed calendars forces the shared EmptyState.
      const calendarsRoute = /\/api\/public\/v1\/calendars(\?|$)/;
      await page.route(calendarsRoute, route => route.fulfill({ json: [] }));
      await page.goto(env.baseURL + '/discover');
      await expect(page.locator('.discovery-empty')).toBeVisible({ timeout: 15000 });

      await expectThemedText(page, '.discovery-empty .ui-empty-state__heading', osScheme);
      await expectThemedText(page, '.discovery-empty p', osScheme);
      await page.unroute(calendarsRoute);
    });

    await cleanup();
  });
}
