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
    });

    await test.step('event page', async () => {
      await page.locator('li.day-event-item h3 a').first().click();
      await expect(page.locator('.instance-title')).toBeVisible({ timeout: 15000 });

      await expectThemedSurface(page, '#app', osScheme);
      await expectThemedText(page, '.instance-title', osScheme);
      await expectThemedText(page, '.back-link', osScheme);
    });

    await test.step('not-found page', async () => {
      await page.goto(env.baseURL + '/test_calendar/events/00000000-0000-4000-8000-000000000000/20260101-1200');
      await expect(page.locator('.not-found h1')).toBeVisible({ timeout: 15000 });

      await expectThemedText(page, '.not-found h1', osScheme);
      await expectThemedText(page, '.not-found p', osScheme);
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
