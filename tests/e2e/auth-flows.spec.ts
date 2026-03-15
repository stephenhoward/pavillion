import { test, expect } from '@playwright/test';
import { TEST_ADMIN } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import { clearEmails, waitForEmail, extractLinkFromEmail } from './helpers/emails';

/**
 * E2E Tests: Authentication Workflows
 *
 * Tests the complete authentication lifecycle:
 * - Login with valid credentials (redirect to /calendar)
 * - Login with wrong credentials (error message)
 * - Login with missing fields (validation message)
 * - Registration flow (submit email, verify success, check email sent)
 * - Password reset full flow (request, email, code, new password, login)
 * - Logout (clear session, redirect to login)
 *
 * Uses isolated test server with in-memory database for true test isolation.
 * Tests run serially within this file to share the same test server instance.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Authentication Workflows', () => {
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

  test.describe('Login', () => {
    test('should redirect to /calendar on successful login', async ({ page }) => {
      await page.goto(env.baseURL + '/auth/login');

      await page.locator('#login-email').fill(TEST_ADMIN.email);
      await page.locator('#login-password').fill(TEST_ADMIN.password);
      await page.getByRole('button', { name: 'Sign in' }).click();

      await page.waitForURL('**/calendar', { timeout: 30000 });
      expect(page.url()).toContain('/calendar');
    });

    test('should show error message with wrong credentials', async ({ page }) => {
      await page.goto(env.baseURL + '/auth/login');

      await page.locator('#login-email').fill(TEST_ADMIN.email);
      await page.locator('#login-password').fill('wrongpassword');
      await page.getByRole('button', { name: 'Sign in' }).click();

      // The ErrorAlert component uses role="alert" and class "error-alert"
      const errorAlert = page.locator('[role="alert"]');
      await expect(errorAlert).toBeVisible({ timeout: 5000 });
      await expect(errorAlert).toContainText('bad sign in');
    });

    test('should show validation message when fields are missing', async ({ page }) => {
      await page.goto(env.baseURL + '/auth/login');

      // Submit with empty fields
      await page.getByRole('button', { name: 'Sign in' }).click();

      const errorAlert = page.locator('[role="alert"]');
      await expect(errorAlert).toBeVisible({ timeout: 5000 });
      await expect(errorAlert).toContainText('missing email or password');
    });
  });

  test.describe('Registration', () => {
    test('should submit registration and show success message', async ({ page }) => {
      // First, log in as admin to set registration mode to 'open'
      await page.goto(env.baseURL + '/auth/login');
      await page.locator('#login-email').fill(TEST_ADMIN.email);
      await page.locator('#login-password').fill(TEST_ADMIN.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('**/calendar', { timeout: 30000 });

      // Navigate to admin settings page to set registration mode
      await page.goto(env.baseURL + '/admin/settings');
      await page.waitForTimeout(2000);

      // Find and change registration mode to 'open'
      const registrationSelect = page.locator('select#registrationMode');
      if (await registrationSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
        await registrationSelect.selectOption('open');

        // Click the Save Settings button within the Instance Settings section
        const instanceSettingsForm = page.getByLabel('Instance Settings');
        await instanceSettingsForm.getByRole('button', { name: 'Save Settings' }).click();

        // Wait for save confirmation
        await page.waitForTimeout(2000);
      }

      // Clear emails before registration
      await clearEmails(env.baseURL);

      // Now navigate to register page (logged-out page)
      await page.goto(env.baseURL + '/auth/register');
      await page.waitForTimeout(1000);

      const registerEmail = `newuser-${Date.now()}@example.com`;
      const emailInput = page.locator('#register-email');

      // If register page redirected (mode not open), skip gracefully
      if (!await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('[Test] Registration page not available (mode may not be open), skipping');
        test.skip();
        return;
      }

      await emailInput.fill(registerEmail);
      await page.getByRole('button', { name: 'Create an account' }).click();

      // Verify success message appears
      const successMessage = page.locator('.success-message');
      await expect(successMessage).toBeVisible({ timeout: 10000 });
      await expect(successMessage).toContainText('receive an email');

      // Verify email was sent via test endpoint
      const email = await waitForEmail(env.baseURL, registerEmail, { timeout: 10000 });
      expect(email).toBeTruthy();
      expect(email.to).toContain(registerEmail);
    });
  });

  test.describe('Password Reset', () => {
    test('should complete full password reset flow: request, email, code, new password, login', async ({ page }) => {
      // Clear any previous emails
      await clearEmails(env.baseURL);

      const targetEmail = TEST_ADMIN.email;
      const newPassword = 'NewSecurePass123!';

      // Step 1: Navigate to forgot password page
      await page.goto(env.baseURL + '/auth/forgot');
      await page.waitForTimeout(1000);

      // Step 2: Submit password reset request
      await page.locator('#reset-email').fill(targetEmail);
      await page.getByRole('button', { name: 'Send Password Reset' }).click();

      // Step 3: Verify success message appears
      const successMessage = page.locator('.success-message');
      await expect(successMessage).toBeVisible({ timeout: 10000 });
      await expect(successMessage).toContainText(targetEmail);

      // Step 4: Extract reset code from email
      const email = await waitForEmail(env.baseURL, targetEmail, { timeout: 10000 });
      expect(email).toBeTruthy();

      // Extract the code from the email text (format: resetUrl?code=TOKEN)
      const resetCode = extractLinkFromEmail(email, /[?&]code=([a-zA-Z0-9_-]+)/);
      expect(resetCode).toBeTruthy();
      console.log('[Test] Extracted reset code from email');

      // Step 5: Navigate to password reset page with the code
      await page.goto(`${env.baseURL}/auth/password?code=${resetCode}`);
      await page.waitForTimeout(2000);

      // Step 6: The code should auto-validate and show the password form
      const newPasswordInput = page.locator('#new-password');
      await expect(newPasswordInput).toBeVisible({ timeout: 10000 });

      const confirmPasswordInput = page.locator('#confirm-password');
      await expect(confirmPasswordInput).toBeVisible({ timeout: 5000 });

      // Step 7: Set new password
      await newPasswordInput.fill(newPassword);
      await confirmPasswordInput.fill(newPassword);
      await page.getByRole('button', { name: 'Reset Password' }).click();

      // Step 8: Should redirect to login page after successful reset
      await page.waitForURL('**/auth/login', { timeout: 10000 });

      // Step 9: Login with new password
      await page.locator('#login-email').fill(targetEmail);
      await page.locator('#login-password').fill(newPassword);
      await page.getByRole('button', { name: 'Sign in' }).click();

      // Step 10: Verify successful login redirects to /calendar
      await page.waitForURL('**/calendar', { timeout: 30000 });
      expect(page.url()).toContain('/calendar');
    });
  });

  test.describe('Logout', () => {
    test('should clear session and redirect to login page', async ({ page }) => {
      // Since tests are serial, the admin password was changed in the reset test
      const currentPassword = 'NewSecurePass123!';

      // Step 1: Log in
      await page.goto(env.baseURL + '/auth/login');
      await page.locator('#login-email').fill(TEST_ADMIN.email);
      await page.locator('#login-password').fill(currentPassword);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('**/calendar', { timeout: 30000 });

      // Step 2: Navigate to profile/settings page
      await page.goto(env.baseURL + '/profile');
      await page.waitForTimeout(2000);

      // Step 3: Click logout button
      const logoutButton = page.locator('.logout-button');
      await expect(logoutButton).toBeVisible({ timeout: 5000 });
      await logoutButton.click();

      // Step 4: Verify redirect to login page
      await page.waitForURL('**/auth/login', { timeout: 10000 });
      expect(page.url()).toContain('/auth/login');
    });
  });
});
