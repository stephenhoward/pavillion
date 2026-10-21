import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import axios from 'axios';
import { MULTI_CALENDAR_USER, loginAsAdmin, loginViaUi } from './helpers/auth';
import type { Theme } from './helpers/color-mode';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  ADMIN_CALENDAR_ID,
  ADMIN_CALENDAR_URL_NAME,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  LOCAL_DOMAIN,
  TESTUSER_CALENDAR_URL_NAME,
  TESTUSER_EMAIL,
  TESTUSER_PASSWORD,
  loginViaApi,
  seedNotificationFixtures,
  type NotificationFixtures,
} from './helpers/notification-fixtures';
import {
  DESKTOP,
  PHONE,
  accountCalendarLeaveButton,
  accountCalendarRow,
  confirmLeaveButton,
  SHELL_MD,
  UNRESOLVED_CALENDAR_TITLE,
  WCAG_TAGS,
  adminLeaf,
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
  expectNoHorizontalScroll,
  gotoSettings,
  helpButton,
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
  settingsRowChevron,
  settingsContent,
  shellSkipLink,
  settingsTitle,
  settingsTree,
  treeSkipControl,
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
 * The accessibility half: axe scans of the representative states in both
 * colour schemes, one h1 and one current item per list in every state, the
 * keyboard order rail → tree → content with both skip controls, and reflow
 * (no sideways overflow at 320px, at 200% text at md+, in a short landscape
 * window, or on the widest leaves at 768 and 900px).
 *
 * Seeded actors: the admin owns test_calendar ("Test Calendar"); the test
 * user owns testuser_calendar; the multi-calendar user owns
 * multicalendar_calendar, edits testuser_calendar and is not a member of
 * test_calendar (the account-calendars case grants and then leaves it).
 */

let env: TestEnvironment;
let fixtures: NotificationFixtures;

const ADMIN_CALENDAR_NAME = 'Test Calendar';
/** The multi-calendar user's own calendar, whose leaf hosts the open-switcher scan. */
const MULTI_CALENDAR_URL_NAME = 'multicalendar_calendar';
const MULTI_CALENDAR_NAME = "MultiCalendar's Events";
const TESTUSER_CALENDAR_NAME = "TestUser's Calendar";
const NONEXISTENT_CALENDAR = 'no_such_calendar_e2e';

/** Rail width is --pav-shell-rail-width (4rem, 64px at the default root size); 1px of slack for the border. */
const RAIL_MAX_WIDTH = 65;

/** Full sidebar width is --pav-shell-sidebar-width (15rem, 240px); anything well over the rail. */
const FULL_SIDEBAR_MIN_WIDTH = 200;

/** A rail link narrower than this has been collapsed by a stray layout rule. */
const RAIL_LINK_MIN_WIDTH = 40;

/** A short desktop window: the tree is taller than the viewport here. */
const SHORT_DESKTOP = { width: 1280, height: 500 };

/** 200% text: the root font size a browser zoom-text setting would give. */
const ENLARGED_ROOT_FONT = '32px';

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
    await expect(backLink(page, 'Account')).toBeVisible();
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

  test('an editor\'s calendar index forwards to Widget', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);

    await gotoSettings(page, env.baseURL, {
      path: calendarIndexPath(TESTUSER_CALENDAR_URL_NAME),
      title: 'Widget',
    });
    await expect(page).toHaveURL(pathPattern(calendarLeafPath(TESTUSER_CALENDAR_URL_NAME, 'widget')));
  });
});

test.describe('account calendars', () => {
  test.use({ viewport: DESKTOP });

  test('an editor leaves a calendar from Account → Calendars; an owned calendar has no Leave', async ({ page }) => {
    // Make the multi-calendar user an editor of test_calendar for this case
    // alone: leaving it restores the seeded non-member state the
    // unresolved-calendar cases rely on, and testuser_calendar stays edited.
    const adminToken = await loginViaApi(env.baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    const grant = await axios.post(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/editors`,
      { email: MULTI_CALENDAR_USER.email },
      { headers: { Authorization: `Bearer ${adminToken}` }, validateStatus: () => true },
    );
    expect([201, 409], `unexpected editor-grant response: ${grant.status}`).toContain(grant.status);

    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);
    await gotoSettings(page, env.baseURL, settingsLeaf.calendars);
    const content = settingsContent(page);

    const owned = accountCalendarRow(content, MULTI_CALENDAR_NAME);
    await expect(owned).toContainText('Owner');
    await expect(owned.getByRole('button')).toHaveCount(0);
    await expect(owned.getByRole('link')).toHaveAttribute('href', calendarLeafPath(MULTI_CALENDAR_URL_NAME, 'general'));

    const edited = accountCalendarRow(content, ADMIN_CALENDAR_NAME);
    await expect(edited).toContainText('Editor');
    await expect(edited.getByRole('link')).toHaveAttribute('href', calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'widget'));

    await accountCalendarLeaveButton(content, ADMIN_CALENDAR_NAME).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await confirmLeaveButton(page).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(edited).toHaveCount(0);
    await expect(page).toHaveURL(pathPattern(settingsPath.calendars));
    await expect(accountCalendarRow(content, TESTUSER_CALENDAR_NAME)).toBeVisible();
    // Focus lands on the next row's link or, when the left row was last, the h1.
    const focusedOnRowOrHeading = await page.evaluate(() => {
      const active = document.activeElement;
      return !!active && (active.matches('.account-calendars__name') || active.matches('h1'));
    });
    expect(focusedOnRowOrHeading, 'focus moved to a row link or the h1').toBe(true);

    // The calendar is gone from the switcher's store too: its settings no longer resolve.
    await page.goto(env.baseURL + calendarIndexPath(ADMIN_CALENDAR_URL_NAME));
    await expect(settingsTitle(page, UNRESOLVED_CALENDAR_TITLE)).toBeVisible();
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

  test('desktop → phone on a leaf keeps the leaf, shows its back link and focuses the h1', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page, env.baseURL);
    const editors = calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'editors');

    await gotoSettings(page, env.baseURL, editors);
    await expect(settingsTree(page)).toBeVisible();

    // Focus in the tree as it hides moves to the h1, not the body.
    await settingsRow(settingsTree(page), 'Editors').focus();
    await expect(settingsRow(settingsTree(page), 'Editors')).toBeFocused();

    await page.setViewportSize(PHONE);
    await expect(backLink(page, ADMIN_CALENDAR_NAME)).toBeVisible();
    await expect(page).toHaveURL(pathPattern(editors.path));
    await expect(settingsTitle(page, 'Editors')).toBeVisible();
    await expect(settingsTitle(page, 'Editors')).toBeFocused();
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
    // The skip control lives only in the tree, so its absence is the tree's.
    await expect(treeSkipControl(page)).toHaveCount(0);

    // At md: the script forwards and the CSS shows the tree and the rail.
    await page.setViewportSize({ width: SHELL_MD, height: DESKTOP.height });
    await page.goto(env.baseURL + settingsPath.root);
    await expect(page).toHaveURL(pathPattern(calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'general')));
    await expect(settingsTree(page)).toBeVisible();
    await expect(mainNav(page)).toBeVisible();
    await expect(mobileNav(page)).toBeHidden();
    expect(await mainNavWidth(page)).toBeLessThanOrEqual(RAIL_MAX_WIDTH);
    for (const link of await mainNav(page).getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box, 'rail link is rendered').not.toBeNull();
      expect(box!.width, 'rail link keeps its width at md').toBeGreaterThanOrEqual(RAIL_LINK_MIN_WIDTH);
    }
  });
});

test.describe('tree layout', () => {
  test('Log out stays inside the viewport while a tall leaf is scrolled', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    for (const viewport of [SHORT_DESKTOP, DESKTOP]) {
      await page.setViewportSize(viewport);
      await gotoSettings(page, env.baseURL, calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'general'));
      for (const position of ['top', 'bottom'] as const) {
        await page.evaluate((to) => {
          const root = document.scrollingElement ?? document.documentElement;
          root.scrollTo(0, to === 'top' ? 0 : root.scrollHeight);
        }, position);
        const box = await logOutButton(settingsTree(page)).boundingBox();
        expect(box, 'Log out is rendered').not.toBeNull();
        expect(box!.y, `Log out top at ${viewport.height}px, ${position}`).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height, `Log out bottom at ${viewport.height}px, ${position}`)
          .toBeLessThanOrEqual(viewport.height);
      }
    }
  });

  test('the tree keeps its full width at default text size', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, settingsLeaf.profile);

    const box = await settingsTree(page).boundingBox();
    // --pav-settings-tree-width caps at 14rem, 224px at the default root size.
    expect(box!.width).toBeCloseTo(224, 0);
  });

  for (const width of [SHELL_MD, 900, DESKTOP.width]) {
    test(`nothing overflows sideways at ${width}px with 200% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: DESKTOP.height });
      await loginAsAdmin(page, env.baseURL);

      for (const leaf of [calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'general'), settingsLeaf.profile]) {
        await gotoSettings(page, env.baseURL, leaf);
        // Set on the element, not with addStyleTag, which the CSP blocks.
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, ENLARGED_ROOT_FONT);
        await expect(settingsTree(page)).toBeVisible();

        const documentWidth = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(documentWidth.scrollWidth, `document overflows on ${leaf.path}`)
          .toBeLessThanOrEqual(documentWidth.innerWidth);
        const column = await settingsContent(page).evaluate((el) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }));
        expect(column.scrollWidth, `content column overflows on ${leaf.path}`)
          .toBeLessThanOrEqual(column.clientWidth);
      }
    });
  }
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

/*
 * Accessibility.
 */

/** A short landscape window at md+: the page and the sticky tree both scroll. */
const SHORT_LANDSCAPE = { width: 800, height: 360 };

/** The narrowest width WCAG 1.4.10 reflow is defined at. */
const REFLOW_WIDTH = 320;

/*
 * Pre-existing design-system contrast failures, excluded by selector on the
 * states that render them, never by disabling color-contrast for a page.
 * Neither is a settings selector and this epic did not touch either; both are
 * the brand-orange ramp failing AA, tracked as pv-jqa4 and recorded with the
 * same reasoning as KNOWN_DESIGN_TOKEN_VIOLATIONS in a11y/inbox-axe.spec.ts.
 * Drop each when pv-jqa4 lands; never widen one to a whole rule.
 */

/** The shared `.pill-button--primary`: white on `#F97316`, 2.8:1. On the report detail. */
const KNOWN_PRIMARY_PILL_CONTRAST = '.pill-button--primary';

/**
 * A selected in-page tab drawn by the shared tab-button mixin (the language
 * tabs on a multilingual form, the instance Accounts tabs): `#EA580C`
 * (`--pav-color-brand-primary-dark`) on white, 3.55:1, which pv-jqa4 names as
 * insufficient text. No settings navigation control is a tab.
 */
const KNOWN_SELECTED_TAB_CONTRAST = '[role="tab"][aria-selected="true"]';

/** The instance Accounts table's row actions: `--pav-color-orange-600` (`#EA580C`) text, 3.55:1. */
const KNOWN_ACCOUNT_ACTION_CONTRAST = '.action-link';

/** The Widget leaf's copy button: white on `#F97316`, 2.8:1, the same fill as the primary pill. */
const KNOWN_COPY_BUTTON_CONTRAST = '.copy-button__label';

/**
 * The Widget leaf's live preview: an iframe holding the public widget, a
 * separate app with its own document. Its colours follow the owner-configured
 * accent (event times in `#FF9131` at 2.24:1, pv-8l49) and the public filter
 * styles, not settings; this scan covers the settings page around it.
 */
const WIDGET_PREVIEW_FRAME = 'iframe';

/**
 * Scan the page (or one region of it) with the pinned WCAG tag set and return
 * each violation as "rule: targets", so a failure diff names the selector.
 */
async function axeViolations(page: Page, scope: { include?: string; exclude?: string[] } = {}): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (scope.include) {
    builder = builder.include(scope.include);
  }
  for (const selector of scope.exclude ?? []) {
    builder = builder.exclude(selector);
  }
  const results = await builder.analyze();
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

/** Every list inside the scope marks at most one item as the current page. */
async function expectAtMostOneCurrentPerList(scope: Locator): Promise<void> {
  const lists = await scope.getByRole('list').all();
  expect(lists.length, 'the scope has lists').toBeGreaterThan(0);
  for (const list of lists) {
    await expect(list.locator('[aria-current="page"]').count()).resolves.toBeLessThanOrEqual(1);
  }
}

/** The document does not scroll sideways and nothing overflows the settings content column. */
async function expectNoSidewaysOverflow(page: Page, where: string): Promise<void> {
  const documentWidth = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(documentWidth.scrollWidth, `document overflows on ${where}`).toBeLessThanOrEqual(documentWidth.innerWidth);
  await expectNoHorizontalScroll(page);
}

for (const theme of ['light', 'dark'] as const satisfies readonly Theme[]) {
  test.describe(`axe, representative states (${theme})`, () => {
    test.use({ colorScheme: theme });

    test('phone root list', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await loginAsAdmin(page, env.baseURL);
      await gotoSettings(page, env.baseURL, settingsRootList);

      expect(await axeViolations(page)).toEqual([]);
    });

    test('phone section list', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await loginAsAdmin(page, env.baseURL);
      await gotoSettings(page, env.baseURL, calendarIndex(ADMIN_CALENDAR_URL_NAME, ADMIN_CALENDAR_NAME));
      await expect(calendarSwitcherTrigger(page)).toBeVisible();

      expect(await axeViolations(page)).toEqual([]);
    });

    test('desktop leaf with tree and rail', async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await loginAsAdmin(page, env.baseURL);
      await gotoSettings(page, env.baseURL, calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'general'));
      await expect(settingsTree(page)).toBeVisible();
      await expect(mainNav(page)).toBeVisible();

      expect(await axeViolations(page, { exclude: [KNOWN_SELECTED_TAB_CONTRAST] })).toEqual([]);
    });

    test('reports detail', async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);
      await page.goto(env.baseURL + calendarReportPath(TESTUSER_CALENDAR_URL_NAME, fixtures.ownedReportId));
      await expect(reportRegion(page)).toBeVisible({ timeout: 10000 });
      await expect(reportRegion(page)).toBeFocused();

      expect(await axeViolations(page, { exclude: [KNOWN_PRIMARY_PILL_CONTRAST] })).toEqual([]);
    });
  });
}

test.describe('axe, further leaves (light)', () => {
  test.use({ colorScheme: 'light', viewport: DESKTOP });

  test('instance accounts leaf', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, adminLeaf('accounts'));

    expect(await axeViolations(page, {
      exclude: [KNOWN_SELECTED_TAB_CONTRAST, KNOWN_ACCOUNT_ACTION_CONTRAST],
    })).toEqual([]);
  });

  test('profile and security leaves', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    for (const leaf of [settingsLeaf.profile, settingsLeaf.security]) {
      await gotoSettings(page, env.baseURL, leaf);
      expect(await axeViolations(page), leaf.path).toEqual([]);
    }
  });

  test('account calendars leaf with owned and edited calendars', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);
    await gotoSettings(page, env.baseURL, settingsLeaf.calendars);
    await expect(accountCalendarRow(settingsContent(page), TESTUSER_CALENDAR_NAME)).toBeVisible();

    expect(await axeViolations(page)).toEqual([]);
  });

  test('calendar leaf as an editor', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);
    // Widget is the one calendar leaf an editor sees.
    await gotoSettings(page, env.baseURL, calendarLeaf(TESTUSER_CALENDAR_URL_NAME, 'widget'));

    expect(await axeViolations(page, {
      exclude: [KNOWN_COPY_BUTTON_CONTRAST, WIDGET_PREVIEW_FRAME],
    })).toEqual([]);
  });

  test('calendar switcher sheet open on a settings leaf', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);
    await gotoSettings(page, env.baseURL, calendarLeaf(MULTI_CALENDAR_URL_NAME, 'editors'));
    await calendarSwitcherTrigger(page).click();
    await expect(page.getByRole('dialog', { name: 'Switch calendar' })).toBeVisible();

    expect(await axeViolations(page, { include: 'dialog.calendar-switcher-sheet' })).toEqual([]);
  });
});

test.describe('one h1 and one current item per list', () => {
  test('phone list pages and a phone leaf', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsAdmin(page, env.baseURL);
    const main = page.getByRole('main');

    for (const list of [settingsRootList, calendarIndex(ADMIN_CALENDAR_URL_NAME, ADMIN_CALENDAR_NAME)]) {
      await gotoSettings(page, env.baseURL, list);
      // A display: none instance leaves the accessibility tree, so the count sees only the live one.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      // An index has no current leaf, so zero is as correct as one.
      await expectAtMostOneCurrentPerList(main);
    }

    await gotoSettings(page, env.baseURL, settingsLeaf.security);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    // Below md the tree is display: none, not visually hidden: it is out of the accessibility tree.
    await expect(settingsTree(page)).toHaveCount(0);
  });

  test('desktop leaf: one current row in the tree and one in the rail', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'general'));

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(settingsTree(page).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(mainNav(page).getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
    await expectAtMostOneCurrentPerList(settingsTree(page));
  });

  test('the non-member empty state has one h1 at either width', async ({ page }) => {
    await loginViaUi(page, env.baseURL, MULTI_CALENDAR_USER.email, MULTI_CALENDAR_USER.password);

    for (const viewport of [PHONE, DESKTOP]) {
      await page.setViewportSize(viewport);
      await gotoSettings(page, env.baseURL, calendarIndex(ADMIN_CALENDAR_URL_NAME, UNRESOLVED_CALENDAR_TITLE));
      await expect(emptyState(page.getByRole('main'))).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    }
  });
});

test.describe('one page title and the header help button', () => {
  // Titles the leaves rendered under the h1 before the page header became
  // their only title; none may come back.
  const RETIRED_TITLES = [
    'Calendar Settings',
    'General Settings',
    'Account Management',
    'Local Calendars',
    'Moderation Dashboard',
    'Funding Settings',
  ];

  const leaves = [
    calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'general'),
    settingsLeaf.profile,
    settingsLeaf.calendars,
    ...([
      'settings',
      'accounts',
      'calendars',
      'moderation',
      'moderation/settings',
      'moderation/blocked-instances',
      'federation',
      'funding',
    ] as const).map(adminLeaf),
  ];

  for (const viewport of [PHONE, { width: SHELL_MD - 1, height: 900 }, DESKTOP]) {
    test(`each leaf has one title and an icon-sized help button beside it at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await loginAsAdmin(page, env.baseURL);

      for (const leaf of leaves) {
        await gotoSettings(page, env.baseURL, leaf);
        const title = settingsTitle(page, leaf.title);

        await expect(page.getByRole('heading', { name: leaf.title, exact: true })).toHaveCount(1);
        for (const retired of RETIRED_TITLES) {
          await expect(page.getByRole('heading', { name: retired, exact: true })).toHaveCount(0);
        }

        // One help button, in the h1's row, at the icon-button size: a flex
        // column once stretched it into a screen-wide circle on phones.
        await expect(helpButton(page)).toHaveCount(1);
        const help = helpButton(title.locator('xpath=..'));
        await expect(help).toBeVisible();
        const box = await help.boundingBox();
        expect(box, leaf.path).not.toBeNull();
        expect(box!.width, leaf.path).toBeLessThanOrEqual(48);
        expect(Math.abs(box!.width - box!.height), leaf.path).toBeLessThan(1);
      }
    });
  }

  test('the header help button opens the help panel', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, adminLeaf('accounts'));

    await helpButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test.describe('sub-route titles', () => {
  /** The eyebrow's link back to a sub-route's parent leaf (md+). */
  const parentLink = (page: Page, name: string): Locator =>
    page.locator('.settings-page-header__eyebrow').getByRole('link', { name, exact: true });

  test('at md+ the eyebrow links a sub-route back to its parent leaf, and focus lands on the h1', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, adminLeaf('moderation/blocked-instances'));

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('.settings-page-header__eyebrow')).toHaveText(/^Instance\s*Moderation$/i);

    await parentLink(page, 'Moderation').click();
    await expect(page).toHaveURL(pathPattern(adminLeafPath('moderation')));
    await expect(settingsTitle(page, 'Moderation')).toBeFocused();
    await expect(parentLink(page, 'Moderation')).toHaveCount(0);
  });

  test('at md+ a calendar report puts the Reports link after the calendar switcher', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);
    await page.goto(env.baseURL + calendarReportPath(TESTUSER_CALENDAR_URL_NAME, fixtures.ownedReportId));
    await expect(reportRegion(page)).toBeVisible({ timeout: 10000 });

    await expect(settingsTitle(page, 'Report Details')).toBeVisible();
    await expect(calendarSwitcherTrigger(page)).toBeVisible();
    await parentLink(page, 'Reports').click();
    await expect(page).toHaveURL(pathPattern(calendarLeafPath(TESTUSER_CALENDAR_URL_NAME, 'reports')));
    await expect(settingsTitle(page, 'Reports')).toBeFocused();
  });

  test('below md a sub-route\'s back link goes to its parent leaf', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, adminLeaf('moderation/settings'));

    await backLink(page, 'Moderation').click();
    await expect(page).toHaveURL(pathPattern(adminLeafPath('moderation')));
    await expect(settingsTitle(page, 'Moderation')).toBeFocused();
  });
});

test.describe('keyboard order', () => {
  test.use({ viewport: DESKTOP });

  /** Which part of the page holds focus, checked innermost-first: the tree sits inside main. */
  async function focusZone(page: Page): Promise<string> {
    const zones = [
      ['skip-main', shellSkipLink(page)],
      ['rail', mainNav(page)],
      ['tree', settingsTree(page)],
      ['content', page.getByRole('main')],
    ] as const;
    for (const [zone, locator] of zones) {
      if (await locator.evaluate((el) => el.contains(document.activeElement))) {
        return zone;
      }
    }
    return 'other';
  }

  test('Tab runs skip link → rail → tree → content', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    // Profile has no switcher in its eyebrow, so the first content stop is the page's own.
    await gotoSettings(page, env.baseURL, settingsLeaf.profile);

    const sequence: string[] = [];
    for (let press = 0; press < 40 && sequence.at(-1) !== 'content'; press++) {
      await page.keyboard.press('Tab');
      const zone = await focusZone(page);
      if (sequence.at(-1) !== zone) {
        sequence.push(zone);
      }
    }
    expect(sequence).toEqual(['skip-main', 'rail', 'tree', 'content']);
  });

  test('the tree\'s first stop is its skip control, which moves focus to the h1', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, settingsLeaf.profile);

    for (let press = 0; press < 40 && (await focusZone(page)) !== 'tree'; press++) {
      await page.keyboard.press('Tab');
    }
    await expect(treeSkipControl(page)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(settingsTitle(page, 'Profile')).toBeFocused();

    // The next stop is the page's own first control, past the tree.
    await page.keyboard.press('Tab');
    expect(await focusZone(page)).toBe('content');
  });
});

test.describe('reflow', () => {
  test(`nothing overflows sideways at ${REFLOW_WIDTH}px`, async ({ page }) => {
    await page.setViewportSize({ width: REFLOW_WIDTH, height: 800 });
    await loginAsAdmin(page, env.baseURL);

    for (const target of [
      settingsRootList,
      calendarIndex(ADMIN_CALENDAR_URL_NAME, ADMIN_CALENDAR_NAME),
      settingsLeaf.security,
    ]) {
      await gotoSettings(page, env.baseURL, target);
      await expectNoSidewaysOverflow(page, target.path);
    }
  });

  test('nothing overflows sideways in a short landscape window at md+', async ({ page }) => {
    await page.setViewportSize(SHORT_LANDSCAPE);
    await loginAsAdmin(page, env.baseURL);

    for (const leaf of [calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'general'), settingsLeaf.profile]) {
      await gotoSettings(page, env.baseURL, leaf);
      await expect(settingsTree(page)).toBeVisible();
      await expectNoSidewaysOverflow(page, leaf.path);
      // The sticky tree scrolls on its own here; it scrolls only vertically.
      await expectNoHorizontalScroll(page, settingsTree(page));
    }
  });

  // The widest leaves: tables and side-by-side forms that the content column must contain.
  const widestLeaves = [
    adminLeaf('accounts'),
    adminLeaf('calendars'),
    calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'widget'),
    calendarLeaf(ADMIN_CALENDAR_URL_NAME, 'import'),
  ];
  for (const width of [SHELL_MD, 900]) {
    test(`the widest leaves fit the content column at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: DESKTOP.height });
      await loginAsAdmin(page, env.baseURL);

      for (const leaf of widestLeaves) {
        await gotoSettings(page, env.baseURL, leaf);
        await expect(page).toHaveURL(pathPattern(leaf.path));
        await expectNoSidewaysOverflow(page, leaf.path);
      }
    });
  }

  test('row chevrons mirror in RTL', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsAdmin(page, env.baseURL);
    await gotoSettings(page, env.baseURL, settingsRootList);
    const chevron = settingsRowChevron(settingsRow(page.getByRole('main'), 'Account'));

    await expect(chevron).toHaveCSS('transform', 'none');
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    // scaleX(-1) computes to a matrix with a negative x scale.
    await expect(chevron).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
  });
});
