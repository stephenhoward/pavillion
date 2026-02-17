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
 * The embedding page (tests/e2e/test-widget-embedding.html) accepts a
 * ?serverUrl= query parameter to configure which test server to use.
 */

let env: TestEnvironment;

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
    const embeddingUrl = `http://localhost:8080/test-widget-embedding.html?serverUrl=${encodeURIComponent(env.baseURL)}&calendar=test_calendar`;
    await page.goto(embeddingUrl);

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
    // Navigate to embedding page
    const embeddingUrl = `http://localhost:8080/test-widget-embedding.html?serverUrl=${encodeURIComponent(env.baseURL)}&calendar=test_calendar`;
    await page.goto(embeddingUrl);

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
    // Navigate to embedding page
    const embeddingUrl = `http://localhost:8080/test-widget-embedding.html?serverUrl=${encodeURIComponent(env.baseURL)}&calendar=test_calendar`;
    await page.goto(embeddingUrl);

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
});
