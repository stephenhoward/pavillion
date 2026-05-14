import { test, expect } from '@playwright/test';
import { startTestServer, TestEnvironment } from '../helpers/test-server';
import { pageScreenReader } from '../helpers/screen-reader';

/**
 * Smoke test for the Playwright variant of the screen-reader helper.
 *
 * Scope: confirms `pageScreenReader(page)` can attach to a live page,
 * walk it, and return a non-empty last-spoken phrase. This is the Phase 1
 * deliverable from the screen-reader testing design — it verifies the
 * helper itself works. The Phase 2 test corpus (announcement contracts
 * for specific flows) is a separate epic.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Screen Reader Helper (Playwright variant)', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('attaches to a live page and reports a non-empty last spoken phrase', async ({ page }) => {
    // Attach the helper before navigating so `addInitScript` is in place
    // for the page's first load and no internal reload is needed. Login
    // route is anonymous-accessible and has stable accessible primitives
    // (heading, email/password fields, submit button), making it a
    // low-risk smoke target.
    const sr = await pageScreenReader(page);
    try {
      await page.goto(env.baseURL + '/auth/login');
      await sr.next();
      const phrase = await sr.lastPhrase();
      expect(typeof phrase).toBe('string');
      expect(phrase.length).toBeGreaterThan(0);
    }
    finally {
      await sr.stop();
    }
  });
});
