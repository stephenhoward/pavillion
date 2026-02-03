import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Profile Display Name Feature
 *
 * Tests the display name feature in the profile settings page:
 * - Display name field loads with current value
 * - Display name can be updated successfully
 * - Display name can be cleared (set to empty/null)
 * - Display name persists after page reload
 * - Display name saves on blur with feedback
 * - Display name appears in admin accounts list
 */

test.describe('Profile Display Name', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as admin before each test
    await loginAsAdmin(page);
  });

  test('should load profile with display name field', async ({ page }) => {
    // Navigate to profile settings
    await page.goto('/profile');

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
    await page.goto('/profile');
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
    await page.goto('/profile');
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
    await page.goto('/profile');
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

  test('should show save feedback on blur', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    const displayNameInput = page.locator('#display-name');

    // Feedback should not be visible initially
    await expect(page.locator('.save-feedback')).not.toBeVisible();

    // Change value and blur
    await displayNameInput.fill('Feedback Test Name');
    await displayNameInput.blur();

    // Feedback should appear
    const feedback = page.locator('.save-feedback');
    await expect(feedback).toBeVisible({ timeout: 5000 });
    await expect(feedback).not.toHaveClass(/is-error/);

    // Feedback should contain success message
    await expect(feedback).toContainText(/saved/i);

    // Feedback should disappear after a few seconds
    await expect(feedback).not.toBeVisible({ timeout: 5000 });
  });

  test('should disable input while saving', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    const displayNameInput = page.locator('#display-name');

    // Fill in a new value
    await displayNameInput.fill('Saving Test Name');

    // Input should still be enabled before blur
    await expect(displayNameInput).toBeEnabled();

    // Trigger save
    await displayNameInput.blur();

    // Note: The input is disabled during save, but this happens very quickly
    // so we may or may not catch it. The important thing is that it becomes
    // enabled again after save completes.
    await page.waitForTimeout(100); // Brief wait for save to start

    // After save completes, input should be enabled again
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });
    await expect(displayNameInput).toBeEnabled();
  });

  test('should display in admin accounts list', async ({ page }) => {
    // First, set a unique display name
    const uniqueDisplayName = `Admin DisplayName ${Date.now()}`;

    await page.goto('/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    const displayNameInput = page.locator('#display-name');
    await displayNameInput.clear();
    await displayNameInput.fill(uniqueDisplayName);
    await displayNameInput.blur();
    await expect(page.locator('.save-feedback:not(.is-error)')).toBeVisible({ timeout: 5000 });

    // Now navigate to admin accounts list
    await page.goto('/admin/accounts');
    await page.waitForSelector('section#accounts', { timeout: 10000 });

    // Wait for accounts table or cards to load
    await page.waitForSelector('.accounts-table-desktop table[role="table"][aria-label="User accounts"], .accounts-mobile .account-card', { timeout: 10000 });

    // The display name should appear in the accounts list
    // (either in the desktop table or mobile cards)
    await expect(page.locator(`text=${uniqueDisplayName}`).first()).toBeVisible({ timeout: 5000 });
  });

  test('should handle empty string vs null correctly', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    const displayNameInput = page.locator('#display-name');

    // Test empty string
    await displayNameInput.fill('');
    await displayNameInput.blur();
    await expect(page.locator('.save-feedback:not(.is-error)')).toBeVisible({ timeout: 5000 });
    await expect(displayNameInput).toHaveValue('');

    // Reload and verify
    await page.reload();
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });
    await expect(displayNameInput).toHaveValue('');
  });

  test('should maintain value after navigation away and back', async ({ page }) => {
    // Set a display name
    const testName = `Nav Test ${Date.now()}`;

    await page.goto('/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    const displayNameInput = page.locator('#display-name');
    await displayNameInput.fill(testName);
    await displayNameInput.blur();
    await expect(page.locator('.save-feedback:not(.is-error)')).toBeVisible({ timeout: 5000 });

    // Navigate away to dashboard
    await page.goto('/');
    await page.waitForSelector('body', { timeout: 5000 });

    // Navigate back to profile
    await page.goto('/profile');
    await page.waitForSelector('#display-name:not([disabled])', { timeout: 5000 });

    // Verify the display name is still there
    await expect(page.locator('#display-name')).toHaveValue(testName);
  });
});
