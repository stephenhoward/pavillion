import { test, expect } from '@playwright/test';
import { loginAsFreshUser } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Calendar Name Validation UX
 *
 * Verifies the calendar creation form displays correctly and shows
 * validation error messages in the UI. Pure validation rule logic
 * (regex matching) is covered by unit tests in:
 *   src/client/test/calendar-name-validation.test.ts
 *   src/server/calendar/test/calendar_service.test.ts
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Calendar Name Validation UX', () => {
  test.beforeAll(async () => {
    console.log('[Test] Starting test server...');
    try {
      env = await startTestServer();
      console.log(`[Test] Server started successfully at ${env.baseURL}`);
    }
    catch (error) {
      console.error('[Test] Failed to start server:', error);
      throw error;
    }
  });

  test.afterAll(async () => {
    console.log('[Test] Cleaning up test server...');
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAsFreshUser(page, env.baseURL);
  });

  test('should show calendar creation form on first visit', async ({ page }) => {
    await page.goto(env.baseURL + '/calendar');
    await page.waitForTimeout(2000);

    const hasCalendarForm = await page.locator('input#calendar-name').count() > 0;
    const hasCalendarList = await page.locator('nav[aria-label*="calendar" i]').count() > 0;

    expect(hasCalendarForm || hasCalendarList).toBeTruthy();
  });

  test('should show error message for invalid calendar name', async ({ page }) => {
    await page.goto(env.baseURL + '/calendar');
    await page.waitForTimeout(2000);

    const calendarInput = page.locator('input#calendar-name');
    await expect(calendarInput).toBeVisible();

    // Submit an invalid name (too short)
    await calendarInput.fill('ab');
    await calendarInput.blur();

    const submitButton = page.locator('button[type="submit"].primary');
    await submitButton.click();
    await page.waitForTimeout(1000);

    // Should show a descriptive validation error
    const errorMessage = page.locator('#calendar-error.alert--error');
    await expect(errorMessage).toBeVisible({ timeout: 3000 });

    const errorText = await errorMessage.textContent();
    expect(errorText).toBeTruthy();
    expect(errorText!.length).toBeGreaterThan(10);
  });
});
