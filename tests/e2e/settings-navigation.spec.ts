import { test, expect, type Page } from '@playwright/test';
import { MULTI_CALENDAR_USER, loginAsAdmin, loginViaUi } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  ADMIN_CALENDAR_URL_NAME,
  LOCAL_DOMAIN,
  TESTUSER_CALENDAR_URL_NAME,
  TESTUSER_EMAIL,
  TESTUSER_PASSWORD,
  seedNotificationFixtures,
  type NotificationFixtures,
} from './helpers/notification-fixtures';
import {
  DESKTOP,
  PHONE,
  SHELL_MD,
  UNRESOLVED_CALENDAR_TITLE,
  adminLeafPath,
  backLink,
  calendarIndex,
  calendarIndexPath,
  calendarLeaf,
  calendarLeafPath,
  calendarLoadingStatus,
  calendarReportPath,
  calendarSwitcherTrigger,
  emptyState,
  gotoSettings,
  historyLength,
  logOutButton,
  mainNav,
  mainNavLinkLabel,
  mobileNav,
  reportRegion,
  settingsLeaf,
  settingsPath,
  settingsRootList,
  settingsRow,
  settingsTitle,
  settingsTree,
} from './helpers/settings-nav';

/**
 * E2E Tests: settings navigation across the md breakpoint.
 *
 * Covers what only a real browser at a real width can prove: the phone
 * drill-down (root → section → leaf and back, with focus on each new h1),
 * the md+ forward from an index to its first leaf (a replace, so browser
 * Back leaves settings), the main nav collapsing to an icon rail whose links
 * keep their accessible names, resizing across the breakpoint in both
 * directions, the CSS and script breakpoints agreeing at 767/768, the legacy
 * `?tab=reports` link, and the unresolved-calendar index rendering the same
 * page for a non-member and a nonexistent calendar.
 *
 * Axe, heading and aria-current counts, keyboard order and reflow live in
 * the accessibility spec beside this one.
 *
 * Seeded actors: the admin owns test_calendar ("Test Calendar"); the test
 * user owns testuser_calendar; the multi-calendar user edits
 * testuser_calendar and is not a member of test_calendar.
 */

let env: TestEnvironment;
let fixtures: NotificationFixtures;

const ADMIN_CALENDAR_NAME = 'Test Calendar';
const NONEXISTENT_CALENDAR = 'no_such_calendar_e2e';

/** Rail width is --pav-shell-rail-width (4rem, 64px at the default root size); 1px of slack for the border. */
const RAIL_MAX_WIDTH = 65;

/** Full sidebar width is --pav-shell-sidebar-width (15rem, 240px); anything well over the rail. */
const FULL_SIDEBAR_MIN_WIDTH = 200;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer({ extraEnv: { LOCAL_DOMAIN } });
  // Seeds the owner report the legacy ?tab=reports&report= case opens.
  fixtures = await seedNotificationFixtures(env.baseURL);
});

test.afterAll(async () => {
  if (env?.cleanup) {
    await env.cleanup();
  }
});

/** A URL pattern matching the given settings path exactly, ignoring origin. */
function pathPattern(path: string): RegExp {
  return new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/** The rendered width of the main nav, in CSS pixels. */
async function mainNavWidth(page: Page): Promise<number> {
  const box = await mainNav(page).boundingBox();
  expect(box, 'main nav is rendered').not.toBeNull();
  return box!.width;
}

test.describe('phone drill-down', () => {
  test.use({ viewport: PHONE });

  test('root → section → leaf → back → back moves focus to each h1', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    const main = page.getByRole('main');

    await gotoSettings(page, env.baseURL, settingsRootList);
    await expect(page).toHaveURL(pathPattern(settingsPath.root));
    for (const row of ['Calendar', 'Account', 'Instance']) {
      await expect(settingsRow(main, row)).toBeVisible();
    }
    await expect(logOutButton(main)).toBeVisible();
    await expect(mobileNav(page)).toBeVisible();

    // Scoped to main: the bottom bar has its own "Calendar" link.
    await settingsRow(main, 'Calendar').click();
    await expect(page).toHaveURL(pathPattern(calendarIndexPath(ADMIN_CALENDAR_URL_NAME)));
    await expect(settingsTitle(page, ADMIN_CALENDAR_NAME)).toBeFocused();
    await expect(calendarSwitcherTrigger(page)).toBeVisible();
    await expect(mobileNav(page)).toBeVisible();

    await settingsRow(main, 'Editors').click();
    await expect(page).toHaveURL(pathPattern(calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'editors')));
    await expect(settingsTitle(page, 'Editors')).toBeFocused();
    await expect(mobileNav(page)).toBeVisible();

    await backLink(page, ADMIN_CALENDAR_NAME).click();
    await expect(page).toHaveURL(pathPattern(calendarIndexPath(ADMIN_CALENDAR_URL_NAME)));
    await expect(settingsTitle(page, ADMIN_CALENDAR_NAME)).toBeFocused();
    await expect(mobileNav(page)).toBeVisible();

    await backLink(page, 'Settings').click();
    await expect(page).toHaveURL(pathPattern(settingsPath.root));
    await expect(settingsTitle(page, 'Settings')).toBeFocused();
    await expect(mobileNav(page)).toBeVisible();
  });

  test('a cold-loaded leaf shows its back link, which goes to its section', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    await gotoSettings(page, env.baseURL, settingsLeaf.security);
    // Nothing takes focus on initial load.
    await expect(settingsTitle(page, 'Security')).not.toBeFocused();

    // The target comes from the route, not history: this tab never visited the account list.
    await backLink(page, 'Account').click();
    await expect(page).toHaveURL(pathPattern(settingsPath.account));
    await expect(settingsTitle(page, 'Account')).toBeVisible();
  });

  test('a non-admin root list has no Instance row', async ({ page }) => {
    await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);
    const main = page.getByRole('main');

    await gotoSettings(page, env.baseURL, settingsRootList);
    await expect(settingsRow(main, 'Account')).toBeVisible();
    await expect(settingsRow(main, 'Instance')).toHaveCount(0);
  });
});

test.describe('desktop forward', () => {
  test.use({ viewport: DESKTOP });

  test('/settings forwards to the first leaf with a replace, so Back leaves settings', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    const before = page.url();

    await gotoSettings(page, env.baseURL, { path: settingsPath.root, title: 'General' });
    await expect(page).toHaveURL(pathPattern(calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'general')));
    await expect(settingsTree(page)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(before);
    await expect(page).not.toHaveURL(/\/settings/);
  });

  test('every index forwards to its group\'s first leaf', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    const forwards: Array<[string, string]> = [
      [settingsPath.account, settingsPath.profile],
      [settingsPath.admin, adminLeafPath('settings')],
      [calendarIndexPath(ADMIN_CALENDAR_URL_NAME), calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'general')],
    ];
    for (const [index, leaf] of forwards) {
      await page.goto(env.baseURL + index);
      await expect(page).toHaveURL(pathPattern(leaf));
      await expect(settingsTree(page)).toBeVisible();
    }
  });

  test('an editor\'s calendar index forwards to Editors', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);

    await gotoSettings(page, env.baseURL, {
      path: calendarIndexPath(TESTUSER_CALENDAR_URL_NAME),
      title: 'Editors',
    });
    await expect(page).toHaveURL(pathPattern(calendarLeafPath(TESTUSER_CALENDAR_URL_NAME, 'editors')));
  });
});

test.describe('icon rail', () => {
  test.use({ viewport: DESKTOP });

  test('rail links keep their accessible names without drawing their labels', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, settingsLeaf.profile);

    const nav = mainNav(page);
    const links = [
      nav.getByRole('link', { name: 'Calendar', exact: true }),
      nav.getByRole('link', { name: 'Feed', exact: true }),
      nav.getByRole('link', { name: /^Inbox/ }),
      nav.getByRole('link', { name: 'Settings', exact: true }),
    ];
    for (const link of links) {
      await expect(link).toBeVisible();
      const labelBox = await mainNavLinkLabel(link).boundingBox();
      expect(labelBox, 'label stays in the DOM').not.toBeNull();
      expect(labelBox!.width, 'label is visually hidden').toBeLessThanOrEqual(1);
      expect(labelBox!.height, 'label is visually hidden').toBeLessThanOrEqual(1);
    }
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await mainNavWidth(page)).toBeLessThanOrEqual(RAIL_MAX_WIDTH);

    // Control: the rail is route-driven, so off settings the sidebar is full width with drawn labels.
    await page.goto(env.baseURL + `/calendar/${ADMIN_CALENDAR_URL_NAME}`);
    await expect(nav.getByRole('link', { name: 'Calendar', exact: true })).toBeVisible();
    await expect.poll(() => mainNavWidth(page)).toBeGreaterThan(FULL_SIDEBAR_MIN_WIDTH);
    const drawnLabel = await mainNavLinkLabel(nav.getByRole('link', { name: 'Settings', exact: true })).boundingBox();
    expect(drawnLabel!.width).toBeGreaterThan(1);
  });
});

test.describe('resize across md', () => {
  test('phone → desktop on an index forwards once, with a replace', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsAdmin(page, env.baseURL);
    const before = page.url();

    await gotoSettings(page, env.baseURL, settingsRootList);
    const length = await historyLength(page);

    await page.setViewportSize(DESKTOP);
    await expect(page).toHaveURL(pathPattern(calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'general')));
    await expect(settingsTree(page)).toBeVisible();
    await expect(settingsTitle(page, 'General')).toBeVisible();
    expect(await historyLength(page)).toBe(length);

    await page.goBack();
    await expect(page).toHaveURL(before);
  });

  test('desktop → phone on a leaf keeps the leaf and shows its back link', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page, env.baseURL);
    const editors = calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'editors');

    await gotoSettings(page, env.baseURL, editors);
    await expect(settingsTree(page)).toBeVisible();

    // Not asserted: tree.vue's viewport watch means to move focus from the
    // hiding tree to the h1, but Chromium has already dropped focus to the
    // body by the time the matchMedia change fires, so the watch never sees
    // focus inside the tree.
    await page.setViewportSize(PHONE);
    await expect(backLink(page, ADMIN_CALENDAR_NAME)).toBeVisible();
    await expect(page).toHaveURL(pathPattern(editors.path));
    await expect(settingsTitle(page, 'Editors')).toBeVisible();
    await expect(settingsTree(page)).toHaveCount(0);
  });

  test('CSS and script agree on either side of the breakpoint', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    // Below md: the root list stays, the bottom bar shows, the rail does not.
    await page.setViewportSize({ width: SHELL_MD - 1, height: DESKTOP.height });
    await gotoSettings(page, env.baseURL, settingsRootList);
    await expect(page).toHaveURL(pathPattern(settingsPath.root));
    await expect(settingsRow(page.getByRole('main'), 'Account')).toBeVisible();
    await expect(mobileNav(page)).toBeVisible();
    await expect(mainNav(page)).toBeHidden();

    // At md: the script forwards and the CSS shows the tree and the rail.
    await page.setViewportSize({ width: SHELL_MD, height: DESKTOP.height });
    await page.goto(env.baseURL + settingsPath.root);
    await expect(page).toHaveURL(pathPattern(calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'general')));
    await expect(settingsTree(page)).toBeVisible();
    await expect(mainNav(page)).toBeVisible();
    await expect(mobileNav(page)).toBeHidden();
    expect(await mainNavWidth(page)).toBeLessThanOrEqual(RAIL_MAX_WIDTH);
  });
});

// The legacy query form dies with its redirect (follow-up pv-y5xy); delete these cases with it.
for (const [label, viewport] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
  test.describe(`legacy ?tab=reports link (${label})`, () => {
    test.use({ viewport });

    test('tab=reports&report= opens the report detail and drops the query', async ({ page }) => {
      await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);
      const index = calendarIndexPath(TESTUSER_CALENDAR_URL_NAME);

      await page.goto(`${env.baseURL}${index}?tab=reports&report=${fixtures.ownedReportId}`);
      await expect(page).toHaveURL(env.baseURL + calendarReportPath(TESTUSER_CALENDAR_URL_NAME, fixtures.ownedReportId));
      await expect(reportRegion(page)).toBeVisible({ timeout: 10000 });
      await expect(reportRegion(page)).toBeFocused();

      await page.goto(`${env.baseURL}${index}?tab=reports`);
      await expect(page).toHaveURL(env.baseURL + calendarLeafPath(TESTUSER_CALENDAR_URL_NAME, 'reports'));
      await expect(settingsTitle(page, 'Reports')).toBeVisible();
    });
  });
}

// Desktop first: a wrong forward from the index would leak there.
for (const [label, viewport] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test.describe(`unresolved calendar index (${label})`, () => {
    test.use({ viewport });

    test('a non-member and a nonexistent calendar render the same page at the unchanged URL', async ({ page }) => {
      await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);
      const main = page.getByRole('main');

      const snapshots: string[] = [];
      for (const calendar of [ADMIN_CALENDAR_URL_NAME, NONEXISTENT_CALENDAR]) {
        const index = calendarIndex(calendar, UNRESOLVED_CALENDAR_TITLE);
        await gotoSettings(page, env.baseURL, index);
        await expect(emptyState(main)).toBeVisible();
        await expect(page).toHaveURL(pathPattern(index.path));
        await expect(calendarSwitcherTrigger(page)).toHaveCount(0);
        await expect(calendarLoadingStatus(page)).toHaveCount(0);
        if (viewport === PHONE) {
          await expect(backLink(page, 'Settings')).toBeVisible();
        }
        snapshots.push(await main.ariaSnapshot());
      }

      expect(snapshots[1]).toBe(snapshots[0]);
      for (const snapshot of snapshots) {
        expect(snapshot).not.toContain(ADMIN_CALENDAR_URL_NAME);
        expect(snapshot).not.toContain(NONEXISTENT_CALENDAR);
      }
    });
  });
}
