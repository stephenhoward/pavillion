import { test, expect, Browser, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  Theme,
  opposite,
  expectThemedText,
  expectColorSide,
  expectThemedSurface,
} from './helpers/color-mode';

/**
 * E2E Tests: Widget Configuration Roundtrip
 *
 * End-to-end verification that a calendar editor can save widget configuration
 * (view mode, accent color, color mode) in the admin tab and that those changes
 * are reflected in the widget's rendered DOM on a subsequent load.
 *
 * Cross-origin is required for the widget-facing endpoint: `/api/widget/v1/...`
 * requires an Origin header, which the browser only sets on cross-origin
 * requests. The embedding fixture runs on port 8080, the server on 3100-3200.
 *
 * Beads:
 *   - pv-jwgn.4 — view mode roundtrip (depends on pv-jwgn.2.2/3.1/3.2)
 *   - pv-16wd.3.2 — accent color + color mode E2E coverage (extends this file)
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer();
});

test.afterAll(async () => {
  await env.cleanup();
});

test('admin change to widget view mode is reflected in rendered widget', async ({ page, browser }) => {
  // Step 1: Log in as admin.
  await loginAsAdmin(page, env.baseURL);

  // Step 2: Navigate directly to the calendar management page and open the widget tab.
  await page.goto(env.baseURL + '/calendar/test_calendar/manage');
  await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

  const widgetTabButton = page.locator('#widget-tab');
  await widgetTabButton.click();

  // Wait for widget config section to render and complete its initial load.
  const widgetConfig = page.locator('.widget-config');
  await expect(widgetConfig).toBeVisible({ timeout: 15000 });

  // The list view card is the default selection. Confirm the starting state.
  const listCard = widgetConfig.locator('button.view-mode-card').filter({ hasText: 'List View' });
  await expect(listCard).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });

  // Save button starts disabled because nothing is dirty after initial load.
  const saveButton = widgetConfig.locator('button.save-button');
  await expect(saveButton).toBeDisabled();

  // Step 3: Click the Week View card.
  const weekCard = widgetConfig.locator('button.view-mode-card').filter({ hasText: 'Week View' });
  await weekCard.click();
  await expect(weekCard).toHaveAttribute('aria-pressed', 'true');

  // Save button becomes enabled once dirty.
  await expect(saveButton).toBeEnabled();

  // Step 4: Click Save and verify the PUT request persists the new view.
  const savePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/widget/config')
      && response.request().method() === 'PUT'
      && response.ok(),
    { timeout: 15000 },
  );
  await saveButton.click();
  const saveResponse = await savePromise;
  const savedBody = await saveResponse.json();
  expect(savedBody.view).toBe('week');
  expect(savedBody.accentColor).toBe('#ff9131');
  expect(savedBody.colorMode).toBe('auto');

  // Success message appears and Save button disables again (clean state).
  await expect(widgetConfig.locator('.alert--success')).toBeVisible({ timeout: 10000 });
  await expect(saveButton).toBeDisabled();

  // Step 5: Open the cross-origin embedding page in a fresh context (no
  // admin session, separate origin). The widget iframe will load from the
  // server and must render the week view based on the server-persisted config.
  //
  // Note: The embedding fixture passes SDK args `view: 'list'` which the
  // simplified SDK now ignores (deprecated). That means the iframe src has
  // no `view=` query parameter and the rendered view is driven entirely by
  // the server-stored widget config — exactly what we want to assert.
  const embedContext = await browser.newContext();
  const embedPage = await embedContext.newPage();

  const embeddingUrl
    = `http://localhost:8080/test-widget-embedding.html?serverUrl=${encodeURIComponent(env.baseURL)}&calendar=test_calendar`;
  await embedPage.goto(embeddingUrl);

  // Wait for the widget iframe to be created.
  await embedPage.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
  const iframe = embedPage.frameLocator('iframe[src*="/widget/"]');

  // Assert the week-view container rendered inside the iframe. This proves the
  // full roundtrip: admin save → DB → widget-facing endpoint → widgetStore →
  // rendered DOM.
  await expect(iframe.locator('.week-view')).toBeVisible({ timeout: 20000 });
  await expect(iframe.locator('.week-grid')).toBeVisible();

  // Make sure the list view did NOT render (proves the server config took
  // precedence over the default, not the other way around).
  await expect(iframe.locator('.list-view')).toHaveCount(0);

  await embedContext.close();
});

// ============================================================================
// Helpers (used by accent color + color mode scenarios — pv-16wd.3.2)
// ============================================================================

/**
 * Save the widget config from the admin tab.
 *
 * The caller must already be on the calendar management page with the Widget
 * tab visible. Waits for the PUT /widget/config response so the next reader
 * sees the persisted state. Returns the parsed save response body so the
 * caller can assert what was actually persisted.
 */
async function saveWidgetConfig(
  page: Page,
  options: { accentColor?: string; colorMode?: 'auto' | 'light' | 'dark' },
): Promise<{ view: string; accentColor: string; colorMode: string }> {
  const widgetConfig = page.locator('.widget-config');
  await expect(widgetConfig).toBeVisible({ timeout: 15000 });

  // Wait for the initial GET to populate the form before mutating it.
  // The save button is disabled while the form is in its loaded/clean state.
  const saveButton = widgetConfig.locator('button.save-button');
  await expect(saveButton).toBeDisabled({ timeout: 10000 });

  if (options.accentColor !== undefined) {
    // <input type="color"> in Chromium/Playwright sometimes does not propagate
    // value mutations to Vue's v-model via `fill()` alone. Setting `.value`
    // and dispatching both `input` and `change` events explicitly closes that
    // gap deterministically.
    await widgetConfig.locator('#accentColor').evaluate((el, value) => {
      const input = el as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, options.accentColor);
  }
  if (options.colorMode !== undefined) {
    await widgetConfig.locator('#colorMode').selectOption(options.colorMode);
  }

  await expect(saveButton).toBeEnabled();

  const savePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/widget/config')
      && response.request().method() === 'PUT'
      && response.ok(),
    { timeout: 15000 },
  );
  await saveButton.click();
  const saveResponse = await savePromise;
  const savedBody = await saveResponse.json();

  await expect(widgetConfig.locator('.alert--success')).toBeVisible({ timeout: 10000 });
  await expect(saveButton).toBeDisabled();

  return savedBody;
}

/**
 * Open the cross-origin widget embedding fixture in a fresh browser context.
 *
 * Returns the embed page and a cleanup function. The fresh context avoids any
 * admin session leakage and exercises the public widget-facing endpoint.
 */
async function openWidgetEmbed(
  browser: Browser,
  baseURL: string,
  options: { colorScheme?: 'light' | 'dark' } = {},
): Promise<{ embedPage: Page; cleanup: () => Promise<void> }> {
  const embedContext = await browser.newContext();
  const embedPage = await embedContext.newPage();

  if (options.colorScheme !== undefined) {
    await embedPage.emulateMedia({ colorScheme: options.colorScheme });
  }

  const embeddingUrl
    = `http://localhost:8080/test-widget-embedding.html?serverUrl=${encodeURIComponent(baseURL)}&calendar=test_calendar`;
  await embedPage.goto(embeddingUrl);

  await embedPage.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });

  return {
    embedPage,
    cleanup: () => embedContext.close(),
  };
}

/**
 * Open the admin Widget tab for the test calendar. Caller must already be
 * logged in as admin. Returns when the widget config form is visible and the
 * Save button is in its clean (disabled) state.
 */
async function openWidgetAdminTab(page: Page, baseURL: string): Promise<void> {
  await page.goto(baseURL + '/calendar/test_calendar/manage');
  await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });
  await page.locator('#widget-tab').click();
  await expect(page.locator('.widget-config')).toBeVisible({ timeout: 15000 });
  // Save button disabled = initial GET completed and snapshot taken.
  await expect(page.locator('.widget-config button.save-button')).toBeDisabled({ timeout: 10000 });
}

// ============================================================================
// Accent color round-trip (pv-16wd.3.2 scenario 1)
// ============================================================================

test('admin-saved accent color is injected as CSS custom property in rendered widget', async ({ page, browser }) => {
  await loginAsAdmin(page, env.baseURL);
  await openWidgetAdminTab(page, env.baseURL);

  // Pick a vivid accent that cannot collide with the SCSS-default value.
  const ACCENT = '#ff00ff';
  const saved = await saveWidgetConfig(page, { accentColor: ACCENT });
  expect(saved.accentColor).toBe(ACCENT);

  // Open the cross-origin widget embed and assert the accent variable was
  // injected by the widget store via element.style.setProperty().
  const { embedPage, cleanup } = await openWidgetEmbed(browser, env.baseURL);
  const iframe = embedPage.frameLocator('iframe[src*="/widget/"]');

  // Wait for the widget root to render. We then read the CSS custom property
  // directly — this is the deterministic surface where injectAccentColor()
  // writes, so it does not depend on which view is rendered nor on whether
  // any specific event-card pseudo-element resolves the var().
  await expect(iframe.locator('.widget-root')).toBeVisible({ timeout: 20000 });

  // Poll the computed style for the custom property until the widget store
  // has had a chance to apply the server config. The hex value is preserved
  // verbatim because injectAccentColor uses setProperty with the validated
  // string, not a parsed/serialized color.
  await expect.poll(
    async () => {
      return iframe.locator('.widget-root').evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          light: cs.getPropertyValue('--pav-accent-light').trim(),
          dark: cs.getPropertyValue('--pav-accent-dark').trim(),
        };
      });
    },
    { timeout: 15000, intervals: [200, 500, 1000] },
  ).toEqual({ light: ACCENT, dark: ACCENT });

  await cleanup();
});

// The injected property is only half the contract: the list view's event
// time and day-heading marker, and the detail page's accents, must actually
// paint with it. They used to read compile-time SCSS accents and stayed the
// default orange whatever the owner configured (pv-nskn). Checked under both
// OS schemes, since each theme reads its own fixed-mode accent property.
test('list view and event detail paint with the saved accent', async ({ page, browser }) => {
  await loginAsAdmin(page, env.baseURL);
  await openWidgetAdminTab(page, env.baseURL);

  // The mitown-climate repro value: a green far from the default orange.
  const ACCENT = '#669c35';
  const ACCENT_RGB = 'rgb(102, 156, 53)';
  const saved = await saveWidgetConfig(page, { accentColor: ACCENT });
  expect(saved.accentColor).toBe(ACCENT);
  expect(saved.colorMode).toBe('auto');

  for (const osScheme of ['light', 'dark'] as const) {
    await test.step(`${osScheme} OS`, async () => {
      const { embedPage, cleanup } = await openWidgetEmbed(browser, env.baseURL, { colorScheme: osScheme });
      const iframe = embedPage.frameLocator('iframe[src*="/widget/"]');
      await expect(iframe.locator('.widget-root')).toBeVisible({ timeout: 20000 });
      // An earlier test saved the week view; `?view=list` overrides it.
      await gotoInWidgetFrame(embedPage, env.baseURL, '/widget/test_calendar?view=list');
      await expect(iframe.locator('.list-view article.event-card').first()).toBeVisible({ timeout: 20000 });

      await expect.poll(
        async () => ({
          eventTime: await iframe.locator('.list-view .event-time').first()
            .evaluate(el => getComputedStyle(el).color),
          dayMarker: await iframe.locator('.list-view .day-heading').first()
            .evaluate(el => getComputedStyle(el, '::before').backgroundColor),
        }),
        { timeout: 15000, intervals: [200, 500, 1000] },
      ).toEqual({ eventTime: ACCENT_RGB, dayMarker: ACCENT_RGB });

      // The event detail page renders the shared EventDetailBody, whose date
      // icon and Add to Calendar button carry the accent too.
      await iframe.locator('.list-view .event-title-link').first().click();
      await expect(iframe.locator('.add-to-calendar-btn')).toBeVisible({ timeout: 20000 });
      await expect.poll(
        async () => ({
          dateIcon: await iframe.locator('.datetime-icon--date').first()
            .evaluate(el => getComputedStyle(el).color),
          addToCalendar: await iframe.locator('.add-to-calendar-btn')
            .evaluate(el => getComputedStyle(el).color),
        }),
        { timeout: 15000, intervals: [200, 500, 1000] },
      ).toEqual({ dateIcon: ACCENT_RGB, addToCalendar: ACCENT_RGB });

      // Hover reads --pav-accent-hover, which injectAccentColor derives from
      // the accent (towards black in light, towards white in dark). The seed
      // has no event with an external link, so the linked category badge —
      // which reads the same token as the More Information button — stands in.
      // The expected colour is resolved by the browser from the same mix, so
      // the comparison does not depend on how color-mix() serialises.
      const mixTarget = osScheme === 'light' ? 'black' : 'white';
      const expectedHover = await iframe.locator('.widget-root').evaluate((root, mix) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = mix;
        root.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      }, `color-mix(in srgb, ${ACCENT} 90%, ${mixTarget})`);
      const badge = iframe.locator('a.event-category-badge').first();
      await badge.hover();
      await expect.poll(
        () => badge.evaluate(el => getComputedStyle(el).backgroundColor),
        { timeout: 15000, intervals: [200, 500, 1000] },
      ).toBe(expectedHover);

      await cleanup();
    });
  }
});

// ============================================================================
// Color mode override scenarios (pv-16wd.3.2 scenarios 2–4)
// ============================================================================
//
// Each scenario asserts that the user-chosen color mode wins over the system
// preference reported by `prefers-color-scheme`. The signal is the
// `data-theme` attribute that `widgetStore.applyColorMode()` writes to the
// widget iframe's `<html>` — `light` or `dark` for a forced mode, absent for
// `auto`. The self-guarding `public-dark-mode` mixin reads it:
// `[data-theme="dark"]` forces the dark branch, `[data-theme="light"]`
// suppresses the OS media-query branch.
//
// The attribute is the behavioral observable from `applyColorMode()`. Every
// scenario also asserts the downstream background-color cascade on
// `.widget-container` — without that, a regression in the mixin (e.g. Vue's
// `:global(...) &` compilation bug, see pv-ezc7) could leave the attribute
// set while the actual cascade was broken. The background is classified by
// the shared `expectColorSide` helper rather than matched to a token value.

test('color mode "light" overrides system dark preference', async ({ page, browser }) => {
  await loginAsAdmin(page, env.baseURL);
  await openWidgetAdminTab(page, env.baseURL);
  const saved = await saveWidgetConfig(page, { colorMode: 'light' });
  expect(saved.colorMode).toBe('light');

  // Emulate a dark OS — the saved Light mode must win.
  const { embedPage, cleanup } = await openWidgetEmbed(browser, env.baseURL, {
    colorScheme: 'dark',
  });
  const iframe = embedPage.frameLocator('iframe[src*="/widget/"]');

  // With the saved colorMode === 'light', the widget document's root carries
  // data-theme="light" regardless of the system preference.
  await expect(iframe.locator('html[data-theme="light"]')).toHaveCount(1, { timeout: 20000 });

  // Visual cascade: the guarded dark-mode media query must stand down under
  // data-theme="light", leaving `.widget-container` light even though the OS
  // prefers dark.
  await expect(iframe.locator('.widget-container')).toBeVisible({ timeout: 20000 });
  await expectColorSide(iframe, '.widget-container', 'backgroundColor', 'light');

  await cleanup();
});

test('color mode "dark" overrides system light preference', async ({ page, browser }) => {
  await loginAsAdmin(page, env.baseURL);
  await openWidgetAdminTab(page, env.baseURL);
  const saved = await saveWidgetConfig(page, { colorMode: 'dark' });
  expect(saved.colorMode).toBe('dark');

  // Emulate a light OS — the saved Dark mode must win.
  const { embedPage, cleanup } = await openWidgetEmbed(browser, env.baseURL, {
    colorScheme: 'light',
  });
  const iframe = embedPage.frameLocator('iframe[src*="/widget/"]');

  await expect(iframe.locator('html[data-theme="dark"]')).toHaveCount(1, { timeout: 20000 });

  // Visual cascade: `[data-theme="dark"] &` must drive the background-color on
  // `.widget-container` to a dark value even though the OS prefers light.
  await expect(iframe.locator('.widget-container')).toBeVisible({ timeout: 20000 });
  await expectColorSide(iframe, '.widget-container', 'backgroundColor', 'dark');

  await cleanup();
});

test('color mode "auto" follows system preference and reacts to changes', async ({ page, browser }) => {
  await loginAsAdmin(page, env.baseURL);
  await openWidgetAdminTab(page, env.baseURL);
  const saved = await saveWidgetConfig(page, { colorMode: 'auto' });
  expect(saved.colorMode).toBe('auto');

  // Start with a dark OS — auto should resolve to dark.
  const { embedPage, cleanup } = await openWidgetEmbed(browser, env.baseURL, {
    colorScheme: 'dark',
  });
  const iframe = embedPage.frameLocator('iframe[src*="/widget/"]');

  await expect(iframe.locator('.widget-container')).toBeVisible({ timeout: 20000 });

  // Auto leaves data-theme unset, so the stylesheet's media query decides.
  await expect(iframe.locator('html[data-theme]')).toHaveCount(0);

  await expectColorSide(iframe, '.widget-container', 'backgroundColor', 'dark');

  // Flip the OS preference to light without reloading. The media query
  // re-evaluates live; no JavaScript listener is involved.
  await embedPage.emulateMedia({ colorScheme: 'light' });

  await expectColorSide(iframe, '.widget-container', 'backgroundColor', 'light');

  // Flip back to dark — auto should react again.
  await embedPage.emulateMedia({ colorScheme: 'dark' });

  await expectColorSide(iframe, '.widget-container', 'backgroundColor', 'dark');

  await cleanup();
});

// ============================================================================
// Forced color mode on every widget surface (pv-l3my.4)
// ============================================================================
//
// The scenarios above only prove the forced mode reaches `.widget-container`.
// The surfaces that actually broke under a forced mode were the ones whose
// dark rule had no hand-paired light override: the footer and its logo, the
// shared filter label, the date popover, and the not-found page. Each one is
// asserted here in both mismatched directions (forced light on a dark OS,
// forced dark on a light OS), so a regression in the `public-dark-mode` guard
// fails CI rather than surfacing as a support report.
//
// The colour classification (ink vs surface side, 3:1 text contrast floor)
// lives in helpers/color-mode.ts, shared with the site colour-mode spec.

/**
 * Load a widget path inside the embed page's existing iframe, so the page's
 * emulated OS colour scheme carries over. A fresh document load re-runs the
 * router guard, which applies the server-saved colour mode.
 */
async function gotoInWidgetFrame(embedPage: Page, baseURL: string, path: string): Promise<void> {
  const frame = embedPage.frames().find(f => f.url().includes('/widget/'));
  if (!frame) {
    throw new Error('Widget iframe not found on the embed page');
  }
  await frame.goto(baseURL + path);
}

const FORCED_MODE_DIRECTIONS: { colorMode: Theme; osScheme: Theme }[] = [
  { colorMode: 'light', osScheme: 'dark' },
  { colorMode: 'dark', osScheme: 'light' },
];

for (const { colorMode, osScheme } of FORCED_MODE_DIRECTIONS) {
  test(`color mode "${colorMode}" on a ${osScheme} OS reaches footer, filters, date popover, empty state and not-found`, async ({ page, browser }) => {
    await loginAsAdmin(page, env.baseURL);
    await openWidgetAdminTab(page, env.baseURL);
    const saved = await saveWidgetConfig(page, { colorMode });
    expect(saved.colorMode).toBe(colorMode);

    const { embedPage, cleanup } = await openWidgetEmbed(browser, env.baseURL, { colorScheme: osScheme });
    const iframe = embedPage.frameLocator('iframe[src*="/widget/"]');
    await expect(iframe.locator(`html[data-theme="${colorMode}"]`)).toHaveCount(1, { timeout: 20000 });

    // The footer and the shared filter label are on every view. `?view=` is
    // the admin-preview override, applied after the saved config, so it
    // switches the view without touching the saved colour mode.
    for (const view of ['list', 'week', 'month'] as const) {
      await test.step(`${view} view: footer, logo and filter label`, async () => {
        await gotoInWidgetFrame(embedPage, env.baseURL, `/widget/test_calendar?view=${view}`);
        await expect(iframe.locator(`.${view}-view`)).toBeVisible({ timeout: 20000 });
        await expect(iframe.locator(`html[data-theme="${colorMode}"]`)).toHaveCount(1);

        // The footer sits outside the themed container, on the iframe's
        // transparent canvas, so its colours are classified on their own.
        await expectColorSide(iframe, '.widget-footer', 'color', opposite(colorMode));
        await expectColorSide(iframe, '.widget-footer', 'borderTopColor', opposite(colorMode));
        // The logo is a masked <span>; its visible colour is its background.
        await expectColorSide(iframe, '.widget-footer .pavillion-logo', 'backgroundColor', opposite(colorMode));

        await expectThemedText(iframe, '.category-filter-section .filter-label', colorMode);
      });
    }

    await test.step('list view: date popover and custom date inputs', async () => {
      await gotoInWidgetFrame(embedPage, env.baseURL, '/widget/test_calendar?view=list');
      await expect(iframe.locator('.list-view')).toBeVisible({ timeout: 20000 });

      await iframe.locator('.date-filter-button').click();
      await expect(iframe.locator('.date-dropdown')).toBeVisible();
      await expectThemedSurface(iframe, '.date-dropdown', colorMode);

      await iframe.locator('.date-pill.calendar-pill').click();
      await expect(iframe.locator('.date-input').first()).toBeVisible();
      await expectThemedText(iframe, '.date-input-label', colorMode);
      await expectThemedText(iframe, '.date-input', colorMode);
      await expectThemedSurface(iframe, '.date-input', colorMode);
      await expectColorSide(iframe, '.date-input', 'borderTopColor', opposite(colorMode));
    });

    await test.step('list view: shared EmptyState when there are no events', async () => {
      // An empty event list is forced by stubbing the events endpoint; the
      // route applies to the iframe's requests too.
      const eventsRoute = '**/api/public/v1/calendar/test_calendar/events**';
      await embedPage.route(eventsRoute, route => route.fulfill({ json: [] }));
      await gotoInWidgetFrame(embedPage, env.baseURL, '/widget/test_calendar?view=list');
      await expect(iframe.locator('.ui-empty-state')).toBeVisible({ timeout: 20000 });
      await expectThemedText(iframe, '.ui-empty-state p', colorMode);
      await embedPage.unroute(eventsRoute);
    });

    await test.step('not-found page', async () => {
      // A well-formed occurrence slug for an event that does not exist: the
      // calendar (and so its saved colour mode) loads, the instance does not.
      await gotoInWidgetFrame(
        embedPage,
        env.baseURL,
        '/widget/test_calendar/events/00000000-0000-4000-8000-000000000000/20260101-1200',
      );
      await expect(iframe.locator('.not-found h1')).toBeVisible({ timeout: 20000 });
      await expect(iframe.locator(`html[data-theme="${colorMode}"]`)).toHaveCount(1);
      await expectThemedText(iframe, '.not-found h1', colorMode);
      await expectThemedText(iframe, '.not-found p', colorMode);
    });

    await cleanup();
  });
}
