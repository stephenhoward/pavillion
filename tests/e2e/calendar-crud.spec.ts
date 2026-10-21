import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsFreshUser } from './helpers/auth';
import { calendarLeaf, gotoSettings } from './helpers/settings-nav';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Calendar CRUD Workflow
 *
 * Tests the complete calendar management lifecycle:
 * - Create a new calendar with name and title
 * - Edit calendar title (auto-save on blur)
 * - Edit calendar description (auto-save on blur)
 *
 * Uses isolated test server with in-memory database for true test isolation.
 * Tests run serially within this file to share the same test server instance.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Calendar CRUD Workflow', () => {
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

  test.describe('Calendar Creation', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsFreshUser(page, env.baseURL);
    });

    test('should create a new calendar with name and title', async ({ page }) => {
      // A fresh user lands on the empty state; its button opens the create sheet
      await page.goto(env.baseURL + '/calendar');
      await page.getByRole('button', { name: 'Create Your Calendar' }).click();

      const sheet = page.getByRole('dialog', { name: 'Create New Calendar' });
      const titleInput = sheet.locator('input#calendar-title');
      const nameInput = sheet.locator('input#calendar-name');
      await expect(titleInput).toBeVisible({ timeout: 5000 });
      await expect(nameInput).toBeVisible({ timeout: 5000 });

      // Fill in calendar title
      const calendarTitle = 'My Test Calendar';
      await titleInput.fill(calendarTitle);

      // Wait for auto-slug to populate the name field
      await page.waitForTimeout(500);

      // Verify that the name field was auto-populated from the title
      const autoSlug = await nameInput.inputValue();
      expect(autoSlug).toBe('my-test-calendar');

      // Submit the form
      const submitButton = sheet.locator('button[type="submit"].btn--cta');
      await submitButton.click();

      // Wait for navigation to the new calendar page
      await page.waitForURL('**/calendar/my-test-calendar', { timeout: 10000 });

      // Verify we landed on the new calendar's page
      const currentUrl = page.url();
      expect(currentUrl).toContain('/calendar/my-test-calendar');
    });

    test('should create a calendar with a custom name', async ({ page }) => {
      // The user now owns the calendar created above, so a second one is
      // created from the calendar switcher's sheet
      await page.getByRole('button', { name: /Switch calendar/ }).click();
      await page.getByRole('button', { name: 'Create a new calendar' }).click();

      const sheet = page.getByRole('dialog', { name: 'Create New Calendar' });
      const titleInput = sheet.locator('input#calendar-title');
      const nameInput = sheet.locator('input#calendar-name');
      await expect(titleInput).toBeVisible({ timeout: 5000 });
      await expect(nameInput).toBeVisible({ timeout: 5000 });

      // Fill in title first
      const calendarTitle = 'Another Calendar';
      await titleInput.fill(calendarTitle);
      await page.waitForTimeout(300);

      // Override the auto-generated name with a custom one
      await nameInput.clear();
      await nameInput.fill('custom_name_cal');

      // Submit the form
      const submitButton = sheet.locator('button[type="submit"].btn--cta');
      await submitButton.click();

      // Wait for navigation to the new calendar
      await page.waitForURL('**/calendar/custom_name_cal', { timeout: 10000 });

      const currentUrl = page.url();
      expect(currentUrl).toContain('/calendar/custom_name_cal');
    });
  });

  test.describe('Calendar Settings', () => {
    test.beforeEach(async ({ page }) => {
      // Admin user has test_calendar and is the owner
      await loginAsAdmin(page, env.baseURL);
    });

    test('should edit calendar title with auto-save on blur', async ({ page }) => {
      // Open the calendar's General page (owner only)
      await gotoSettings(page, env.baseURL, calendarLeaf('test_calendar', 'general'));

      // Find the title input on the page
      const titleInput = page.getByRole('main').locator('input[id^="calendarTitle"]');
      await expect(titleInput).toBeVisible({ timeout: 5000 });

      // Clear and type a new title
      const newTitle = `Updated Title ${Date.now()}`;
      await titleInput.clear();
      await titleInput.fill(newTitle);

      // Trigger auto-save by blurring
      await titleInput.blur();

      // Wait for success message
      const successAlert = page.getByRole('main').locator('.alert--success');
      await expect(successAlert).toBeVisible({ timeout: 5000 });

      // Verify the input still holds the new value
      await expect(titleInput).toHaveValue(newTitle);
    });

    test('should edit calendar description with auto-save on blur', async ({ page }) => {
      // Open the calendar's General page
      await gotoSettings(page, env.baseURL, calendarLeaf('test_calendar', 'general'));

      // Find the description textarea
      const descriptionTextarea = page.getByRole('main').locator('textarea[id^="calendarDescription"]');
      await expect(descriptionTextarea).toBeVisible({ timeout: 5000 });

      // Clear and type a new description
      const newDescription = `A wonderful calendar for community events. Updated at ${Date.now()}.`;
      await descriptionTextarea.clear();
      await descriptionTextarea.fill(newDescription);

      // Trigger auto-save by blurring
      await descriptionTextarea.blur();

      // Wait for success message
      const successAlert = page.getByRole('main').locator('.alert--success');
      await expect(successAlert).toBeVisible({ timeout: 5000 });

      // Verify the textarea still holds the new value
      await expect(descriptionTextarea).toHaveValue(newDescription);
    });

    test('should persist edited title after page reload', async ({ page }) => {
      // Open the calendar's General page
      const general = calendarLeaf('test_calendar', 'general');
      await gotoSettings(page, env.baseURL, general);

      // Update the title
      const titleInput = page.getByRole('main').locator('input[id^="calendarTitle"]');
      await expect(titleInput).toBeVisible({ timeout: 5000 });

      const persistedTitle = `Persisted Title ${Date.now()}`;
      await titleInput.clear();
      await titleInput.fill(persistedTitle);
      await titleInput.blur();

      // Wait for save to complete
      const successAlert = page.getByRole('main').locator('.alert--success');
      await expect(successAlert).toBeVisible({ timeout: 5000 });

      // Reload the page; the URL is still the General page
      await page.reload();
      await expect(page).toHaveURL(env.baseURL + general.path);

      // Verify the title persisted
      const titleInputAfterReload = page.getByRole('main').locator('input[id^="calendarTitle"]');
      await expect(titleInputAfterReload).toBeVisible({ timeout: 5000 });
      await expect(titleInputAfterReload).toHaveValue(persistedTitle);
    });
  });
});
