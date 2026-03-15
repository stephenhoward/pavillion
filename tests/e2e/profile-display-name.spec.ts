import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Profile Display Name Feature
 *
 * Tests the core display name workflow in profile settings:
 * - Display name field loads with current value
 * - Display name can be updated successfully
 * - Display name persists after page reload
 * - Display name can be cleared (set to empty/null)
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 * These tests run serially because they all modify the same admin
 * account's display name and would cause state pollution if run
 * in parallel.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Profile Display Name', () => {
  test.beforeAll(async () => {
    // Start isolated test server for this test file
    env = await startTestServer();
  });

  test.afterAll(async () => {
    // Clean up test server
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    // Log in as admin before each test
    await loginAsAdmin(page, env.baseURL);
  });

  test('should load profile with display name field', async ({ page }) => {
    // Navigate to profile settings
    await page.goto(env.baseURL + '/profile');

    // Wait for settings page to load
    await page.waitForSelector('h1:has-text("Settings")', { timeout: 5000 });

    // Wait for profile section to load (loading state should complete)
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    // Display name input should be visible
    const displayNameInput = page.locator('#display-name');
    await expect(displayNameInput).toBeVisible();
    await expect(displayNameInput).toBeEnabled();

    // Label should be present
    await expect(page.locator('label[for="display-name"]')).toBeVisible();
  });

  test('should update display name successfully', async ({ page }) => {
    // Navigate to profile settings
    await page.goto(env.baseURL + '/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    // Get the display name input
    const displayNameInput = page.locator('#display-name');

    // Clear existing value and type new display name
    await displayNameInput.clear();
    await displayNameInput.fill('Test Admin User');

    // Trigger blur event to save
    await displayNameInput.blur();

    // Wait for save feedback message
    await expect(page.locator('.save-feedback:not(.is-error)')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.save-feedback')).toContainText(/saved/i);

    // Verify the value persists in the input
    await expect(displayNameInput).toHaveValue('Test Admin User');
  });

  test('should persist display name after page reload', async ({ page }) => {
    // Navigate to profile settings
    await page.goto(env.baseURL + '/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    // Set a unique display name
    const uniqueName = `Test User ${Date.now()}`;
    const displayNameInput = page.locator('#display-name');

    await displayNameInput.clear();
    await displayNameInput.fill(uniqueName);
    await displayNameInput.blur();

    // Wait for save confirmation
    await expect(page.locator('.save-feedback:not(.is-error)')).toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    // Verify the display name persisted
    await expect(page.locator('#display-name')).toHaveValue(uniqueName);
  });

  test('should allow clearing display name', async ({ page }) => {
    // First set a display name
    await page.goto(env.baseURL + '/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    const displayNameInput = page.locator('#display-name');
    await displayNameInput.fill('Name To Clear');
    await displayNameInput.blur();
    await expect(page.locator('.save-feedback:not(.is-error)')).toBeVisible({ timeout: 5000 });

    // Wait for feedback to disappear
    await page.waitForTimeout(1000);

    // Now clear it
    await displayNameInput.clear();
    await displayNameInput.blur();

    // Wait for save feedback
    await expect(page.locator('.save-feedback:not(.is-error)')).toBeVisible({ timeout: 5000 });

    // Verify it's empty
    await expect(displayNameInput).toHaveValue('');

    // Reload and verify it stayed empty
    await page.reload();
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });
    await expect(page.locator('#display-name')).toHaveValue('');
  });
});
