import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { MULTI_CALENDAR_USER, loginAsAdmin, loginAsFreshUser, loginViaUi } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  DESKTOP,
  PHONE,
  SWITCHER_DESCRIPTION,
  WCAG_TAGS,
  adminLeaf,
  adminLeafPath,
  backLink,
  calendarLeaf,
  calendarSwitcherTrigger,
  gotoSettings,
  settingsAdminIndex,
  settingsList,
  settingsPath,
  settingsRow,
  settingsTitle,
  settingsTree,
} from './helpers/settings-nav';

/**
 * E2E Tests: calendar switcher, and its place in the settings layout
 *
 * Covers what the unit tier cannot: the bare-route guards resolving against
 * the real calendar list and persisted last-used calendar, the switcher sheet
 * navigating between real routes (in settings it sits in the page header of a
 * calendar leaf and keeps the viewer on the same leaf), and the settings
 * layout at real viewport widths.
 *
 * Tests run serially on one server. Order matters: the fresh user reaches
 * account settings from the nav only while they own no calendar, so that test
 * runs before the one that creates their first calendar.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

/**
 * Open the calendar switcher and return the rows that link to another
 * calendar. These tests start on a last-used calendar, so the trigger is
 * found without its name.
 */
async function openSwitcherLinkRows(page: Page) {
  await calendarSwitcherTrigger(page).click();
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
    const targetName = (await rows.first().locator('.calendar-switcher-sheet__name').innerText()).trim();
    await rows.first().getByRole('link').click();

    await expect(page).toHaveURL(new RegExp(`/feed/${target}$`));
    expect(page.url()).not.toBe(startUrl);
    await expect(page.getByRole('dialog', { name: 'Switch calendar' })).toBeHidden();
    await expect(calendarSwitcherTrigger(page, targetName)).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Feed', exact: true }).filter({ visible: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('a bare /calendar visit lands on the last-used calendar', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);

    await page.goto(env.baseURL + '/calendar');
    await expect(page).toHaveURL(/\/calendar\/[^/]+$/);
    const startUrlName = new URL(page.url()).pathname.split('/').pop();

    const rows = await openSwitcherLinkRows(page);
    const target = await rows.first().getAttribute('data-url-name');
    expect(target).not.toBe(startUrlName);
    await rows.first().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${target}$`));

    // Each goto is a full page load that starts the SPA afresh, so the bare
    // route resolves from the persisted last-used calendar rather than from
    // in-memory state — and keeps resolving there on the next visit.
    await page.goto(env.baseURL + '/calendar');
    await expect(page).toHaveURL(new RegExp(`/calendar/${target}$`));
    await page.goto(env.baseURL + '/calendar');
    await expect(page).toHaveURL(new RegExp(`/calendar/${target}$`));
  });

  test('a fresh user reaches account settings from the nav', async ({ page }) => {
    await loginAsFreshUser(page, env.baseURL);
    await expect(page).toHaveURL(/\/calendar$/);

    await page.getByRole('link', { name: 'Settings', exact: true }).filter({ visible: true }).click();

    // At desktop width the settings root forwards a user with no calendar
    // to the first Account leaf.
    await expect(page).toHaveURL(/\/settings\/account\/profile$/);
    await expect(settingsTitle(page, 'Profile')).toBeVisible();
    await expect(settingsTree(page)).toBeVisible();
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
    // With one calendar the switcher is named by the calendar and describes nothing.
    const trigger = calendarSwitcherTrigger(page, 'Switcher Fresh');
    await expect(trigger).toBeVisible();
    await expect(trigger).not.toHaveAttribute('aria-describedby');
    await expect(trigger).toHaveAccessibleDescription('');
  });

  test('switching calendar on a settings leaf stays on the same leaf', async ({ page }) => {
    // MultiCalendar owns multicalendar_calendar and edits testuser_calendar;
    // Widget is visible to owner and editor alike.
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);
    await gotoSettings(page, env.baseURL, calendarLeaf('multicalendar_calendar', 'widget'));

    const rows = await openSwitcherLinkRows(page);
    // The sheet lists calendars only: Account and Instance live in the tree.
    await expect(page.getByTestId('switcher-account')).toHaveCount(0);
    await expect(page.getByTestId('switcher-admin')).toHaveCount(0);

    await rows.and(page.locator('[data-url-name="testuser_calendar"]')).getByRole('link').click();

    await expect(page).toHaveURL(/\/settings\/calendar\/testuser_calendar\/widget$/);
    await expect(settingsTitle(page, 'Widget')).toBeVisible();
  });

  test('switching from an owner-only leaf to a calendar the viewer edits lands on its first visible leaf', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);
    await gotoSettings(page, env.baseURL, calendarLeaf('multicalendar_calendar', 'general'));

    const rows = await openSwitcherLinkRows(page);
    await rows.and(page.locator('[data-url-name="testuser_calendar"]')).getByRole('link').click();

    await expect(page).toHaveURL(/\/settings\/calendar\/testuser_calendar\/widget$/);
    await expect(settingsTitle(page, 'Widget')).toBeVisible();
  });

  test('the instance settings are reachable at desktop width inside one main landmark', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page, env.baseURL);

    await gotoSettings(page, env.baseURL, adminLeaf('settings'));
    await expect(page.getByRole('main')).toHaveCount(1);

    const accountsRow = settingsRow(settingsTree(page), 'Accounts');
    await accountsRow.click();
    await expect(page).toHaveURL(new RegExp(`${adminLeafPath('accounts')}$`));
    await expect(accountsRow).toHaveAttribute('aria-current', 'page');
  });

  test('the instance settings are reachable at mobile width inside one main landmark', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsAdmin(page, env.baseURL);

    await gotoSettings(page, env.baseURL, adminLeaf('settings'));
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(settingsTree(page)).toBeHidden();

    await backLink(page, settingsAdminIndex.title).click();
    await expect(page).toHaveURL(new RegExp(`${settingsPath.admin}$`));
    await expect(settingsTitle(page, settingsAdminIndex.title)).toBeVisible();

    await settingsRow(settingsList(page), 'Accounts').click();
    await expect(page).toHaveURL(new RegExp(`${adminLeafPath('accounts')}$`));
    await expect(settingsTitle(page, 'Accounts')).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
  });

  // One control everywhere: the calendar's name and a chevron, named by the
  // calendar alone and, for a viewer with several calendars, described as a
  // switcher, opening a sheet whose type does not inherit from its host (an
  // h1's size, the settings eyebrow's uppercase).
  test('every switcher is the calendar name and a chevron, and opens the same sheet', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);
    const calendar = 'multicalendar_calendar';
    const hosts = [
      { viewport: PHONE, path: `/calendar/${calendar}`, inH1: true },
      { viewport: PHONE, path: `/feed/${calendar}`, inH1: true },
      { viewport: PHONE, path: `/settings/calendar/${calendar}`, inH1: true },
      { viewport: DESKTOP, path: `/calendar/${calendar}`, inH1: true },
      { viewport: DESKTOP, path: `/settings/calendar/${calendar}/widget`, inH1: false },
    ];
    const sheetLook: Record<number, string> = {};

    for (const host of hosts) {
      await page.setViewportSize(host.viewport);
      await page.goto(env.baseURL + host.path);
      const trigger = calendarSwitcherTrigger(page).filter({ visible: true });
      await expect(trigger, host.path).toHaveCount(1);

      const name = (await trigger.locator('.calendar-switcher__label').textContent())?.trim() ?? '';
      expect(name, host.path).not.toBe('');
      await expect(trigger, host.path).toHaveAccessibleName(name);
      await expect(trigger, host.path).toHaveAccessibleDescription(SWITCHER_DESCRIPTION);
      await expect(trigger, host.path).toHaveText(name);
      await expect(trigger.locator('svg'), host.path).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 }).locator('button.calendar-switcher'), host.path)
        .toHaveCount(host.inH1 ? 1 : 0);

      await trigger.click();
      const sheet = page.getByRole('dialog', { name: 'Switch calendar' });
      await expect(sheet).toBeVisible();
      const look = await sheet.getByTestId('switcher-row').first().evaluate((row) => {
        const style = getComputedStyle(row);
        return [style.fontSize, style.fontWeight, style.textTransform, style.letterSpacing].join(' ');
      });
      sheetLook[host.viewport.width] ??= look;
      expect(look, host.path).toBe(sheetLook[host.viewport.width]);

      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(trigger, host.path).toBeFocused();
    }
  });

  test('the open calendar switcher sheet has no axe violations', async ({ page }) => {
    // This user's sheet has a current row, a link row and an Editor badge.
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);

    await page.goto(env.baseURL + '/calendar');
    await openSwitcherLinkRows(page);
    await expect(page.getByTestId('switcher-row').getByText('Editor', { exact: true })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('dialog.calendar-switcher-sheet')
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
