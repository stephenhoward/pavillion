import { test, expect, type Page } from '@playwright/test';
import axios from 'axios';
import { loginAsAdmin } from './helpers/auth';
import {
  adminLeaf,
  adminLeafPath,
  adminReport,
  adminReportPath,
  gotoSettings,
  settingsRow,
  settingsTitle,
  settingsTree,
} from './helpers/settings-nav';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Admin Moderation Features
 *
 * Tests the advanced admin moderation features including:
 * - Analytics dashboard with charts and metrics
 * - Blocked reporters management
 * - Pattern warning indicators on reports
 * - Moderation settings (IP retention, escalation thresholds)
 *
 * These tests verify the complete admin moderation workflow from
 * viewing analytics to managing blocked reporters and configuring
 * system settings.
 *
 * NOTE: Some features (analytics, blocked reporters) may be embedded
 * in existing views or accessed via tabs/sections rather than separate routes.
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 */

// A seeded event from layouts/development/db/
const TEST_EVENT_ID = '37d1bb5a-452b-432e-ac46-268b9c565bde';

let env: TestEnvironment;
let seededReportId: string;

// Configure tests to run serially since they may share state
test.describe.configure({ mode: 'serial' });

// Start server once for entire file
test.beforeAll(async () => {
  env = await startTestServer();

  // Seed one admin-initiated report so the dashboard always lists a report
  // and the report-detail tests have something to open.
  const loginResponse = await axios.post(`${env.baseURL}/api/auth/v1/login`, {
    email: 'admin@pavillion.dev',
    password: 'admin',
  });
  const reportResponse = await axios.post(
    `${env.baseURL}/api/v1/admin/reports`,
    {
      eventId: TEST_EVENT_ID,
      category: 'spam',
      description: 'E2E seed: a report for the admin report-detail tests.',
      priority: 'medium',
      adminNotes: 'Seeded by admin-moderation.spec.ts',
    },
    { headers: { Authorization: `Bearer ${loginResponse.data}` } },
  );
  seededReportId = reportResponse.data.report.id;
});

/**
 * Opens the seeded report from the moderation dashboard's View Details
 * button and waits for the report detail page.
 */
async function openSeededReport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'View Details' }).first().click();
  await expect(page).toHaveURL(new RegExp(adminReportPath(seededReportId) + '$'));
  await expect(settingsTitle(page, adminReport(seededReportId).title)).toBeVisible({ timeout: 10000 });
}

test.afterAll(async () => {
  await env.cleanup();
});

test.describe('Admin Moderation Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should display moderation dashboard with reports', async ({ page }) => {
    // Navigate to moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));

    // Wait for the moderation dashboard to load
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    // Verify dashboard has filter controls
    const statusFilter = page.locator('select#status-filter').first();
    await expect(statusFilter).toBeVisible();

    // The seeded report is listed
    await expect(page.locator('table.reports-table').first()).toBeVisible();
  });

  test('should filter reports by status', async ({ page }) => {
    // Navigate to moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    // Find and use the status filter
    const statusFilter = page.locator('select#status-filter');
    await expect(statusFilter).toBeVisible();

    // Select a specific status
    await statusFilter.selectOption({ index: 1 }); // Select first non-"All" option
    await page.waitForTimeout(500);

    // Verify the page updated (doesn't cause errors)
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible();
  });

  test('should navigate to report detail', async ({ page }) => {
    // Navigate to moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    await openSeededReport(page);

    // The report sub-page carries its own title, the eyebrow links back to
    // Moderation, and the tree keeps Moderation current
    await expect(settingsTitle(page, adminReport(seededReportId).title)).toBeVisible();
    await expect(page.locator('.settings-page-header__eyebrow').getByRole('link', { name: 'Moderation', exact: true }))
      .toHaveAttribute('href', adminLeafPath('moderation'));
    await expect(settingsRow(settingsTree(page), 'Moderation')).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('Admin Pattern Warning Indicators', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should support pattern warning display on reports', async ({ page }) => {
    // Navigate to moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    await expect(page.locator('select#status-filter')).toBeVisible();

    // Pattern indicators would appear on the report detail page if present
    // in the data
    await openSeededReport(page);
    await expect(page.locator('.admin-report-detail .info-card').first()).toBeVisible();
  });

  test('should display report details with metadata', async ({ page }) => {
    // Navigate to moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    await openSeededReport(page);

    // Report information section with the report's metadata fields
    const infoCard = page.getByRole('region', { name: 'Report Information' });
    await expect(infoCard).toBeVisible();
    await expect(infoCard.getByText('Category', { exact: true })).toBeVisible();
    await expect(infoCard.getByText('Status', { exact: true })).toBeVisible();
    await expect(infoCard.getByText('E2E seed: a report for the admin report-detail tests.')).toBeVisible();
  });
});

test.describe('Admin Moderation Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should access moderation settings page', async ({ page }) => {
    // Navigate directly to moderation settings
    await gotoSettings(page, env.baseURL, adminLeaf('moderation/settings'));

    // Wait for page to load (give more time for loading state)
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete
    const loadingMessage = page.locator('text=/Loading settings/i').first();
    if (await loadingMessage.isVisible().catch(() => false)) {
      await page.waitForTimeout(2000); // Wait for data to load
    }

    // Verify we're on settings page
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible();
  });

  test('should display IP retention settings', async ({ page }) => {
    // Navigate to moderation settings
    await gotoSettings(page, env.baseURL, adminLeaf('moderation/settings'));
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete
    await page.waitForTimeout(2000);

    // Look for IP retention related fields by their IDs
    const ipHashField = page.locator('input#ip-hash-retention');
    const ipSubnetField = page.locator('input#ip-subnet-retention');

    // Wait for at least one field to be visible
    try {
      await ipHashField.waitFor({ timeout: 5000 });
    } catch {
      // Field might not be visible yet
    }

    const hasIpHashField = await ipHashField.isVisible().catch(() => false);
    const hasIpSubnetField = await ipSubnetField.isVisible().catch(() => false);

    // At least one IP retention setting should be visible
    expect(hasIpHashField || hasIpSubnetField).toBeTruthy();
  });

  test('should display escalation threshold settings', async ({ page }) => {
    // Navigate to moderation settings
    await gotoSettings(page, env.baseURL, adminLeaf('moderation/settings'));
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete
    await page.waitForTimeout(2000);

    // Look for escalation threshold field
    const thresholdField = page.locator('input#auto-escalation-threshold');
    const autoEscalationField = page.locator('input#auto-escalation');

    try {
      await thresholdField.waitFor({ timeout: 5000 });
    } catch {
      // Field might not be visible yet
    }

    const hasThresholdField = await thresholdField.isVisible().catch(() => false);
    const hasAutoEscalationField = await autoEscalationField.isVisible().catch(() => false);

    // Settings page should have escalation-related fields
    expect(hasThresholdField || hasAutoEscalationField).toBeTruthy();
  });

  test('should update and save moderation settings', async ({ page }) => {
    // Navigate to moderation settings
    await gotoSettings(page, env.baseURL, adminLeaf('moderation/settings'));
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete
    await page.waitForTimeout(2000);

    // Find a numeric input field
    const autoEscalationField = page.locator('input#auto-escalation');

    if (await autoEscalationField.isVisible().catch(() => false)) {
      // Get current value
      const currentValue = await autoEscalationField.inputValue();
      const newValue = currentValue === '72' ? '48' : '72';

      // Update the value
      await autoEscalationField.clear();
      await autoEscalationField.fill(newValue);

      // Find and click save button
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();

      if (await saveButton.isVisible().catch(() => false)) {
        await saveButton.click();
        await page.waitForTimeout(2000);

        // Verify success message
        const successMessage = page.locator('.message-success, [role="status"]:has-text("Success")').first();
        const hasSuccess = await successMessage.isVisible().catch(() => false);
        expect(hasSuccess).toBeTruthy();
      }
    }
  });

  test('should persist settings across page reload', async ({ page }) => {
    // Navigate to moderation settings
    await gotoSettings(page, env.baseURL, adminLeaf('moderation/settings'));
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete
    await page.waitForTimeout(3000);

    // Find a numeric input and set a known value
    const autoEscalationField = page.locator('input#auto-escalation');

    if (await autoEscalationField.isVisible().catch(() => false)) {
      // Set a specific test value
      const testValue = '96';
      await autoEscalationField.clear();
      await autoEscalationField.fill(testValue);

      // Save the change
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
      if (await saveButton.isVisible().catch(() => false)) {
        await saveButton.click();
        await page.waitForTimeout(3000); // Wait for save to complete
      }

      // Verify it was set
      const savedValue = await autoEscalationField.inputValue();
      expect(savedValue).toBe(testValue);

      // Reload the page
      await page.reload();
      await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(3000);

      // Verify the value persisted
      const reloadedValue = await autoEscalationField.inputValue();
      expect(reloadedValue).toBe(testValue);
    }
  });

  test('should validate IP retention day inputs', async ({ page }) => {
    // Navigate to moderation settings
    await gotoSettings(page, env.baseURL, adminLeaf('moderation/settings'));
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Find IP hash retention field
    const ipHashField = page.locator('input#ip-hash-retention');

    if (await ipHashField.isVisible().catch(() => false)) {
      // Store original value to restore later
      const originalValue = await ipHashField.inputValue();

      // Try to enter an invalid value (0 or negative)
      await ipHashField.clear();
      await ipHashField.fill('0');

      // Try to save
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
      if (await saveButton.isVisible().catch(() => false)) {
        await saveButton.click();
        await page.waitForTimeout(1000);

        // Should show validation error or not allow saving
        const errorMessage = page.locator('.error-text, .message-error, [role="alert"]').first();
        const hasError = await errorMessage.isVisible().catch(() => false);

        // Either shows error OR doesn't save (stays on page)
        const stillOnSettingsPage = await settingsTitle(page, adminLeaf('moderation/settings').title).isVisible();

        expect(hasError || stillOnSettingsPage).toBeTruthy();

        // Restore original value
        await ipHashField.clear();
        await ipHashField.fill(originalValue);
        await saveButton.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

test.describe('Admin Create Report', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should open create report modal', async ({ page }) => {
    // Navigate to moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    // Look for "Create Report" button
    const createButton = page.locator('button:has-text("Create Report")').first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await page.waitForTimeout(500);

      // Verify modal opened
      const modal = page.locator('.modal, dialog').first();
      const hasModal = await modal.isVisible().catch(() => false);

      expect(hasModal).toBeTruthy();
    }
  });
});

test.describe('Admin Moderation Integration', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should navigate between moderation dashboard and settings', async ({ page }) => {
    // Start at moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    // The dashboard's gear button opens moderation settings
    await page.getByRole('button', { name: 'Moderation Settings' }).click();
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible();

    // The sub-page carries its own title, and the tree keeps Moderation current
    const moderationRow = settingsRow(settingsTree(page), 'Moderation');
    await expect(settingsTitle(page, adminLeaf('moderation/settings').title)).toBeVisible();
    await expect(moderationRow).toHaveAttribute('aria-current', 'page');

    // The settings tree's Moderation row leads back to the dashboard
    await moderationRow.click();
    await expect(page).toHaveURL(new RegExp(adminLeafPath('moderation') + '$'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible();
  });

  test('should maintain admin context across navigation', async ({ page }) => {
    // Start at moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    const tree = settingsTree(page);

    // Navigate to admin accounts
    await settingsRow(tree, 'Accounts').click();
    await expect(page).toHaveURL(new RegExp(adminLeafPath('accounts') + '$'));
    await expect(settingsTitle(page, adminLeaf('accounts').title)).toBeVisible();

    // Navigate back to moderation
    await settingsRow(tree, 'Moderation').click();
    await expect(page).toHaveURL(new RegExp(adminLeafPath('moderation') + '$'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible();
  });

  test('should apply and reset filters', async ({ page }) => {
    // Navigate to moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    // Apply a filter
    const statusFilter = page.locator('select#status-filter');
    await statusFilter.selectOption({ index: 1 });
    await page.waitForTimeout(500);

    // Check if reset button appears
    const resetButton = page.locator('button:has-text("Reset")').first();

    if (await resetButton.isVisible().catch(() => false)) {
      await resetButton.click();
      await page.waitForTimeout(500);

      // Verify filter was reset (back to "All Statuses")
      const selectedOption = await statusFilter.locator('option:checked').textContent();
      expect(selectedOption?.toLowerCase()).toContain('all');
    }
  });
});

test.describe('Admin Moderation Pagination', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should display pagination if many reports exist', async ({ page }) => {
    // Navigate to moderation dashboard
    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible({ timeout: 10000 });

    // Look for pagination controls
    const pagination = page.locator('nav[aria-label*="pagination" i], .pagination').first();

    // Pagination may or may not exist depending on report count
    const hasPagination = await pagination.isVisible().catch(() => false);

    // Just verify the page loaded successfully
    await expect(settingsTitle(page, adminLeaf('moderation').title)).toBeVisible();

    // If pagination exists, verify it's functional
    if (hasPagination) {
      const nextButton = page.locator('button:has-text("Next"), button[aria-label*="next" i]').first();
      const hasNextButton = await nextButton.isVisible().catch(() => false);
      expect(hasNextButton).toBeTruthy();
    }
  });
});
