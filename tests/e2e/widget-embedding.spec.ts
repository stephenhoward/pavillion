import { test, expect } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Cross-Origin Widget Embedding
 *
 * Validates that the Pavillion calendar widget works correctly when embedded
 * in an external website from a different origin. Tests cover the 4 critical
 * bugs fixed in pv-4d5:
 *   1. Widget JS endpoint returns correct Content-Type (JavaScript, not HTML)
 *   2. CORS/Cross-Origin-Resource-Policy headers allow cross-origin script loading
 *   3. Widget SDK origin detection works correctly with async script loading
 *   4. Widget page CSP frame-ancestors allows iframe embedding
 *
 * Architecture:
 * - Embedding page served from localhost:8080 (static file server)
 * - Widget SDK and widget page served from localhost:3100-3200 (test server)
 * - Different ports = different origins = true cross-origin testing
 *
 * The embedding page (tests/e2e/test-widget-embedding.html) accepts
 * ?serverUrl=, ?calendar=, and ?view= query parameters.
 */

let env: TestEnvironment;

function embeddingUrl(options?: { view?: string }): string {
  const base = `http://localhost:8080/test-widget-embedding.html?serverUrl=${encodeURIComponent(env.baseURL)}&calendar=test_calendar`;
  return options?.view ? `${base}&view=${options.view}` : base;
}

// Configure tests to run serially since they share a test server
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer();
});

test.afterAll(async () => {
  await env.cleanup();
});

test.describe('Widget Embedding', () => {
  test('widget loads and displays events from external origin', async ({ page }) => {
    // Track console errors to catch CSP/CORS violations
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter out known harmless errors (favicon 404, etc.)
        if (!text.includes('favicon') && !text.includes('404')) {
          consoleErrors.push(text);
        }
      }
    });

    // Step 1: Navigate to embedding page on port 8080 (different origin from test server)
    // The ?serverUrl= parameter tells the embedding page where to load the widget SDK from
    await page.goto(embeddingUrl());

    // Step 2: Wait for widget SDK to load and become a function
    // This validates bug #1 (Content-Type) and bug #2 (CORS/CORP headers):
    // - If the JS endpoint returns HTML, the script will fail to parse and window.Pavillion stays a queue
    // - If CORS/CORP headers are wrong, the script will be blocked before execution
    await page.waitForFunction(
      () => typeof (window as any).Pavillion === 'function',
      { timeout: 15000 },
    );

    // Step 3: Wait for iframe to be created in the DOM
    // This validates bug #3 (SDK origin detection):
    // - If origin detection fails, the SDK won't call createIframe() correctly
    // - The iframe src should point to the test server (not localhost:8080)
    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });

    // Verify the iframe src points to the test server (correct origin detection)
    const iframeSrc = await page.$eval('iframe[src*="/widget/"]', (el) => (el as HTMLIFrameElement).src);
    expect(iframeSrc).toContain(env.baseURL);
    expect(iframeSrc).toContain('/widget/test_calendar');

    // Step 4: Access iframe content using frameLocator
    // This validates bug #4 (CSP frame-ancestors):
    // - If frame-ancestors blocks the embed, the iframe body will not be accessible
    const iframe = page.frameLocator('iframe[src*="/widget/"]');

    // Wait for the iframe body to be accessible and visible
    await expect(iframe.locator('body')).toBeVisible({ timeout: 20000 });

    // Step 5: Verify events display inside the iframe
    // The widget ListView renders events as li.event elements
    // The seeded test_calendar has multiple events - wait for at least one to appear
    await expect(iframe.locator('li.event').first()).toBeVisible({ timeout: 15000 });

    // Confirm multiple events exist in the seeded test data
    const eventCount = await iframe.locator('li.event').count();
    expect(eventCount).toBeGreaterThanOrEqual(1);

    // Step 6: Verify no CSP or CORS errors occurred during the entire test
    // This provides a safety net to catch any security violations that slipped through
    const criticalErrors = consoleErrors.filter(err => {
      const lower = err.toLowerCase();
      return lower.includes('csp') ||
        lower.includes('cors') ||
        lower.includes('cross-origin') ||
        lower.includes('content-security-policy') ||
        lower.includes('refused to load') ||
        lower.includes('blocked by') ||
        lower.includes('cross-origin-resource-policy');
    });

    expect(
      criticalErrors,
      `Expected no CSP/CORS violations but got: ${criticalErrors.join('; ')}`,
    ).toHaveLength(0);
  });

  test('widget iframe src uses correct server origin', async ({ page }) => {
    await page.goto(embeddingUrl());

    // Wait for SDK to initialize and create the iframe
    await page.waitForFunction(
      () => typeof (window as any).Pavillion === 'function',
      { timeout: 15000 },
    );
    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });

    // Verify the iframe origin matches the test server, not the embedding page origin
    const iframeOrigin = await page.$eval('iframe[src*="/widget/"]', (el) => {
      const src = (el as HTMLIFrameElement).src;
      try {
        return new URL(src).origin;
      }
      catch {
        return '';
      }
    });

    // The iframe should point to the test server (dynamic port), not port 8080
    expect(iframeOrigin).toBe(env.baseURL);
    expect(iframeOrigin).not.toBe('http://localhost:8080');
  });

  test('widget status indicator shows successful load', async ({ page }) => {
    await page.goto(embeddingUrl());

    // Wait for the SDK script to load (the embedding page updates #status on script load)
    await page.waitForFunction(
      () => typeof (window as any).Pavillion === 'function',
      { timeout: 15000 },
    );

    // The test embedding page shows loading status
    // When script loads successfully, it gets class 'ready'
    const statusEl = page.locator('#status');
    await expect(statusEl).toBeVisible();
    await expect(statusEl).toHaveClass(/ready/, { timeout: 15000 });
    await expect(statusEl).not.toHaveClass(/error/);
  });

  test('event detail click-through and back navigation', async ({ page }) => {
    await page.goto(embeddingUrl());

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');

    // Wait for events to render in list view
    await expect(iframe.locator('li.event').first()).toBeVisible({ timeout: 15000 });

    // Click the first event to open detail overlay
    await iframe.locator('li.event').first().click();

    // Verify event detail overlay appears with event name
    await expect(iframe.locator('.event-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(iframe.locator('.event-detail-overlay h1')).toBeVisible();

    // Click back button to return to list view
    await iframe.locator('.back-button').first().click();

    // Verify list view is restored
    await expect(iframe.locator('li.event').first()).toBeVisible({ timeout: 10000 });
  });

  test('theme parameters apply inside iframe', async ({ page }) => {
    // The embedding HTML sets accentColor=#ff9131 and colorMode=light
    await page.goto(embeddingUrl());

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');
    await expect(iframe.locator('body')).toBeVisible({ timeout: 20000 });

    // Verify light theme class is applied
    await expect(iframe.locator('.widget-root')).toHaveClass(/widget-theme-light/, { timeout: 10000 });

    // Verify accent color CSS custom property is set (non-empty check, not exact value)
    const accentColor = await iframe.locator('.widget-root').evaluate(
      (el) => el.style.getPropertyValue('--widget-accent-color'),
    );
    expect(accentColor).toBeTruthy();
  });

  test('month view renders from view parameter', async ({ page }) => {
    await page.goto(embeddingUrl({ view: 'month' }));

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');
    await expect(iframe.locator('body')).toBeVisible({ timeout: 20000 });

    // Verify month grid renders (Desktop Chrome guarantees desktop layout)
    await expect(iframe.locator('.month-grid')).toBeVisible({ timeout: 15000 });

    // Verify month title is displayed
    await expect(iframe.locator('.month-title')).toBeVisible();
    await expect(iframe.locator('.month-title')).not.toBeEmpty();
  });

  test('week view renders from view parameter', async ({ page }) => {
    await page.goto(embeddingUrl({ view: 'week' }));

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');
    await expect(iframe.locator('body')).toBeVisible({ timeout: 20000 });

    // Verify week grid renders
    await expect(iframe.locator('.week-grid')).toBeVisible({ timeout: 15000 });

    // Verify week title (date range) is displayed
    await expect(iframe.locator('.week-title')).toBeVisible();
    await expect(iframe.locator('.week-title')).not.toBeEmpty();
  });

  test('postMessage resize events reach the embedding page', async ({ page }) => {
    await page.goto(embeddingUrl());

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');

    // Wait for widget to fully load with events
    await expect(iframe.locator('li.event').first()).toBeVisible({ timeout: 15000 });

    // Wait for at least one pavillion:resize message to arrive on the embedding page.
    // The widget debounces resize notifications by 100ms, so poll until one appears.
    await page.waitForFunction(
      () => (window as any).__messages.some((m: any) => m.type === 'pavillion:resize'),
      { timeout: 10000 },
    );

    const resizeMessages = await page.evaluate(
      () => (window as any).__messages.filter((m: any) => m.type === 'pavillion:resize'),
    );
    expect(resizeMessages.length).toBeGreaterThanOrEqual(1);
    expect(resizeMessages[0]).toHaveProperty('height');
    expect(typeof resizeMessages[0].height).toBe('number');
  });
});
