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
 * Test credentials for fresh user (no calendars)
 * This user has no calendars and is used for calendar creation tests
 */
export const TEST_FRESH_USER = {
  email: 'fresh@example.com',
  password: 'test',
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

  // Wait for navigation to complete (longer timeout for server startup)
  await page.waitForURL('**/calendar', { timeout: 30000 });
}

/**
 * Log in as fresh user (no calendars)
 * Navigates to login page and performs login
 * This user has no calendars, perfect for calendar creation tests
 */
export async function loginAsFreshUser(page: Page) {
  await page.goto('/auth/login');

  // Fill in login form using accessible name selectors
  await page.getByRole('textbox', { name: 'email' }).fill(TEST_FRESH_USER.email);
  await page.getByRole('textbox', { name: 'password' }).fill(TEST_FRESH_USER.password);

  // Click login button
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for navigation to complete (longer timeout for server startup)
  await page.waitForURL('**/calendar', { timeout: 30000 });
}
