import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Admin Federation & Instance Blocking
 *
 * Tests the federation admin dashboard and instance blocking UI workflow.
 * Note: Instance blocking is frontend-only (no backend persistence).
 * Block/unblock operations complete within a single page session.
 *
 * Covers workflow audit gaps:
 * - 5.7 Instance Blocking (frontend-only)
 * - 5.8 Federation Settings Overview
 * - 2.4 Auto-Repost Policy (smoke test only — requires federation for full test)
 */

test.describe('Admin Federation Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should display federation settings page with header and info panel', async ({ page }) => {
    await page.goto('/admin/federation');

    // Verify page header
    const heading = page.locator('.federation-header h1');
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Verify subtitle
    const subtitle = page.locator('.federation-subtitle');
    await expect(subtitle).toBeVisible();

    // Verify info panel
    const infoPanel = page.locator('.federation-info-panel[role="note"]');
    await expect(infoPanel).toBeVisible();

    // Verify Block Instance button
    const blockButton = page.locator('.block-instance-button');
    await expect(blockButton).toBeVisible();
  });

  test('should show empty state for blocked instances', async ({ page }) => {
    await page.goto('/admin/federation');

    // Wait for card to render
    const card = page.locator('.federation-card');
    await expect(card).toBeVisible({ timeout: 10000 });

    // Verify empty state elements
    const emptyTitle = page.locator('.federation-empty-title');
    await expect(emptyTitle).toBeVisible();

    const emptyDescription = page.locator('.federation-empty-description');
    await expect(emptyDescription).toBeVisible();

    // Verify no instance items exist
    const instanceItems = page.locator('.federation-instance-item');
    await expect(instanceItems).toHaveCount(0);
  });

  test('should open block instance modal and fill form', async ({ page }) => {
    await page.goto('/admin/federation');

    // Click Block Instance button
    const blockButton = page.locator('.block-instance-button');
    await blockButton.click();

    // Verify modal opens
    const modal = page.locator('.federation-modal[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify domain input has focus
    const domainInput = page.locator('#blockDomain');
    await expect(domainInput).toBeFocused();

    // Verify submit button is disabled when fields are empty
    const submitButton = page.locator('.federation-block-submit-button');
    await expect(submitButton).toBeDisabled();

    // Fill in domain
    await domainInput.fill('spam-instance.example.com');

    // Submit still disabled (reason is empty)
    await expect(submitButton).toBeDisabled();

    // Fill in reason
    const reasonInput = page.locator('#blockReason');
    await reasonInput.fill('Spam content');

    // Submit should now be enabled
    await expect(submitButton).toBeEnabled();
  });

  test('should block an instance and display it in the list', async ({ page }) => {
    await page.goto('/admin/federation');

    const testDomain = `test-${Date.now()}.example.com`;
    const testReason = 'E2E test block reason';

    // Open block modal
    await page.locator('.block-instance-button').click();
    await page.waitForSelector('.federation-modal[role="dialog"]', { timeout: 5000 });

    // Fill form
    await page.locator('#blockDomain').fill(testDomain);
    await page.locator('#blockReason').fill(testReason);

    // Submit
    await page.locator('.federation-block-submit-button').click();

    // Verify modal closes
    await expect(page.locator('.federation-modal-overlay')).toBeHidden({ timeout: 5000 });

    // Verify domain badge appears in the list
    const domainBadge = page.locator('.federation-domain-badge').filter({ hasText: testDomain });
    await expect(domainBadge).toBeVisible();

    // Verify reason is displayed
    const reason = page.locator('.federation-instance-reason').filter({ hasText: testReason });
    await expect(reason).toBeVisible();

    // Verify unblock button exists
    const unblockButton = page.locator('.federation-unblock-button');
    await expect(unblockButton).toBeVisible();

    // Verify empty state is gone
    await expect(page.locator('.federation-empty-title')).toBeHidden();
  });

  test('should unblock an instance via confirmation modal', async ({ page }) => {
    await page.goto('/admin/federation');

    const testDomain = `unblock-test-${Date.now()}.example.com`;

    // First, block an instance
    await page.locator('.block-instance-button').click();
    await page.waitForSelector('.federation-modal[role="dialog"]', { timeout: 5000 });
    await page.locator('#blockDomain').fill(testDomain);
    await page.locator('#blockReason').fill('Will be unblocked');
    await page.locator('.federation-block-submit-button').click();
    await expect(page.locator('.federation-modal-overlay')).toBeHidden({ timeout: 5000 });

    // Verify it was blocked
    await expect(page.locator('.federation-domain-badge').filter({ hasText: testDomain })).toBeVisible();

    // Click unblock button
    await page.locator('.federation-unblock-button').click();

    // Verify unblock confirmation modal opens
    const unblockModal = page.locator('.federation-modal[role="dialog"]');
    await expect(unblockModal).toBeVisible({ timeout: 5000 });

    // Verify the domain is highlighted in the confirmation
    const domainHighlight = page.locator('.federation-unblock-domain-highlight').filter({ hasText: testDomain });
    await expect(domainHighlight).toBeVisible();

    // Confirm unblock
    await page.locator('.federation-unblock-submit-button').click();

    // Verify modal closes
    await expect(page.locator('.federation-modal-overlay')).toBeHidden({ timeout: 5000 });

    // Verify instance is removed from list
    await expect(page.locator('.federation-domain-badge').filter({ hasText: testDomain })).toBeHidden();

    // Verify empty state returns
    await expect(page.locator('.federation-empty-title')).toBeVisible();
  });
});

test.describe('Feed Page (Auto-Repost Smoke Test)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should load feed page without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/feed');

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
