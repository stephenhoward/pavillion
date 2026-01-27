import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Settings Page Modals
 *
 * Tests the settings page modal functionality to ensure:
 * - Modals open and close correctly
 * - Modals have proper styling (solid backgrounds, correct width)
 * - Change Email modal validates and submits
 * - Change Password modal sends reset link
 * - Modals use the shared dialog component
 * - Focus management works correctly
 */

test.describe.configure({ mode: 'serial' });

test.describe('Settings Page Modals', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as admin and navigate to settings
    await loginAsAdmin(page);
    await page.goto('/profile');

    // Wait for settings page to load
    await page.waitForSelector('h1:has-text("Settings")', { timeout: 5000 });
  });

  test.describe('Change Email Modal', () => {
    test('should open modal with correct styling and focus', async ({ page }) => {
      // Click Change Email button
      await page.getByRole('button', { name: 'Change Email' }).click();

      // Wait for modal to appear
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible({ timeout: 3000 });

      // Verify modal title
      await expect(modal.getByRole('heading', { name: /change.*email/i })).toBeVisible();

      // Verify modal has proper width (not too wide)
      // Check the max-width CSS property instead of bounding box
      const modalBox = modal.locator('> div');
      const maxWidth = await modalBox.evaluate(el => window.getComputedStyle(el).maxWidth);
      // Should be 28rem = 448px
      expect(maxWidth).toBe('448px');

      // Verify first input receives focus
      const emailInput = modal.getByRole('textbox', { name: /new email/i });
      await expect(emailInput).toBeFocused();

      // Verify current email is displayed
      await expect(modal.getByText(/admin@pavillion\.dev/i)).toBeVisible();
    });

    test('should validate email input and enable submit button', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: 'Change Email' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');

      // Submit button should be disabled initially
      const submitButton = modal.getByRole('button', { name: /change email/i });
      await expect(submitButton).toBeDisabled();

      // Fill in invalid email (no @)
      await modal.getByRole('textbox', { name: /new email/i }).fill('invalidemail');
      await modal.getByRole('textbox', { name: /password/i }).fill('test123');

      // Submit should still be disabled
      await expect(submitButton).toBeDisabled();

      // Fill in valid email
      await modal.getByRole('textbox', { name: /new email/i }).fill('newemail@example.com');

      // Submit should now be enabled
      await expect(submitButton).toBeEnabled();
    });

    test('should close modal with Cancel button', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: 'Change Email' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible();

      // Click Cancel button
      await modal.getByRole('button', { name: /cancel/i }).click();

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should close modal with close button', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: 'Change Email' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible();

      // Click close (×) button
      await modal.getByRole('button', { name: /close dialog/i }).click();

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should close modal with Escape key', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: 'Change Email' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible();

      // Press Escape key
      await page.keyboard.press('Escape');

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should attempt to change email with valid input', async ({ page }) => {
      // Intercept the change email API request to prevent actually changing the email
      // This ensures the test doesn't break subsequent tests that need to login as admin
      await page.route('**/api/auth/v1/email', route => {
        // Respond with error to prevent email change but still verify the request was made
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Test mode - email not changed' }),
        });
      });

      // Open modal
      await page.getByRole('button', { name: 'Change Email' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');

      // Fill in form with valid data
      await modal.getByRole('textbox', { name: /new email/i }).fill('newemail@example.com');
      await modal.getByRole('textbox', { name: /password/i }).fill('admin');

      // Wait for button to be enabled
      const submitButton = modal.getByRole('button', { name: /change email/i });
      await expect(submitButton).toBeEnabled({ timeout: 3000 });

      // Submit form by clicking the submit button
      // Wait for the API request to be initiated
      const [request] = await Promise.all([
        page.waitForRequest(req => req.url().includes('/api/auth/v1/email') && req.method() === 'POST', { timeout: 5000 }),
        submitButton.click(),
      ]);

      // Verify the request was made with correct data
      expect(request).toBeTruthy();
      const postData = request.postDataJSON();
      expect(postData.email).toBe('newemail@example.com');
      expect(postData.password).toBe('admin');

      // Modal should still be visible because the API returned an error
      await expect(modal).toBeVisible();
    });
  });

  test.describe('Change Password Modal', () => {
    test('should open modal with correct styling and focus', async ({ page }) => {
      // Click Change Password button
      await page.getByRole('button', { name: 'Change Password' }).click();

      // Wait for modal to appear
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible({ timeout: 3000 });

      // Verify modal title
      await expect(modal.getByRole('heading', { name: /change.*password/i })).toBeVisible();

      // Verify modal has proper width (not too wide)
      // Check the max-width CSS property instead of bounding box
      const modalBox = modal.locator('> div');
      const maxWidth = await modalBox.evaluate(el => window.getComputedStyle(el).maxWidth);
      // Should be 28rem = 448px
      expect(maxWidth).toBe('448px');

      // Verify send button receives focus
      const sendButton = modal.getByRole('button', { name: /send password link/i });
      await expect(sendButton).toBeFocused();

      // Verify info box is visible
      await expect(modal.getByText(/password reset via email/i)).toBeVisible();
      await expect(modal.getByText(/admin@pavillion\.dev/i)).toBeVisible();
    });

    test('should display sky blue info box with email icon', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: 'Change Password' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible();

      // Verify info box content
      const infoBox = modal.locator('.info-box');
      await expect(infoBox).toBeVisible();

      // Verify icon is present (SVG mail icon)
      const mailIcon = infoBox.locator('.icon-mail');
      await expect(mailIcon).toBeVisible();

      // Verify text content
      await expect(infoBox.getByText(/password reset via email/i)).toBeVisible();
      await expect(infoBox.getByText(/send a link to/i)).toBeVisible();
    });

    test('should close modal with Cancel button', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: 'Change Password' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible();

      // Click Cancel button
      await modal.getByRole('button', { name: /cancel/i }).click();

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should close modal with close button', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: 'Change Password' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible();

      // Click close (×) button
      await modal.getByRole('button', { name: /close dialog/i }).click();

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should close modal with Escape key', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: 'Change Password' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible();

      // Press Escape key
      await page.keyboard.press('Escape');

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should send password reset link', async ({ page }) => {
      // Track network requests
      const resetRequests: string[] = [];
      page.on('request', request => {
        if (request.url().includes('/api/') && request.method() === 'POST') {
          resetRequests.push(request.url());
        }
      });

      // Open modal
      await page.getByRole('button', { name: 'Change Password' }).click();
      const modal = page.locator('dialog[aria-modal="true"]');

      // Click Send Password Link button
      await modal.getByRole('button', { name: /send password link/i }).click();

      // Wait for response
      await page.waitForTimeout(1000);

      // Should have made an API call
      expect(resetRequests.length).toBeGreaterThan(0);

      // Modal should close on success
      await expect(modal).not.toBeVisible({ timeout: 2000 });
    });
  });

  test.describe('Multiple Modals', () => {
    test('should not allow opening both modals simultaneously', async ({ page }) => {
      // Open Change Email modal
      await page.getByRole('button', { name: 'Change Email' }).click();
      const emailModal = page.locator('dialog[aria-modal="true"]').filter({ hasText: /change.*email/i });
      await expect(emailModal).toBeVisible();

      // Close it
      await page.keyboard.press('Escape');
      await expect(emailModal).not.toBeVisible();

      // Open Change Password modal
      await page.getByRole('button', { name: 'Change Password' }).click();
      const passwordModal = page.locator('dialog[aria-modal="true"]').filter({ hasText: /change.*password/i });
      await expect(passwordModal).toBeVisible();

      // Verify only one dialog is open
      const openDialogs = page.locator('dialog[aria-modal="true"][open]');
      await expect(openDialogs).toHaveCount(1);
    });
  });
});
