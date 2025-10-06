import { Page } from '@playwright/test';

/**
 * Test credentials for admin user
 * These should match the seeded test data in the development database
 */
export const TEST_ADMIN = {
  email: 'admin@pavillion.dev',
  password: 'admin',
};

/**
 * Log in as admin user
 * Navigates to login page and performs login
 */
export async function loginAsAdmin(page: Page) {
  await page.goto('/auth/login');

  // Fill in login form using accessible name selectors
  await page.getByRole('textbox', { name: 'email' }).fill(TEST_ADMIN.email);
  await page.getByRole('textbox', { name: 'password' }).fill(TEST_ADMIN.password);

  // Click login button
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for navigation to complete
  await page.waitForURL('**/calendar', { timeout: 10000 });
}
