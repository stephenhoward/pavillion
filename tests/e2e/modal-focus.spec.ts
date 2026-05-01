import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Test: Modal Focus Trap & Return Focus (WCAG 2.1.2 / ARIA APGR 3.8)
 *
 * This is a platform-invariant regression guard for the focus trap and
 * return-focus behavior implemented in `useDialog`. The unit tests in
 * `src/client/test/composables/useDialog.test.ts` cover the composable's
 * branching logic, but only an end-to-end Chromium dialog can verify that
 * the live `keydown` listener registration and `showModal` integration
 * still work together.
 *
 * Justification (criterion-3, "Previously-Broken Code Path"): the original
 * bug was a Playwright finding on `SessionExpiredModal`. If `handleKeydown`
 * is ever silently dropped from the listener registration in `useDialog`,
 * only an e2e test in a real browser will catch it.
 *
 * Scope: ONE test. The unit tests cover variation cases (empty list,
 * disabled filter, etc.). Adding more here dilutes the regression-guard
 * purpose.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Modal Focus Trap & Return Focus', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    await page.goto(env.baseURL + '/profile');
    await page.waitForSelector('h1:has-text("Settings")', { timeout: 5000 });
  });

  test('keyboard focus stays trapped inside modal and returns to trigger on close', async ({ page }) => {
    // Focus the trigger so we can later assert return-focus restoration.
    const trigger = page.getByRole('button', { name: 'Change Email' });
    await trigger.focus();
    await expect(trigger).toBeFocused();

    // Open the modal.
    await trigger.click();
    const modal = page.locator('dialog[aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Tab through every focusable element ~10 times, comfortably exceeding
    // the count of focusable elements in any current modal so the focus
    // cycles back to the start at least once. After each Tab, focus must
    // never escape to document.body.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const isOnBody = await page.evaluate(() => document.activeElement === document.body);
      expect(isOnBody, `Tab #${i + 1} let focus escape to document.body`).toBe(false);
    }

    // Close via Escape and assert return-focus restored to the trigger.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
