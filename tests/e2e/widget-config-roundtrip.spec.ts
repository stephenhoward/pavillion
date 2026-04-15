import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Widget Configuration Roundtrip
 *
 * End-to-end verification that a calendar editor can save a widget view-mode
 * preference in the admin tab and that the change is reflected in the widget's
 * rendered DOM on a subsequent load.
 *
 * Flow:
 *   1. Log in as admin (calendar editor).
 *   2. Navigate to the calendar's widget admin tab.
 *   3. Click the "Week View" card (default is "List").
 *   4. Click Save. Assert:
 *        - PUT response returns the saved config.
 *        - Success message appears.
 *        - Save button disables (dirty state cleared).
 *   5. Open the cross-origin widget embedding page in a fresh browser context
 *      and assert that the widget iframe renders the week view — proving the
 *      saved server config flowed through the widget-facing endpoint and into
 *      the widget's rendered DOM.
 *
 * Cross-origin is required for the widget-facing endpoint: `/api/widget/v1/...`
 * requires an Origin header, which the browser only sets on cross-origin
 * requests. The embedding fixture runs on port 8080, the server on 3100-3200.
 *
 * Bead: pv-jwgn.4 — depends on pv-jwgn.2.2, pv-jwgn.3.1, and pv-jwgn.3.2.
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
