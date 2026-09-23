import { test, expect, Page, FrameLocator, ConsoleMessage } from '@playwright/test';
import axios from 'axios';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  loginViaApi,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_CALENDAR_ID,
  ADMIN_CALENDAR_URL_NAME,
  TESTUSER_CALENDAR_URL_NAME,
} from './helpers/notification-fixtures';

/**
 * E2E Tests: Widget Security Headers
 *
 * Validates that widget endpoints return the correct security headers
 * to enable cross-origin embedding. Tests cover the 4 critical bugs
 * fixed in pv-4d5:
 *   1. Widget JS endpoint returning correct Content-Type (not HTML)
 *   2. CORS headers allowing cross-origin script loading
 *   3. Cross-Origin-Resource-Policy allowing cross-origin use
 *   4. Widget page CSP frame-ancestors allowing iframe embedding
 *
 * Uses Playwright request context for direct HTTP header validation
 * without full page navigation.
 */

let env: TestEnvironment;

// Configure tests to run serially within this file
test.describe.configure({ mode: 'serial' });

// The framing tests serve embedder pages on public hostnames (intercepted,
// never on the network) that frame the localhost test server. Chromium's
// Local Network Access checks would block that public→local navigation before
// the frame-ancestors policy under test is ever consulted.
test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] } });

test.beforeAll(async () => {
  env = await startTestServer();
});

test.afterAll(async () => {
  await env.cleanup();
});

test.describe('Widget Script CORS Headers', () => {
  test('widget script has correct Content-Type header', async ({ request }) => {
    const response = await request.get(`${env.baseURL}/widget/pavillion-widget.js`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
  });

  test('widget script has correct Access-Control-Allow-Origin header', async ({ request }) => {
    const response = await request.get(`${env.baseURL}/widget/pavillion-widget.js`);

    expect(response.status()).toBe(200);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
  });

  test('widget script has correct Cross-Origin-Resource-Policy header', async ({ request }) => {
    const response = await request.get(`${env.baseURL}/widget/pavillion-widget.js`);

    expect(response.status()).toBe(200);
    expect(response.headers()['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

test.describe('Widget Page CSP Headers', () => {
  test('widget page has frame-ancestors in CSP header', async ({ request }) => {
    const response = await request.get(`${env.baseURL}/widget/test_calendar`);

    expect(response.status()).toBe(200);
    const csp = response.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain('frame-ancestors');
  });

  test('widget page CSP does not block all iframe embedding', async ({ request }) => {
    const response = await request.get(`${env.baseURL}/widget/test_calendar`);

    expect(response.status()).toBe(200);
    const csp = response.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).not.toContain("'none'");
  });

  test('non-widget page CSP blocks iframe embedding by default', async ({ request }) => {
    const response = await request.get(`${env.baseURL}/`);

    const csp = response.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

/**
 * The widget shell's frame-ancestors follows each calendar's Allowed Domain
 * (DEC-020). test_calendar is given `example.com`; testuser_calendar keeps no
 * domain, so it may be framed only by the instance itself and localhost.
 */
test.describe('Widget Allowed Domain enforcement', () => {
  const CONFIGURED_CALENDAR = ADMIN_CALENDAR_URL_NAME;
  const UNCONFIGURED_CALENDAR = TESTUSER_CALENDAR_URL_NAME;

  test.beforeAll(async () => {
    const adminJWT = await loginViaApi(env.baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    await axios.put(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/widget/domain`,
      { domain: 'example.com' },
      { headers: { Authorization: `Bearer ${adminJWT}` } },
    );
  });

  /**
   * The space-separated sources of a frame-ancestors header value.
   */
  function frameSources(csp: string): string[] {
    expect(csp.startsWith('frame-ancestors ')).toBe(true);
    return csp.slice('frame-ancestors '.length).split(' ');
  }

  /** Sources other than the localhost development exception. */
  function nonLocalhostSources(csp: string): string[] {
    return frameSources(csp).filter(source => !/^http:\/\/(localhost|127\.0\.0\.1|\*\.localhost)(:|$)/.test(source));
  }

  /** Chromium's console report of a frame blocked by frame-ancestors. */
  function isFrameAncestorsViolation(msg: ConsoleMessage): boolean {
    return msg.text().includes('violates the following Content Security Policy directive: "frame-ancestors');
  }

  /**
   * Serve a one-iframe page at `embedderUrl` (intercepted, never on the
   * network) that frames the given calendar's widget shell.
   */
  async function embedFrom(page: Page, embedderUrl: string, calendarUrlName: string): Promise<FrameLocator> {
    await page.route(embedderUrl, route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><iframe src="${env.baseURL}/widget/${calendarUrlName}" width="800" height="600"></iframe>`,
    }));
    await page.goto(embedderUrl);
    return page.frameLocator('iframe');
  }

  test('configured calendar permits its domain and the www twin', async ({ request }) => {
    const response = await request.get(`${env.baseURL}/widget/${CONFIGURED_CALENDAR}`);

    expect(response.status()).toBe(200);
    expect(nonLocalhostSources(response.headers()['content-security-policy'])).toEqual([
      "'self'",
      'https://example.com:*',
      'https://www.example.com:*',
    ]);
  });

  test('unconfigured calendar permits only self', async ({ request }) => {
    const response = await request.get(`${env.baseURL}/widget/${UNCONFIGURED_CALENDAR}`);

    expect(response.status()).toBe(200);
    expect(nonLocalhostSources(response.headers()['content-security-policy'])).toEqual(["'self'"]);
  });

  test('no widget shell response ever permits every origin', async ({ request }) => {
    for (const calendar of [CONFIGURED_CALENDAR, UNCONFIGURED_CALENDAR, 'no_such_calendar']) {
      const response = await request.get(`${env.baseURL}/widget/${calendar}`);
      expect(frameSources(response.headers()['content-security-policy'])).not.toContain('*');
    }
  });

  test('configured calendar renders when framed from its www twin', async ({ page }) => {
    const frame = await embedFrom(page, 'https://www.example.com/events', CONFIGURED_CALENDAR);

    await expect(frame.locator('article.event-card').first()).toBeVisible({ timeout: 20000 });
  });

  test('configured calendar renders when framed from its apex domain', async ({ page }) => {
    const frame = await embedFrom(page, 'https://example.com/events', CONFIGURED_CALENDAR);

    await expect(frame.locator('article.event-card').first()).toBeVisible({ timeout: 20000 });
  });

  test('configured calendar is refused by any other origin', async ({ page }) => {
    const refused = page.waitForEvent('console', isFrameAncestorsViolation);

    await embedFrom(page, 'https://blog.example.com/events', CONFIGURED_CALENDAR);

    await refused;
  });

  test('unconfigured calendar is refused by an external origin', async ({ page }) => {
    const refused = page.waitForEvent('console', isFrameAncestorsViolation);

    await embedFrom(page, 'https://example.com/events', UNCONFIGURED_CALENDAR);

    await refused;
  });
});
