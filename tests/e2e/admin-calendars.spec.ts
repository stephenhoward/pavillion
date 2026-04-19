import { test, expect, Page } from '@playwright/test';
import axios from 'axios';

import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Admin Calendars Listing Page
 *
 * Covers the cross-domain admin calendars dashboard (/admin/calendars):
 * 1. Listing behavior — search, open-reports toggle, sort dropdown
 * 2. Badge navigation — clicking an open-report badge lands on the
 *    moderation dashboard filtered by that calendar.
 *
 * Uses an isolated test server with in-memory database and the
 * standard development seed data (which includes test_calendar and
 * several events). An admin-initiated report is seeded via the
 * admin reports API during beforeAll so at least one calendar has
 * open reports for the badge navigation test.
 */

// Seeded constants from layouts/development/db/
const TEST_CALENDAR_URL_NAME = 'test_calendar';
const TEST_CALENDAR_ID = 'c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3';
const TEST_EVENT_ID = '37d1bb5a-452b-432e-ac46-268b9c565bde';

let env: TestEnvironment;
let adminJWT: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer();

  // Get admin JWT for seeding an open report via the API
  const loginResponse = await axios.post(`${env.baseURL}/api/auth/v1/login`, {
    email: 'admin@pavillion.dev',
    password: 'admin',
  });
  adminJWT = loginResponse.data;

  // Seed one admin-initiated report against a seeded event so the
  // target calendar has a nonzero openReportCount. Admin reports
  // skip email verification and are created in 'submitted' state.
  await axios.post(
    `${env.baseURL}/api/v1/admin/reports`,
    {
      eventId: TEST_EVENT_ID,
      category: 'spam',
      description: 'E2E seed: calendar has an open report for badge navigation coverage.',
      priority: 'medium',
      adminNotes: 'Seeded by admin-calendars.spec.ts',
    },
    { headers: { Authorization: `Bearer ${adminJWT}` } },
  );
});

test.afterAll(async () => {
  if (env?.cleanup) {
    await env.cleanup();
  }
});

/**
 * Navigates to the admin calendars dashboard and waits for the
 * filter controls to render.
 */
async function gotoAdminCalendars(page: Page): Promise<void> {
  await page.goto(env.baseURL + '/admin/calendars');
  await page.waitForSelector('h1', { timeout: 10000 });
  await page.waitForSelector('input#search-filter', { timeout: 10000 });
  // Wait for the initial load to settle (either rows or empty state).
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="calendar-row"]').length > 0
      || !!document.querySelector('.empty-state'),
    null,
    { timeout: 10000 },
  );
}

test.describe('Admin Calendars Listing behavior', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should show seeded calendars with event counts and last-activity dates', async ({ page }) => {
    await gotoAdminCalendars(page);

    // Page heading reflects the calendars dashboard translation.
    await expect(page.locator('h1')).toContainText(/Local Calendars/i);

    // Seeded calendars are visible in the table.
    const rows = page.locator('[data-testid="calendar-row"]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Expect our known seed calendar to be in the list.
    const testCalendarRow = rows.filter({ hasText: TEST_CALENDAR_URL_NAME }).first();
    await expect(testCalendarRow).toBeVisible();

    // Each row exposes event count and last-activity cells.
    const firstEventCount = rows.first().locator('.cell-event-count');
    const firstLastActivity = rows.first().locator('.cell-last-activity');
    await expect(firstEventCount).toBeVisible();
    await expect(firstLastActivity).toBeVisible();

    // Event count cell should contain a numeric value.
    const eventCountText = (await firstEventCount.textContent())?.trim() ?? '';
    expect(eventCountText).toMatch(/^\d+$/);

    // Last-activity cell should be non-empty (either a date or the em-dash "never" fallback).
    const lastActivityText = (await firstLastActivity.textContent())?.trim() ?? '';
    expect(lastActivityText.length).toBeGreaterThan(0);
  });

  test('should filter the list live when searching by partial urlName', async ({ page }) => {
    await gotoAdminCalendars(page);

    const rows = page.locator('[data-testid="calendar-row"]');
    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(0);

    // Type a partial urlName that matches test_calendar (and testuser_calendar),
    // but excludes chain_* and multicalendar_calendar.
    const searchInput = page.locator('input#search-filter');
    await searchInput.fill('test');

    // Debounced search (300ms) — wait for the filtered list to settle.
    await expect
      .poll(
        async () => {
          const count = await rows.count();
          if (count === 0) return null;
          const texts = await rows.allTextContents();
          return texts.every(t => /test/i.test(t)) ? count : null;
        },
        { timeout: 5000 },
      )
      .not.toBeNull();

    // All remaining rows should match the search term.
    const filteredTexts = await rows.allTextContents();
    for (const text of filteredTexts) {
      expect(text.toLowerCase()).toContain('test');
    }
  });

  test('should narrow the list when the hasOpenReports toggle is enabled', async ({ page }) => {
    await gotoAdminCalendars(page);

    const rows = page.locator('[data-testid="calendar-row"]');
    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(0);

    // Toggle "Only calendars with open reports".
    const openReportsCheckbox = page
      .locator('label.filter-checkbox-label')
      .filter({ hasText: /open reports/i })
      .locator('input[type="checkbox"]');
    await openReportsCheckbox.check();

    // Wait for the list to update. The filtered count should be <= initial,
    // and every remaining row must expose an open-reports badge button.
    await expect
      .poll(
        async () => {
          const count = await rows.count();
          if (count === 0) return null;
          const badges = page.locator('[data-testid="open-reports-badge"]');
          const badgeCount = await badges.count();
          return badgeCount === count ? count : null;
        },
        { timeout: 5000 },
      )
      .not.toBeNull();

    const filteredCount = await rows.count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    expect(filteredCount).toBeGreaterThan(0);

    const badges = page.locator('[data-testid="open-reports-badge"]');
    expect(await badges.count()).toBe(filteredCount);
  });

  test('should cycle the sort dropdown through created, lastActivity, and eventCount', async ({ page }) => {
    await gotoAdminCalendars(page);

    const sortBy = page.locator('select#sort-by-filter');
    await expect(sortBy).toBeVisible();

    // Default sort should be lastActivity (per store defaults).
    await expect(sortBy).toHaveValue('lastActivity');

    const rows = page.locator('[data-testid="calendar-row"]');

    // Cycle through each sort option and verify the list reloads successfully.
    for (const value of ['created', 'lastActivity', 'eventCount'] as const) {
      await sortBy.selectOption(value);
      await expect(sortBy).toHaveValue(value);

      // Wait for the list to settle (rows rendered without errors).
      await expect
        .poll(async () => await rows.count(), { timeout: 5000 })
        .toBeGreaterThan(0);

      // No error banner should appear.
      const errorBanner = page.locator('.error-message').first();
      expect(await errorBanner.isVisible().catch(() => false)).toBeFalsy();
    }
  });
});

test.describe('Admin Calendars Badge navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should navigate to /admin/moderation?calendar_id=<id> when clicking a nonzero open-report badge', async ({ page }) => {
    await gotoAdminCalendars(page);

    // Find a row that has an open-reports badge (seeded via beforeAll).
    const badges = page.locator('[data-testid="open-reports-badge"]');
    await expect(badges.first()).toBeVisible({ timeout: 10000 });
    const badgeCount = await badges.count();
    expect(badgeCount).toBeGreaterThan(0);

    // The seeded report is on test_calendar — find its badge specifically
    // so we can assert the query parameter value.
    const testCalendarRow = page
      .locator('[data-testid="calendar-row"]')
      .filter({ hasText: TEST_CALENDAR_URL_NAME })
      .first();
    const testCalendarBadge = testCalendarRow
      .locator('[data-testid="open-reports-badge"]');
    await expect(testCalendarBadge).toBeVisible();

    await testCalendarBadge.click();

    // URL should include the moderation path + calendar_id query param.
    await page.waitForURL(/\/admin\/moderation\?.*calendar_id=/, { timeout: 10000 });
    const url = new URL(page.url());
    expect(url.pathname).toMatch(/\/admin\/moderation$/);
    expect(url.searchParams.get('calendar_id')).toBe(TEST_CALENDAR_ID);

    // The moderation dashboard should render successfully under that URL.
    await page.waitForSelector('h1', { timeout: 10000 });
    await expect(page.locator('h1').first()).toContainText(/Moderation/i);
  });
});
