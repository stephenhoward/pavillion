import { test, expect, Browser, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

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

// ============================================================================
// Color mode override scenarios (pv-16wd.3.2 scenarios 2–4)
// ============================================================================
//
// Each scenario asserts that the user-chosen color mode wins over the system
// preference reported by `prefers-color-scheme`. The signal is the theme
// class that `widgetStore.applyColorMode()` writes to the widget root —
// `widget-theme-light` or `widget-theme-dark`. Components consume that class
// via the `public-light-mode-override` mixin (and matching dark variants) to
// override the dark-mode media query through specificity.
//
// The class on `.widget-root` is the authoritative behavioral observable
// from `applyColorMode()`. The light/dark override tests also assert the
// downstream visual background-color cascade on `.widget-container` —
// without that assertion, a regression in the SCSS theme-override mixins
// (e.g. Vue's `:global(...) &` compilation bug, see pv-ezc7) could leave
// the class on the root while the actual cascade was broken.

async function getWidgetRootClasses(iframe: ReturnType<Page['frameLocator']>): Promise<string> {
  return iframe.locator('.widget-root').evaluate((el) => el.className);
}

/**
 * Parse a CSS rgb()/rgba() color string into a normalized `{r,g,b}` triple.
 * Returns null if the string is not a recognizable rgb() or rgba().
 */
function parseRgb(color: string): { r: number; g: number; b: number } | null {
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
  };
}

/**
 * Heuristic luminance check. The widget's light background is white-ish
 * (#ffffff) and the dark background is near-black (#1a1a1e). We check the
 * average channel value on each side of 128 to avoid coupling to exact
 * SCSS token values, which is more resilient to design-system tweaks.
 */
function isLightColor(color: string): boolean {
  const rgb = parseRgb(color);
  if (!rgb) return false;
  return (rgb.r + rgb.g + rgb.b) / 3 > 128;
}

function isDarkColor(color: string): boolean {
  const rgb = parseRgb(color);
  if (!rgb) return false;
  return (rgb.r + rgb.g + rgb.b) / 3 < 128;
}

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

  // Wait for the widget-root with the explicit light theme class. This is the
  // contract: applyColorMode() removes both classes and adds exactly one based
  // on the resolved mode. With the saved colorMode === 'light', the resolved
  // mode is 'light' regardless of the system preference.
  await expect(iframe.locator('.widget-root.widget-theme-light')).toBeVisible({ timeout: 20000 });
  await expect(iframe.locator('.widget-root.widget-theme-dark')).toHaveCount(0);

  // Visual cascade: the `.widget-theme-light &` override mixin must drive the
  // background-color on `.widget-container` to a light value even though the
  // OS prefers dark. This guards against Vue's scoped-style compilation bug
  // (pv-ezc7) where `:global(.widget-theme-light) &` compiles to a bare
  // `.widget-theme-light{...}` rule with the descendant dropped.
  await expect(iframe.locator('.widget-container')).toBeVisible({ timeout: 20000 });
  await expect.poll(
    async () => {
      const bg = await iframe.locator('.widget-container').evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      return isLightColor(bg);
    },
    { timeout: 15000, intervals: [200, 500, 1000] },
  ).toBe(true);

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

  await expect(iframe.locator('.widget-root.widget-theme-dark')).toBeVisible({ timeout: 20000 });
  await expect(iframe.locator('.widget-root.widget-theme-light')).toHaveCount(0);

  // Visual cascade: the `.widget-theme-dark &` override mixin must drive the
  // background-color on `.widget-container` to a dark value even though the
  // OS prefers light.
  await expect(iframe.locator('.widget-container')).toBeVisible({ timeout: 20000 });
  await expect.poll(
    async () => {
      const bg = await iframe.locator('.widget-container').evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      return isDarkColor(bg);
    },
    { timeout: 15000, intervals: [200, 500, 1000] },
  ).toBe(true);

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

  await expect(iframe.locator('.widget-root')).toBeVisible({ timeout: 20000 });

  await expect.poll(
    () => getWidgetRootClasses(iframe),
    { timeout: 15000, intervals: [200, 500, 1000] },
  ).toContain('widget-theme-dark');

  // Flip the OS preference to light without reloading. The matchMedia
  // listener registered by applyColorMode() must fire and swap the class.
  // The poll guards against any small async delay between emulateMedia and
  // the listener handler dispatching the class update.
  await embedPage.emulateMedia({ colorScheme: 'light' });

  await expect.poll(
    () => getWidgetRootClasses(iframe),
    { timeout: 15000, intervals: [200, 500, 1000] },
  ).toContain('widget-theme-light');

  // Flip back to dark — auto should react again, proving the listener
  // handles repeated transitions (no stacked / stale listeners).
  await embedPage.emulateMedia({ colorScheme: 'dark' });

  await expect.poll(
    () => getWidgetRootClasses(iframe),
    { timeout: 15000, intervals: [200, 500, 1000] },
  ).toContain('widget-theme-dark');

  await cleanup();
});
