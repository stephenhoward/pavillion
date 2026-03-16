import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Calendar FundingTab — Subscribe Sheet Workflow
 *
 * Tests the new FundingTab behaviors introduced by the SubscribeSheet feature:
 *   1. When subscriptions are enabled but the user has no subscription,
 *      FundingTab shows a "Subscribe to Fund" prompt instead of failing.
 *   2. Clicking the prompt opens the SubscribeSheet (bottom-sheet/modal).
 *   3. The SubscribeSheet displays the subscribe form with billing cycle options.
 *   4. When subscriptions are disabled, FundingTab hides the funding UI entirely.
 *
 * All tests mock the subscription API endpoints to control state without
 * requiring real payment provider configuration.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

/**
 * Mock subscription API endpoints to simulate a specific subscription state.
 *
 * @param page - Playwright page
 * @param options.hasSubscription - Whether the user has an active subscription
 * @param options.subscriptionsEnabled - Whether subscriptions are enabled on the instance
 * @param options.fundingStatus - The funding status of the calendar
 */
async function mockSubscriptionAPIs(page: import('@playwright/test').Page, options: {
  hasSubscription: boolean;
  subscriptionsEnabled: boolean;
  fundingStatus: 'funded' | 'unfunded' | 'grant' | 'admin-exempt';
}) {
  // Mock subscription status
  await page.route('**/api/subscription/v1/status', async (route) => {
    if (options.hasSubscription) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'sub-mock-1',
          status: 'active',
          billing_cycle: 'monthly',
          amount: 500000,
          currency: 'USD',
          current_period_start: '2026-03-01',
          current_period_end: '2026-04-01',
          provider_type: 'stripe',
        }),
      });
    }
    else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No subscription found' }),
      });
    }
  });

  // Mock subscription options
  await page.route('**/api/subscription/v1/options', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: options.subscriptionsEnabled,
        providers: options.subscriptionsEnabled
          ? [{ provider_type: 'stripe', display_name: 'Stripe' }]
          : [],
        monthly_price: 500000,
        yearly_price: 5000000,
        currency: 'USD',
        pay_what_you_can: false,
      }),
    });
  });

  // Mock funding status for any calendar
  await page.route('**/api/subscription/v1/calendars/*/funding', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: options.fundingStatus,
      }),
    });
  });
}

test.describe('Calendar FundingTab — Subscribe Sheet', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('shows subscribe prompt when user has no subscription and calendar is unfunded', async ({ page }) => {
    await mockSubscriptionAPIs(page, {
      hasSubscription: false,
      subscriptionsEnabled: true,
      fundingStatus: 'unfunded',
    });

    // Navigate to calendar management and click Funding tab
    await page.goto(env.baseURL + '/calendar/test_calendar/manage');
    await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

    const fundingTab = page.locator('#funding-tab');
    await fundingTab.click();

    // Wait for FundingTab content to load
    const fundingCard = page.locator('.funding-card');
    await expect(fundingCard).toBeVisible({ timeout: 10000 });

    // Should show unfunded badge
    const unfundedBadge = page.locator('.funding-status-badge--unfunded');
    await expect(unfundedBadge).toBeVisible();

    // Should show "Subscribe to Fund" button, NOT the regular "Add to Subscription" button
    const subscribeButton = page.locator('.funding-button--primary');
    await expect(subscribeButton).toBeVisible();
    await expect(subscribeButton).toContainText('Subscribe');
  });

  test('opens SubscribeSheet when subscribe button is clicked', async ({ page }) => {
    await mockSubscriptionAPIs(page, {
      hasSubscription: false,
      subscriptionsEnabled: true,
      fundingStatus: 'unfunded',
    });

    await page.goto(env.baseURL + '/calendar/test_calendar/manage');
    await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

    const fundingTab = page.locator('#funding-tab');
    await fundingTab.click();

    // Wait for content and click subscribe button
    const subscribeButton = page.locator('.funding-button--primary');
    await expect(subscribeButton).toBeVisible({ timeout: 10000 });
    await subscribeButton.click();

    // The Sheet/dialog should open
    const dialog = page.locator('dialog.sheet-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Should contain billing cycle radio buttons
    const monthlyOption = dialog.locator('input[type="radio"][value="monthly"]');
    await expect(monthlyOption).toBeVisible();

    const yearlyOption = dialog.locator('input[type="radio"][value="yearly"]');
    await expect(yearlyOption).toBeVisible();

    // Should have a confirm/subscribe button
    const confirmButton = dialog.locator('button.primary');
    await expect(confirmButton).toBeVisible();
  });

  test('SubscribeSheet closes when close button is clicked', async ({ page }) => {
    await mockSubscriptionAPIs(page, {
      hasSubscription: false,
      subscriptionsEnabled: true,
      fundingStatus: 'unfunded',
    });

    await page.goto(env.baseURL + '/calendar/test_calendar/manage');
    await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

    const fundingTab = page.locator('#funding-tab');
    await fundingTab.click();

    const subscribeButton = page.locator('.funding-button--primary');
    await expect(subscribeButton).toBeVisible({ timeout: 10000 });
    await subscribeButton.click();

    // Sheet should be open
    const dialog = page.locator('dialog.sheet-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click the close button (× in header)
    const closeButton = dialog.locator('.sheet-header button');
    await closeButton.click();

    // Dialog should be hidden
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('hides funding UI when subscriptions are disabled', async ({ page }) => {
    await mockSubscriptionAPIs(page, {
      hasSubscription: false,
      subscriptionsEnabled: false,
      fundingStatus: 'unfunded',
    });

    await page.goto(env.baseURL + '/calendar/test_calendar/manage');
    await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

    const fundingTab = page.locator('#funding-tab');
    await fundingTab.click();

    // Wait a moment for content to load
    await page.waitForTimeout(2000);

    // Funding content area should NOT be visible
    const fundingContent = page.locator('.funding-content');
    await expect(fundingContent).not.toBeVisible();

    // No status badges should appear
    const anyBadge = page.locator('.funding-status-badge');
    await expect(anyBadge).toHaveCount(0);
  });

  test('shows add button when user has subscription and calendar is unfunded', async ({ page }) => {
    await mockSubscriptionAPIs(page, {
      hasSubscription: true,
      subscriptionsEnabled: true,
      fundingStatus: 'unfunded',
    });

    await page.goto(env.baseURL + '/calendar/test_calendar/manage');
    await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

    const fundingTab = page.locator('#funding-tab');
    await fundingTab.click();

    const fundingCard = page.locator('.funding-card');
    await expect(fundingCard).toBeVisible({ timeout: 10000 });

    // Should show unfunded badge
    const unfundedBadge = page.locator('.funding-status-badge--unfunded');
    await expect(unfundedBadge).toBeVisible();

    // Should show the regular "Add to Subscription" button (not subscribe prompt)
    const addButton = page.locator('.funding-button--primary');
    await expect(addButton).toBeVisible();
    await expect(addButton).toContainText('Add');
  });
});
