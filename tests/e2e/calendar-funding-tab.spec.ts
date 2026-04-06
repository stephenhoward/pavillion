import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Calendar Settings — Extended Features (Funding)
 *
 * Tests the funding workflow in the Settings tab's Extended Features section:
 *   1. When funding is enabled and calendar is unfunded, shows an "Enable" button.
 *   2. Clicking "Enable" opens the FundingSheet overlay.
 *   3. When funding is enabled and calendar is funded, shows enabled badge with disable option.
 *   4. When funding is disabled, the extended features section is hidden.
 *   5. When calendar has admin-exempt status, shows admin-exempt badge.
 *
 * All tests mock the funding API endpoints to control state without
 * requiring real payment provider configuration.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

/**
 * Mock funding API endpoints to simulate a specific funding state.
 */
async function mockFundingAPIs(page: import('@playwright/test').Page, options: {
  subscriptionsEnabled: boolean;
  fundingStatus: 'funded' | 'unfunded' | 'grant' | 'admin-exempt';
}) {
  // Mock funding plan status (user's subscription)
  await page.route('**/api/funding/v1/status', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'No subscription found' }),
    });
  });

  // Mock funding plan options
  await page.route('**/api/funding/v1/options', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: options.subscriptionsEnabled,
        providers: options.subscriptionsEnabled
          ? [{ providerType: 'stripe', displayName: 'Stripe' }]
          : [],
        monthlyPrice: 500000,
        yearlyPrice: 5000000,
        currency: 'USD',
        payWhatYouCan: false,
        payWhatYouCanYearlyDiscount: 0,
      }),
    });
  });

  // Mock funding status for any calendar
  await page.route('**/api/funding/v1/calendars/*/funding', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: options.fundingStatus,
      }),
    });
  });
}

/**
 * Navigate to calendar settings tab.
 */
async function navigateToSettingsTab(page: import('@playwright/test').Page, baseURL: string) {
  await page.goto(baseURL + '/calendar/test_calendar/manage');
  await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

  const settingsTab = page.locator('#settings-tab');
  await settingsTab.click();
}

test.describe('Calendar Settings — Extended Features (Funding)', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('shows enable button when funding is enabled and calendar is unfunded', async ({ page }) => {
    await mockFundingAPIs(page, {
      subscriptionsEnabled: true,
      fundingStatus: 'unfunded',
    });

    await navigateToSettingsTab(page, env.baseURL);

    // Extended features section should be visible with an enable button
    const enableButton = page.locator('.setting-enable-btn');
    await expect(enableButton).toBeVisible({ timeout: 10000 });
  });

  test('clicking enable button opens funding sheet', async ({ page }) => {
    await mockFundingAPIs(page, {
      subscriptionsEnabled: true,
      fundingStatus: 'unfunded',
    });

    await navigateToSettingsTab(page, env.baseURL);

    const enableButton = page.locator('.setting-enable-btn');
    await expect(enableButton).toBeVisible({ timeout: 10000 });
    await enableButton.click();

    // FundingSheet dialog should appear (Sheet component uses .sheet-dialog)
    const fundingSheet = page.locator('.sheet-dialog');
    await expect(fundingSheet).toBeVisible({ timeout: 10000 });
  });

  test('shows enabled badge when calendar is funded', async ({ page }) => {
    await mockFundingAPIs(page, {
      subscriptionsEnabled: true,
      fundingStatus: 'funded',
    });

    await navigateToSettingsTab(page, env.baseURL);

    // Should show enabled badge
    const enabledBadge = page.locator('.setting-badge--enabled');
    await expect(enabledBadge).toBeVisible({ timeout: 10000 });

    // Should show disable button
    const disableButton = page.locator('.setting-disable-btn');
    await expect(disableButton).toBeVisible();
  });

  test('hides extended features section when funding is disabled', async ({ page }) => {
    await mockFundingAPIs(page, {
      subscriptionsEnabled: false,
      fundingStatus: 'unfunded',
    });

    await navigateToSettingsTab(page, env.baseURL);

    // Wait for settings content to load
    const settingsContent = page.locator('.settings-content');
    await expect(settingsContent).toBeVisible({ timeout: 10000 });

    // Extended features enable button should NOT be visible
    const enableButton = page.locator('.setting-enable-btn');
    await expect(enableButton).not.toBeVisible();

    // No enabled badges should appear
    const enabledBadge = page.locator('.setting-badge--enabled');
    await expect(enabledBadge).toHaveCount(0);
  });

  test('shows admin-exempt badge for admin-exempt calendars', async ({ page }) => {
    await mockFundingAPIs(page, {
      subscriptionsEnabled: true,
      fundingStatus: 'admin-exempt',
    });

    await navigateToSettingsTab(page, env.baseURL);

    // Should show enabled badge (admin-exempt uses same badge style)
    const enabledBadge = page.locator('.setting-badge--enabled');
    await expect(enabledBadge).toBeVisible({ timeout: 10000 });
  });
});
