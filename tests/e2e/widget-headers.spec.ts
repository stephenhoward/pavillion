import { test, expect } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';

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
