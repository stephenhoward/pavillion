import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsFreshUser } from './helpers/auth';
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
      // Navigate to calendar page - fresh user should see creation form
      await page.goto(env.baseURL + '/calendar');
      await page.waitForTimeout(2000);

      // Verify creation form is visible
      const titleInput = page.locator('input#calendar-title');
      const nameInput = page.locator('input#calendar-name');
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
      const submitButton = page.locator('button[type="submit"].primary');
      await submitButton.click();

      // Wait for navigation to the new calendar page
      await page.waitForURL('**/calendar/my-test-calendar', { timeout: 10000 });

      // Verify we landed on the new calendar's page
      const currentUrl = page.url();
      expect(currentUrl).toContain('/calendar/my-test-calendar');
    });

    test('should create a calendar with a custom name', async ({ page }) => {
      // Navigate to create new calendar
      await page.goto(env.baseURL + '/calendar/new');
      await page.waitForTimeout(2000);

      const titleInput = page.locator('input#calendar-title');
      const nameInput = page.locator('input#calendar-name');
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
      const submitButton = page.locator('button[type="submit"].primary');
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
      // Admin has one calendar (test_calendar) and auto-redirects to it
      await page.goto(env.baseURL + '/calendar');
      await page.waitForTimeout(2000);

      // Navigate to manage page
      await page.goto(env.baseURL + '/calendar/test_calendar/manage');
      await page.waitForTimeout(2000);

      // Click the Settings tab (only visible to owner)
      const settingsTab = page.locator('button[role="tab"]#settings-tab');
      await expect(settingsTab).toBeVisible({ timeout: 5000 });
      await settingsTab.click();

      // Wait for settings panel to load
      await page.waitForTimeout(1000);

      // Find the title input within the settings panel
      const titleInput = page.locator('#settings-panel input#calendarTitle');
      await expect(titleInput).toBeVisible({ timeout: 5000 });

      // Clear and type a new title
      const newTitle = `Updated Title ${Date.now()}`;
      await titleInput.clear();
      await titleInput.fill(newTitle);

      // Trigger auto-save by blurring
      await titleInput.blur();

      // Wait for success message
      const successAlert = page.locator('#settings-panel .alert--success');
      await expect(successAlert).toBeVisible({ timeout: 5000 });

      // Verify the input still holds the new value
      await expect(titleInput).toHaveValue(newTitle);
    });

    test('should edit calendar description with auto-save on blur', async ({ page }) => {
      // Navigate to manage page
      await page.goto(env.baseURL + '/calendar/test_calendar/manage');
      await page.waitForTimeout(2000);

      // Click the Settings tab
      const settingsTab = page.locator('button[role="tab"]#settings-tab');
      await expect(settingsTab).toBeVisible({ timeout: 5000 });
      await settingsTab.click();

      // Wait for settings panel to load
      await page.waitForTimeout(1000);

      // Find the description textarea
      const descriptionTextarea = page.locator('#settings-panel textarea#calendarDescription');
      await expect(descriptionTextarea).toBeVisible({ timeout: 5000 });

      // Clear and type a new description
      const newDescription = `A wonderful calendar for community events. Updated at ${Date.now()}.`;
      await descriptionTextarea.clear();
      await descriptionTextarea.fill(newDescription);

      // Trigger auto-save by blurring
      await descriptionTextarea.blur();

      // Wait for success message
      const successAlert = page.locator('#settings-panel .alert--success');
      await expect(successAlert).toBeVisible({ timeout: 5000 });

      // Verify the textarea still holds the new value
      await expect(descriptionTextarea).toHaveValue(newDescription);
    });

    test('should persist edited title after page reload', async ({ page }) => {
      // Navigate to manage page
      await page.goto(env.baseURL + '/calendar/test_calendar/manage');
      await page.waitForTimeout(2000);

      // Click the Settings tab
      const settingsTab = page.locator('button[role="tab"]#settings-tab');
      await expect(settingsTab).toBeVisible({ timeout: 5000 });
      await settingsTab.click();
      await page.waitForTimeout(1000);

      // Update the title
      const titleInput = page.locator('#settings-panel input#calendarTitle');
      await expect(titleInput).toBeVisible({ timeout: 5000 });

      const persistedTitle = `Persisted Title ${Date.now()}`;
      await titleInput.clear();
      await titleInput.fill(persistedTitle);
      await titleInput.blur();

      // Wait for save to complete
      const successAlert = page.locator('#settings-panel .alert--success');
      await expect(successAlert).toBeVisible({ timeout: 5000 });

      // Reload the page
      await page.reload();
      await page.waitForTimeout(2000);

      // Navigate back to Settings tab
      const settingsTabAfterReload = page.locator('button[role="tab"]#settings-tab');
      await expect(settingsTabAfterReload).toBeVisible({ timeout: 5000 });
      await settingsTabAfterReload.click();
      await page.waitForTimeout(1000);

      // Verify the title persisted
      const titleInputAfterReload = page.locator('#settings-panel input#calendarTitle');
      await expect(titleInputAfterReload).toBeVisible({ timeout: 5000 });
      await expect(titleInputAfterReload).toHaveValue(persistedTitle);
    });
  });
});
