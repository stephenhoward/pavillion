import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Calendar FundingTab — Funding Workflow
 *
 * Tests the FundingTab behaviors:
 *   1. When subscriptions are enabled but the user has no subscription,
 *      FundingTab shows a "Fund This Calendar" prompt with inline pricing cards.
 *   2. Pricing cards (monthly/yearly) are shown inline for non-PWYC mode.
 *   3. The "Fund This Calendar" button initiates Stripe inline checkout (no dialog).
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
  // Mock funding plan status
  await page.route('**/api/funding/v1/status', async (route) => {
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

  // Mock funding plan options — use camelCase to match real API response shape
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

test.describe('Calendar FundingTab — Funding Workflow', () => {
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

    // Should show "Fund This Calendar" button (inline checkout, no dialog)
    const subscribeButton = page.locator('.funding-button--primary');
    await expect(subscribeButton).toBeVisible();
    await expect(subscribeButton).toContainText('Fund This Calendar');
  });

  test('shows inline pricing cards for non-PWYC subscription option', async ({ page }) => {
    await mockSubscriptionAPIs(page, {
      hasSubscription: false,
      subscriptionsEnabled: true,
      fundingStatus: 'unfunded',
    });

    await page.goto(env.baseURL + '/calendar/test_calendar/manage');
    await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

    const fundingTab = page.locator('#funding-tab');
    await fundingTab.click();

    // Wait for FundingTab content to load
    const fundingCard = page.locator('.funding-card');
    await expect(fundingCard).toBeVisible({ timeout: 10000 });

    // Pricing cards should be visible inline (no dialog needed)
    const pricingCards = page.locator('.pricing-card');
    await expect(pricingCards).toHaveCount(2);

    // Monthly and yearly options should be present
    const monthlyCard = page.locator('.pricing-card').first();
    await expect(monthlyCard).toBeVisible();

    const yearlyCard = page.locator('.pricing-card').last();
    await expect(yearlyCard).toBeVisible();

    // Fund This Calendar button should be present
    const fundButton = page.locator('.funding-button--primary');
    await expect(fundButton).toBeVisible();
    await expect(fundButton).toContainText('Fund This Calendar');
  });

  test('Fund This Calendar button is enabled and no dialog opens', async ({ page }) => {
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

    // Button should be enabled (not disabled)
    await expect(subscribeButton).not.toBeDisabled();

    // No sheet dialog should exist in the DOM (FundingSheet removed from FundingTab)
    const dialog = page.locator('dialog.sheet-dialog');
    await expect(dialog).toHaveCount(0);
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
