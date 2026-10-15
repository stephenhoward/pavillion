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

  test('should open the calendar creation form from the empty state on first visit', async ({ page }) => {
    await page.goto(env.baseURL + '/calendar');
    await page.getByRole('button', { name: 'Create Your Calendar' }).click();

    const sheet = page.getByRole('dialog', { name: 'Create New Calendar' });
    await expect(sheet.locator('input#calendar-name')).toBeVisible();
  });

  test('should show error message for invalid calendar name', async ({ page }) => {
    await page.goto(env.baseURL + '/calendar');
    await page.getByRole('button', { name: 'Create Your Calendar' }).click();

    const sheet = page.getByRole('dialog', { name: 'Create New Calendar' });
    const calendarInput = sheet.locator('input#calendar-name');
    await expect(calendarInput).toBeVisible();

    // Submit an invalid name (too short)
    await calendarInput.fill('ab');
    await calendarInput.blur();

    const submitButton = sheet.locator('button[type="submit"].btn--cta');
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
