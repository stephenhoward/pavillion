import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Admin Federation Settings
 *
 * Tests the federation admin dashboard which provides an overview
 * and links to the blocked instances management page.
 *
 * Covers:
 * - Federation settings page layout and navigation
 * - Link to blocked instances management
 * - Auto-Repost Policy (smoke test only — requires federation for full test)
 *
 * Uses isolated test server with in-memory database for true test isolation
 */

let env: TestEnvironment;

// Configure tests to run serially within this file
test.describe.configure({ mode: 'serial' });

// Start server once for entire file
test.beforeAll(async () => {
  env = await startTestServer();
});

test.afterAll(async () => {
  await env.cleanup();
});

test.describe('Admin Federation Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should display federation settings page with header and info panel', async ({ page }) => {
    await page.goto(env.baseURL + '/admin/federation');

    // Verify page header
    const heading = page.locator('.federation-header h1');
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Verify subtitle
    const subtitle = page.locator('.federation-subtitle');
    await expect(subtitle).toBeVisible();

    // Verify info panel
    const infoPanel = page.locator('.federation-info-panel[role="note"]');
    await expect(infoPanel).toBeVisible();

    // Verify blocked instances card with link
    const card = page.locator('.federation-card');
    await expect(card).toBeVisible();

    const manageLink = page.locator('.federation-manage-link');
    await expect(manageLink).toBeVisible();
  });

  test('should navigate to blocked instances page via manage link', async ({ page }) => {
    await page.goto(env.baseURL + '/admin/federation');

    // Click the manage blocked instances link
    const manageLink = page.locator('.federation-manage-link');
    await expect(manageLink).toBeVisible({ timeout: 10000 });
    await manageLink.click();

    // Verify navigation to the blocked instances management page
    await page.waitForURL('**/admin/moderation/blocked-instances', { timeout: 10000 });
  });
});

test.describe('Feed Page (Auto-Repost Smoke Test)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should load feed page without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(env.baseURL + '/feed');

    // Wait for the feed page to load — look for the page root or tab navigation
    await page.waitForSelector('.feed-root, .feed-page, [class*="feed"]', { timeout: 10000 });

    // Verify no critical console errors (filter expected warnings)
    const relevantErrors = consoleErrors.filter(err =>
      !err.includes('Deprecation') &&
      !err.includes('[vite]') &&
      !err.includes('404') &&
      !err.includes('i18next::translator: missingKey')
    );
    expect(relevantErrors).toHaveLength(0);
  });
});
