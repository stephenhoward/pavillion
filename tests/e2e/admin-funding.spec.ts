import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Admin Funding & Subscription Management
 *
 * Tests the funding page navigation, tab switching, empty states,
 * and provider wizard interaction.
 *
 * Covers workflow audit gap:
 * - 5.5 Subscription/Funding Management
 */

test.describe('Admin Funding Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should display funding page with tab navigation', async ({ page }) => {
    await page.goto('/admin/funding');

    // Wait for page to load (loading state disappears)
    await page.waitForSelector('.funding-page', { timeout: 10000 });

    // Verify page heading
    const heading = page.locator('#funding-heading');
    await expect(heading).toBeVisible();

    // Verify tab navigation exists
    const tablist = page.locator('nav[role="tablist"][aria-label="Funding sections"]');
    await expect(tablist).toBeVisible();

    // Verify both tabs exist
    const subscriptionsTab = page.locator('button[role="tab"][aria-controls="subscriptions-panel"]');
    await expect(subscriptionsTab).toBeVisible();

    const settingsTab = page.locator('button[role="tab"][aria-controls="settings-panel"]');
    await expect(settingsTab).toBeVisible();

    // Verify subscriptions tab is active by default
    await expect(subscriptionsTab).toHaveAttribute('aria-selected', 'true');
    await expect(settingsTab).toHaveAttribute('aria-selected', 'false');
  });

  test('should show empty subscription state', async ({ page }) => {
    await page.goto('/admin/funding');

    // Wait for loading to complete
    await page.waitForSelector('.loading-state', { state: 'hidden', timeout: 15000 });

    // Verify the subscriptions panel is visible
    const subscriptionsPanel = page.locator('#subscriptions-panel:not([hidden])');
    await expect(subscriptionsPanel).toBeVisible();

    // Verify empty state card (no subscriptions expected in dev)
    const emptyCard = page.locator('#subscriptions-panel .empty-card');
    const emptyCardVisible = await emptyCard.isVisible().catch(() => false);

    if (emptyCardVisible) {
      const emptyTitle = emptyCard.locator('.empty-title');
      await expect(emptyTitle).toBeVisible();
    }
    // If subscriptions exist, verify the table renders instead
    else {
      const subscriptionsTable = page.locator('#subscriptions-panel table[role="table"]');
      const subscriptionCards = page.locator('#subscriptions-panel .subscription-card');
      const hasTable = await subscriptionsTable.count() > 0;
      const hasCards = await subscriptionCards.count() > 0;
      expect(hasTable || hasCards).toBeTruthy();
    }
  });

  test('should switch to settings tab and display enable toggle', async ({ page }) => {
    await page.goto('/admin/funding');

    // Wait for loading to complete
    await page.waitForSelector('.loading-state', { state: 'hidden', timeout: 15000 });

    // Click settings tab
    const settingsTab = page.locator('button[role="tab"][aria-controls="settings-panel"]');
    await settingsTab.click();

    // Verify settings tab is now active
    await expect(settingsTab).toHaveAttribute('aria-selected', 'true');

    // Verify settings panel is visible
    const settingsPanel = page.locator('#settings-panel:not([hidden])');
    await expect(settingsPanel).toBeVisible();

    // Verify the enable subscriptions toggle card
    const settingsCard = page.locator('.settings-card');
    await expect(settingsCard).toBeVisible();

    // Verify the checkbox toggle exists
    const toggleCheckbox = settingsCard.locator('.toggle-checkbox');
    await expect(toggleCheckbox).toBeVisible();

    // Verify label text exists
    const toggleLabel = settingsCard.locator('.toggle-label');
    await expect(toggleLabel).toBeVisible();

    const toggleDescription = settingsCard.locator('.toggle-description');
    await expect(toggleDescription).toBeVisible();
  });

  test('should show provider section when subscriptions enabled', async ({ page }) => {
    // Mock the subscription settings API to prevent side effects
    await page.route('**/api/subscription/admin/settings', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: false,
            monthlyPrice: 1000000,
            yearlyPrice: 10000000,
            currency: 'USD',
            payWhatYouCan: false,
            gracePeriodDays: 7,
          }),
        });
      }
      else if (method === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
      else {
        await route.continue();
      }
    });

    // Mock providers endpoint
    await page.route('**/api/subscription/admin/providers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    // Mock subscriptions list endpoint
    await page.route('**/api/subscription/admin/subscriptions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscriptions: [], total: 0 }),
      });
    });

    await page.goto('/admin/funding');

    // Wait for page to load
    await page.waitForSelector('.loading-state', { state: 'hidden', timeout: 15000 });

    // Switch to settings tab
    const settingsTab = page.locator('button[role="tab"][aria-controls="settings-panel"]');
    await settingsTab.click();

    // Enable subscriptions
    const toggleCheckbox = page.locator('.settings-card .toggle-checkbox');
    await toggleCheckbox.check();

    // Wait for provider section to appear
    const providersCard = page.locator('.providers-card');
    await expect(providersCard).toBeVisible({ timeout: 5000 });

    // Verify "Add Provider" button exists
    const addProviderButton = page.locator('.btn-text-orange').first();
    await expect(addProviderButton).toBeVisible();
  });
});
