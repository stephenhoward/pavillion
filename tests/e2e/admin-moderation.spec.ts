import { test, expect, type Page, type Response } from '@playwright/test';
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

// A seeded event, and the admin-owned calendar it belongs to, from
// layouts/development/db/
const TEST_EVENT_ID = '37d1bb5a-452b-432e-ac46-268b9c565bde';
const TEST_CALENDAR_ID = 'c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3';

let env: TestEnvironment;
let adminToken: string;
let seededReportId: string;

const REPORTS_API = '/api/v1/admin/reports';
const SETTINGS_API = '/api/v1/admin/moderation/settings';

// Configure tests to run serially since they may share state
test.describe.configure({ mode: 'serial' });

/**
 * Creates an admin-initiated report through the API. An admin may report
 * an event only once.
 *
 * @param eventId - The event to report
 * @param description - The report's description, shown on its detail page
 * @returns The new report's id
 */
async function seedAdminReport(eventId: string, description: string): Promise<string> {
  const response = await axios.post(
    `${env.baseURL}${REPORTS_API}`,
    {
      eventId,
      category: 'spam',
      description,
      priority: 'medium',
      adminNotes: 'Seeded by admin-moderation.spec.ts',
    },
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  return response.data.report.id;
}

/**
 * Creates an event on the admin's seeded calendar through the API.
 *
 * @param name - The event's English name
 * @returns The new event's id
 */
async function seedEvent(name: string): Promise<string> {
  const response = await axios.post(
    `${env.baseURL}/api/v1/events`,
    {
      calendarId: TEST_CALENDAR_ID,
      content: { en: { name } },
      schedules: [{ start: '2030-06-01T18:00:00Z', eventEndTime: '2030-06-01T20:00:00Z' }],
    },
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  return response.data.id;
}

/**
 * Resolves when the dashboard's report list request matching `matches`
 * completes.
 *
 * @param page - Playwright page instance
 * @param matches - Predicate on the request's query parameters
 */
function waitForReportList(page: Page, matches: (params: URLSearchParams) => boolean): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === REPORTS_API
      && response.request().method() === 'GET'
      && matches(url.searchParams);
  });
}

/**
 * Resolves when a moderation settings request with the given method
 * completes.
 *
 * @param page - Playwright page instance
 * @param method - GET for the page's load, PUT for a save
 */
function waitForSettingsRequest(page: Page, method: 'GET' | 'PUT'): Promise<Response> {
  return page.waitForResponse((response) => new URL(response.url()).pathname === SETTINGS_API
    && response.request().method() === method);
}

/**
 * Opens moderation settings and waits until the stored settings have
 * loaded into the form, so a field read or written afterwards is never
 * overwritten by the load.
 *
 * @param page - Playwright page instance
 */
async function gotoModerationSettings(page: Page): Promise<void> {
  const loaded = waitForSettingsRequest(page, 'GET');
  await gotoSettings(page, env.baseURL, adminLeaf('moderation/settings'));
  await loaded;
  await expect(page.locator('input#auto-escalation')).toBeVisible();
}

/**
 * Saves the moderation settings form and waits for the confirmation.
 *
 * @param page - Playwright page instance
 */
async function saveModerationSettings(page: Page): Promise<void> {
  const saved = waitForSettingsRequest(page, 'PUT');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('.message-success')).toHaveText('Settings saved successfully');
}

// Start server once for entire file
test.beforeAll(async () => {
  env = await startTestServer();

  const loginResponse = await axios.post(`${env.baseURL}/api/auth/v1/login`, {
    email: 'admin@pavillion.dev',
    password: 'admin',
  });
  adminToken = loginResponse.data;

  // Seed one admin-initiated report so the dashboard always lists a report
  // and the report-detail tests have something to open.
  seededReportId = await seedAdminReport(TEST_EVENT_ID, 'E2E seed: a report for the admin report-detail tests.');
});

/**
 * Opens the seeded report from the moderation dashboard's View Details
 * link and waits for the report detail page.
 */
async function openSeededReport(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'View Details' }).first().click();
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

    // Select Submitted, the seeded report's status; the list refetches with
    // the filter applied
    const filtered = waitForReportList(page, (params) => params.get('status') === 'submitted');
    await statusFilter.selectOption('submitted');
    expect((await filtered).ok()).toBe(true);

    // The seeded report is still listed under the filter
    await expect(statusFilter).toHaveValue('submitted');
    await expect(page.locator('table.reports-table').first()).toBeVisible();
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
    await gotoModerationSettings(page);

    // The loaded form replaces the loading message
    await expect(page.getByRole('heading', { name: 'Escalation Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Settings' })).toBeVisible();
  });

  test('should display IP retention settings', async ({ page }) => {
    await gotoModerationSettings(page);

    await expect(page.locator('input#ip-hash-retention')).toBeVisible();
    await expect(page.locator('input#ip-subnet-retention')).toBeVisible();
  });

  test('should display escalation threshold settings', async ({ page }) => {
    await gotoModerationSettings(page);

    await expect(page.locator('input#auto-escalation')).toBeVisible();
    await expect(page.locator('input#auto-escalation-threshold')).toBeVisible();
  });

  test('should update and save moderation settings', async ({ page }) => {
    await gotoModerationSettings(page);

    const autoEscalationField = page.locator('input#auto-escalation');
    const currentValue = await autoEscalationField.inputValue();
    const newValue = currentValue === '72' ? '48' : '72';

    await autoEscalationField.fill(newValue);
    await saveModerationSettings(page);

    await expect(autoEscalationField).toHaveValue(newValue);
  });

  test('should persist settings across page reload', async ({ page }) => {
    await gotoModerationSettings(page);

    const autoEscalationField = page.locator('input#auto-escalation');
    const testValue = '96';
    await autoEscalationField.fill(testValue);
    await saveModerationSettings(page);

    // Reload and wait for the stored settings to load back into the form
    const reloaded = waitForSettingsRequest(page, 'GET');
    await page.reload();
    await reloaded;
    await expect(autoEscalationField).toHaveValue(testValue);
  });

  test('should validate IP retention day inputs', async ({ page }) => {
    await gotoModerationSettings(page);

    const ipHashField = page.locator('input#ip-hash-retention');
    const originalValue = await ipHashField.inputValue();

    // Zero is below the field's minimum of one day, so the form refuses to
    // submit
    await ipHashField.fill('0');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    expect(await ipHashField.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);

    // Nothing was saved: the stored value survives a reload
    const reloaded = waitForSettingsRequest(page, 'GET');
    await page.reload();
    await reloaded;
    await expect(ipHashField).toHaveValue(originalValue);
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

    await page.getByRole('button', { name: 'Create Report' }).click();

    await expect(page.getByRole('dialog', { name: 'Create Admin Report' })).toBeVisible();
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
    const filtered = waitForReportList(page, (params) => params.get('status') === 'submitted');
    await statusFilter.selectOption('submitted');
    await filtered;

    // An active filter shows the reset button
    const resetButton = page.getByRole('button', { name: 'Reset Filters' });
    await expect(resetButton).toBeVisible();

    // Resetting refetches the unfiltered list and clears the select
    const unfiltered = waitForReportList(page, (params) => !params.has('status'));
    await resetButton.click();
    await unfiltered;

    await expect(statusFilter).toHaveValue('');
    await expect(resetButton).toBeHidden();
  });
});

test.describe('Admin Moderation Pagination', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should page through reports when more than one page exists', async ({ page }) => {
    // The dashboard lists 20 reports a page; with the beforeAll report, 20
    // more make a second page. An admin reports each event once, so each
    // report gets an event of its own. This is the file's last test, so the
    // extra reports cannot crowd the seeded one out of the earlier tests.
    // All events are created before any report: a report's flagged handler
    // runs after its response, and on the e2e server's single-connection
    // SQLite its transaction collides with an event creation's.
    const eventIds: string[] = [];
    for (let i = 1; i <= 20; i++) {
      eventIds.push(await seedEvent(`E2E pagination event ${i}`));
    }
    for (const [i, eventId] of eventIds.entries()) {
      await seedAdminReport(eventId, `E2E seed: pagination report ${i + 1}.`);
    }

    await gotoSettings(page, env.baseURL, adminLeaf('moderation'));

    const pagination = page.getByRole('navigation', { name: 'Report pagination' });
    await expect(pagination).toBeVisible();
    await expect(pagination).toContainText('Page 1 of 2');

    await pagination.getByRole('button', { name: 'Next' }).click();
    await expect(pagination).toContainText('Page 2 of 2');
    await expect(pagination.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
