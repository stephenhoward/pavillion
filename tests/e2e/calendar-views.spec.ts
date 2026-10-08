import { test, expect, Page } from '@playwright/test';
import { DateTime } from 'luxon';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: list / week / month view switcher on the public calendar page.
 *
 * The switcher's options follow the width of the calendar page, not a fixed
 * device: wide (>= 1024px) offers list, week and month; medium offers list and
 * month; narrow offers only the list and hides the switcher. A view the width
 * cannot show is displayed as the list while the URL keeps the visitor's
 * choice, so widening the window restores it.
 *
 * Assertions are about grid structure, the switcher and the URL rather than
 * event presence: the seeded events are not pinned to the month a test run
 * lands in, so asserting on event chips would make these tests date-dependent.
 *
 * No login required — anonymous public access.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer();
});

test.afterAll(async () => {
  if (env?.cleanup) {
    await env.cleanup();
  }
});

/** The URL's query parameters, as a plain object. */
function queryOf(page: Page): Record<string, string> {
  return Object.fromEntries(new URL(page.url()).searchParams);
}

function viewRadio(page: Page, name: 'List' | 'Week' | 'Month') {
  return page.getByRole('radiogroup', { name: 'Calendar view' }).getByRole('radio', { name });
}

const periodLabel = (page: Page) => page.locator('.ui-view-toolbar__label');
const dateControls = (page: Page) => page.locator('.date-range-section');

async function openCalendar(page: Page, query = '') {
  await page.goto(`${env.baseURL}/test_calendar${query}`);
  await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
}

test.describe('Calendar view switcher at 1280px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('switches to month, steps periods, and survives a reload', async ({ page }) => {
    await openCalendar(page);
    await expect(dateControls(page)).toBeVisible();

    await viewRadio(page, 'Month').click();

    await expect(page).toHaveURL(/[?&]view=month/);
    const today = DateTime.now();
    expect(queryOf(page).date).toBe(today.toISODate());
    await expect(page.locator('.month-view')).toBeVisible();
    await expect(dateControls(page)).toHaveCount(0);
    await expect(periodLabel(page)).toHaveText(today.toLocaleString({ month: 'long', year: 'numeric' }, { locale: 'en' }));

    await page.getByRole('button', { name: 'Next', exact: true }).click();

    const nextMonth = today.plus({ months: 1 });
    const nextLabel = nextMonth.toLocaleString({ month: 'long', year: 'numeric' }, { locale: 'en' });
    await expect(periodLabel(page)).toHaveText(nextLabel);
    await expect(page).toHaveURL(new RegExp(`[?&]date=${nextMonth.toISODate()}`));

    await page.reload();

    await expect(page.locator('.month-view')).toBeVisible({ timeout: 15000 });
    await expect(periodLabel(page)).toHaveText(nextLabel);
    await expect(viewRadio(page, 'Month')).toHaveAttribute('aria-checked', 'true');
  });

  test('shows the week view', async ({ page }) => {
    await openCalendar(page);

    await viewRadio(page, 'Week').click();

    await expect(page).toHaveURL(/[?&]view=week/);
    await expect(page.locator('.week-view')).toBeVisible();
    await expect(page.locator('.week-day-column')).toHaveCount(7);
    await expect(dateControls(page)).toHaveCount(0);
  });

  test('narrowing shows the list without the switcher and keeps the month in the URL', async ({ page }) => {
    await openCalendar(page, '?view=month');
    await expect(page.locator('.month-view')).toBeVisible();

    await page.setViewportSize({ width: 500, height: 900 });

    await expect(page.locator('.month-view')).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Calendar view' })).toHaveCount(0);
    await expect(page.locator('section.day-section, .empty-state').first()).toBeVisible();
    expect(queryOf(page).view).toBe('month');

    await page.setViewportSize({ width: 1280, height: 900 });

    await expect(page.locator('.month-view')).toBeVisible();
    await expect(viewRadio(page, 'Month')).toHaveAttribute('aria-checked', 'true');
  });

  test('returning to the list restores the date controls and drops the date', async ({ page }) => {
    await openCalendar(page, '?view=month');
    await expect(page.locator('.month-view')).toBeVisible();

    await viewRadio(page, 'List').click();

    await expect(dateControls(page)).toBeVisible();
    await expect(page.locator('.month-view')).toHaveCount(0);
    await expect.poll(() => queryOf(page)).toEqual({});
  });

  test('a day number opens the list filtered to that day', async ({ page }) => {
    const anchor = DateTime.now().startOf('month');
    await openCalendar(page, `?view=month&date=${anchor.toISODate()}`);
    await expect(page.locator('.month-view')).toBeVisible();

    // The first in-month cell is the 1st; padding days are not links.
    await page.locator('.month-day-cell:not(.is-other-month) a.day-number').first().click();

    const day = anchor.toISODate();
    await expect.poll(() => queryOf(page)).toEqual({ startDate: day, endDate: day });
    await expect(page.locator('.month-view')).toHaveCount(0);
    await expect(dateControls(page)).toBeVisible();
    await expect(viewRadio(page, 'List')).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('Calendar view switcher at 800px', () => {
  test('offers list and month only', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openCalendar(page);

    const group = page.getByRole('radiogroup', { name: 'Calendar view' });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group.getByRole('radio', { name: 'List' })).toBeVisible();
    await expect(group.getByRole('radio', { name: 'Month' })).toBeVisible();
    await expect(group.getByRole('radio', { name: 'Week' })).toHaveCount(0);
  });
});
