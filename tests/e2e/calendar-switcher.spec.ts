import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin, loginAsFreshUser } from './helpers/auth';
import { loginViaUi } from './helpers/notification-fixtures';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: calendar switcher and the settings root
 *
 * Covers what the unit tier cannot: the bare-route guards resolving against
 * the real calendar list and persisted last-used calendar, the switcher sheet
 * navigating between real routes, and the settings shell's layout at real
 * viewport widths.
 *
 * Tests run serially on one server. Order matters: the fresh user reaches
 * account settings from the nav only while they own no calendar, so that test
 * runs before the one that creates their first calendar.
 */

/**
 * Seeded user that owns multicalendar_calendar and edits testuser_calendar,
 * so its switcher has a row to switch to. The admin owns one calendar only.
 */
const MULTI_CALENDAR_USER = {
  email: 'multicalendar@example.com',
  password: 'test',
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

/** Open the calendar switcher and return the rows that link to another calendar. */
async function openSwitcherLinkRows(page: Page) {
  await page.getByRole('button', { name: /Switch calendar/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Switch calendar' });
  await expect(sheet).toBeVisible();
  const rows = sheet.getByTestId('switcher-row').filter({ has: page.getByRole('link') });
  await expect(rows.first()).toBeVisible();
  return rows;
}

test.describe('Calendar switcher', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('switching calendar from the feed stays on the feed', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);

    await page.goto(env.baseURL + '/feed');
    await expect(page).toHaveURL(/\/feed\/[^/]+$/);
    const startUrl = page.url();

    const rows = await openSwitcherLinkRows(page);
    const target = await rows.first().getAttribute('data-url-name');
    await rows.first().getByRole('link').click();

    await expect(page).toHaveURL(new RegExp(`/feed/${target}$`));
    expect(page.url()).not.toBe(startUrl);
    await expect(page.getByRole('dialog', { name: 'Switch calendar' })).toBeHidden();
    await expect(
      page.getByRole('link', { name: 'Feed', exact: true }).filter({ visible: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('a bare /calendar visit lands on the last-used calendar', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);

    await page.goto(env.baseURL + '/calendar');
    await expect(page).toHaveURL(/\/calendar\/[^/]+$/);

    const rows = await openSwitcherLinkRows(page);
    const target = await rows.first().getAttribute('data-url-name');
    await rows.first().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${target}$`));

    // A full page load starts the SPA afresh, so the guard resolves from the
    // persisted last-used calendar rather than in-memory state.
    await page.goto(env.baseURL + '/calendar');
    await expect(page).toHaveURL(new RegExp(`/calendar/${target}$`));
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/calendar/${target}$`));
  });

  test('a fresh user reaches account settings from the nav', async ({ page }) => {
    await loginAsFreshUser(page, env.baseURL);
    await expect(page).toHaveURL(/\/calendar$/);

    await page.getByRole('link', { name: 'Settings', exact: true }).filter({ visible: true }).click();

    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(page.getByRole('button', { name: /Switch settings/ })).toContainText('Account');
  });

  test('a fresh user creates a calendar from the empty state', async ({ page }) => {
    await loginAsFreshUser(page, env.baseURL);
    await expect(page).toHaveURL(/\/calendar$/);

    await page.getByRole('button', { name: 'Create Your Calendar' }).click();
    const sheet = page.getByRole('dialog', { name: 'Create New Calendar' });
    await sheet.getByLabel('Calendar Title').fill('Switcher Fresh');
    await sheet.getByLabel('Calendar Name').fill('switcher_fresh');
    await sheet.getByRole('button', { name: 'Create Your Calendar' }).click();

    await expect(page).toHaveURL(/\/calendar\/switcher_fresh$/);
    await expect(page.getByRole('button', { name: /Switch calendar/ })).toContainText('Switcher Fresh');
  });

  test('the settings switcher reaches Account and Instance administration', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    await page.goto(env.baseURL + '/settings');
    await expect(page).toHaveURL(/\/settings\/calendar\/test_calendar$/);

    await page.getByRole('button', { name: /Switch settings/ }).click();
    await page.getByTestId('switcher-account').getByRole('link').click();
    await expect(page).toHaveURL(/\/settings\/account$/);

    await page.getByRole('button', { name: /Switch settings/ }).click();
    await page.getByTestId('switcher-admin').getByRole('link').click();
    await expect(page).toHaveURL(/\/settings\/admin\/settings$/);
    await expect(page.getByRole('button', { name: /Switch settings/ })).toContainText('Instance administration');
  });

  for (const viewport of [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'mobile', width: 390, height: 844 },
  ]) {
    test(`the admin navigation is usable at ${viewport.label} width inside one main landmark`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginAsAdmin(page, env.baseURL);

      await page.goto(env.baseURL + '/settings/admin/settings');
      await expect(page.getByRole('main')).toHaveCount(1);

      const adminNav = page.getByRole('navigation', { name: 'Instance administration' });
      await expect(adminNav).toBeVisible();
      const accountsLink = adminNav.getByRole('link', { name: 'Accounts' });
      await expect(accountsLink).toBeVisible();

      await accountsLink.click();
      await expect(page).toHaveURL(/\/settings\/admin\/accounts$/);
      await expect(accountsLink).toHaveAttribute('aria-current', 'page');
    });
  }

  test('the open switcher sheet has no axe violations', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    await page.goto(env.baseURL + '/calendar');
    await expect(page).toHaveURL(/\/calendar\/test_calendar$/);
    await page.getByRole('button', { name: /Switch calendar/ }).click();
    await expect(page.getByRole('dialog', { name: 'Switch calendar' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('dialog.calendar-switcher-sheet')
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
