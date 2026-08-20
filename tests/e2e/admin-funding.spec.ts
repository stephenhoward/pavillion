import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Admin Funding Plan Management
 *
 * Tests the funding page navigation, tab switching, empty states,
 * and provider wizard interaction.
 *
 * Covers workflow audit gap:
 * - 5.5 Funding Plan Management
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Admin Funding Management', () => {
  test.beforeAll(async () => {
    // Start isolated test server for this test file
    env = await startTestServer();
  });

  test.afterAll(async () => {
    // Clean up test server
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should display funding page with tab navigation', async ({ page }) => {
    await page.goto(env.baseURL + '/admin/funding');

    // Wait for page to load (loading state disappears)
    await page.waitForSelector('.funding-page', { timeout: 10000 });

    // Verify page heading
    const heading = page.locator('#funding-heading');
    await expect(heading).toBeVisible();

    // Verify tab navigation exists
    const tablist = page.locator('nav[role="tablist"][aria-label="Funding sections"]');
    await expect(tablist).toBeVisible();

    // Verify both tabs exist
    const plansTab = page.locator('button[role="tab"][aria-controls="plans-panel"]');
    await expect(plansTab).toBeVisible();

    const settingsTab = page.locator('button[role="tab"][aria-controls="settings-panel"]');
    await expect(settingsTab).toBeVisible();

    // Verify funding plans tab is active by default
    await expect(plansTab).toHaveAttribute('aria-selected', 'true');
    await expect(settingsTab).toHaveAttribute('aria-selected', 'false');
  });

  test('should show empty funding plan state', async ({ page }) => {
    await page.goto(env.baseURL + '/admin/funding');

    // Wait for loading to complete
    await page.waitForSelector('.loading-state', { state: 'hidden', timeout: 15000 });

    // Verify the funding plans panel is visible
    const plansPanel = page.locator('#plans-panel:not([hidden])');
    await expect(plansPanel).toBeVisible();

    // Verify empty state card (no funding plans expected in dev)
    const emptyCard = page.locator('#plans-panel .empty-card');
    const emptyCardVisible = await emptyCard.isVisible().catch(() => false);

    if (emptyCardVisible) {
      const emptyTitle = emptyCard.locator('.empty-title');
      await expect(emptyTitle).toBeVisible();
    }
    // If funding plans exist, verify the table renders instead
    else {
      const plansTable = page.locator('#plans-panel table[role="table"]');
      const planCards = page.locator('#plans-panel .plan-card');
      const hasTable = await plansTable.count() > 0;
      const hasCards = await planCards.count() > 0;
      expect(hasTable || hasCards).toBeTruthy();
    }
  });

  test('should switch to settings tab and display enable toggle', async ({ page }) => {
    await page.goto(env.baseURL + '/admin/funding');

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

    // Verify the enable funding toggle card
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

  test('should show provider section when funding enabled', async ({ page }) => {
    // Mock the funding settings API to prevent side effects
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

    // Mock funding plans list endpoint
    await page.route('**/api/subscription/admin/subscriptions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscriptions: [], total: 0 }),
      });
    });

    await page.goto(env.baseURL + '/admin/funding');

    // Wait for page to load
    await page.waitForSelector('.loading-state', { state: 'hidden', timeout: 15000 });

    // Switch to settings tab
    const settingsTab = page.locator('button[role="tab"][aria-controls="settings-panel"]');
    await settingsTab.click();

    // Enable funding
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
