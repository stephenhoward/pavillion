import { expect, type Locator, type Page } from '@playwright/test';
import { SHELL_SIDEBAR_UP_PX } from '@/client/assets/breakpoints';

/**
 * Settings navigation for e2e specs: the leaf URLs and the role-based
 * selectors every settings spec shares. Specs never hard-code a settings
 * selector; a spec that needs a new one adds it here.
 *
 * The en strings below are held once, copied from
 * src/client/locales/en/settings.json (`tree_label`, `skip_to_content`,
 * `back_to`, `nav.root.log_out`, `titles.*`, `nav.*`),
 * src/client/locales/en/system.json (`navigation.main_label`,
 * `navigation.mobile_label`, `navigation.skip_to_content`,
 * `moderation.detail.title`, `help.button_label`) and
 * src/client/locales/en/calendars.json (`switcher.trigger_description`,
 * `account_list.*`, and `editors.leave_calendar_button` for the leave
 * confirmation).
 *
 * Page titles follow page-header.vue: a leaf is titled with its tree label,
 * a sub-route (a report, moderation settings, blocked instances) with its
 * parent leaf's label, and an index with its group title or, for a
 * calendar, the calendar's name.
 */

const TREE_LABEL = 'Settings';
const TREE_SKIP_LABEL = 'Skip to settings content';
const SHELL_SKIP_LABEL = 'Skip to main content';
const REPORT_REGION_LABEL = 'Report Details';

/** A report's own page title, on a calendar's Reports leaf and in instance moderation. */
const REPORT_DETAIL_TITLE = 'Report Details';
const LOG_OUT_LABEL = 'Log out';
const BACK_TO_PREFIX = 'Back to';
const MAIN_NAV_LABEL = 'Main navigation';
const MOBILE_NAV_LABEL = 'Mobile navigation';
const LOADING_CALENDAR_TEXT = 'Loading calendar…';
const LEAVE_LABEL_PREFIX = 'Leave';
const CONFIRM_LEAVE_LABEL = 'Leave Calendar';
const HELP_BUTTON_LABEL = 'Help with this page';

/** Phone viewport, matching calendar-switcher.spec.ts. */
export const PHONE = { width: 390, height: 844 };

/** Desktop viewport, comfortably above the md breakpoint. */
export const DESKTOP = { width: 1280, height: 800 };

/**
 * The md breakpoint at which the settings tree appears and the main nav
 * leaves the bottom bar: the client's own constant, so a spec probing
 * either side of it follows the app if the breakpoint moves.
 */
export const SHELL_MD = SHELL_SIDEBAR_UP_PX;

export type CalendarLeaf = 'general' | 'editors' | 'reports' | 'import' | 'widget';

export type AdminLeaf =
  | 'settings'
  | 'accounts'
  | 'calendars'
  | 'moderation'
  | 'moderation/settings'
  | 'moderation/blocked-instances'
  | 'federation'
  | 'funding';

/** Root-relative settings paths; callers prefix the test server's baseURL. */
export const settingsPath = {
  root: '/settings',
  account: '/settings/account',
  profile: '/settings/account/profile',
  security: '/settings/account/security',
  calendars: '/settings/account/calendars',
  fundingPlan: '/settings/account/funding',
  admin: '/settings/admin',
} as const;

/**
 * A settings page to open: its root-relative path and the exact en page
 * title (the layout h1) it settles on.
 */
export interface SettingsPage {
  path: string;
  title: string;
}

/**
 * The account leaves, each with the title its h1 shows at any width.
 */
export const settingsLeaf = {
  profile: { path: settingsPath.profile, title: 'Profile' },
  security: { path: settingsPath.security, title: 'Security' },
  calendars: { path: settingsPath.calendars, title: 'Calendars' },
  fundingPlan: { path: settingsPath.fundingPlan, title: 'Funding Plan' },
} as const satisfies Record<string, SettingsPage>;

/*
 * Index pages (list pages). Every index is below md only: at md+ its route
 * guard forwards to the group's first visible leaf, so the page that loads
 * carries that leaf's title instead. Open an index with gotoSettings only in
 * a phone-viewport test.
 */

/** The settings root list (below md only). */
export const settingsRootList: SettingsPage = { path: settingsPath.root, title: 'Settings' };

/** The account index (below md only). */
export const settingsAccountIndex: SettingsPage = { path: settingsPath.account, title: 'Account' };

/** The instance-admin index (below md only). */
export const settingsAdminIndex: SettingsPage = { path: settingsPath.admin, title: 'Instance' };

/**
 * The title of any calendar settings page whose calendar the viewer cannot
 * resolve (nonexistent, not a member): the group title, never the route
 * param.
 */
export const UNRESOLVED_CALENDAR_TITLE = 'Calendar';

const CALENDAR_LEAF_TITLES: Record<CalendarLeaf, string> = {
  general: 'General',
  editors: 'Editors',
  reports: 'Reports',
  import: 'Import',
  widget: 'Widget',
};

// The instance group's 'settings' leaf is titled "General", the same title
// as the calendar group's 'general' leaf, so a spec that opens either must
// assert the URL too. Moderation's sub-routes carry titles of their own, with
// Moderation in the eyebrow and the back link.
const ADMIN_LEAF_TITLES: Record<AdminLeaf, string> = {
  'settings': 'General',
  'accounts': 'Accounts',
  'calendars': 'Calendars',
  'moderation': 'Moderation',
  'moderation/settings': 'Moderation Settings',
  'moderation/blocked-instances': 'Blocked Instances',
  'federation': 'Federation',
  'funding': 'Funding',
};

/**
 * A calendar's settings index. At md+ it forwards to the first visible leaf.
 *
 * @param calendar - The calendar's url name
 */
export function calendarIndexPath(calendar: string): string {
  return `/settings/calendar/${calendar}`;
}

/**
 * A calendar settings leaf.
 *
 * @param calendar - The calendar's url name
 * @param leaf - The leaf segment
 */
export function calendarLeafPath(calendar: string, leaf: CalendarLeaf): string {
  return `${calendarIndexPath(calendar)}/${leaf}`;
}

/**
 * The description a calendar switcher carries when the viewer has more than
 * one calendar. With one calendar it has none.
 */
export const SWITCHER_DESCRIPTION = 'Select to switch calendars';

/**
 * A calendar's index page (below md only). Its h1 is the calendar switcher,
 * named by the calendar's name alone.
 *
 * @param calendar - The calendar's url name
 * @param displayName - The calendar's display name, e.g. "Test Calendar"
 */
export function calendarIndex(calendar: string, displayName: string): SettingsPage {
  return { path: calendarIndexPath(calendar), title: displayName };
}

/**
 * The index of a calendar the viewer cannot resolve (nonexistent, not a
 * member), titled with the group and carrying no switcher.
 *
 * @param calendar - The calendar's url name
 */
export function unresolvedCalendarIndex(calendar: string): SettingsPage {
  return { path: calendarIndexPath(calendar), title: UNRESOLVED_CALENDAR_TITLE };
}

/**
 * A calendar settings leaf with the title its h1 shows.
 *
 * @param calendar - The calendar's url name
 * @param leaf - The leaf segment
 */
export function calendarLeaf(calendar: string, leaf: CalendarLeaf): SettingsPage {
  return { path: calendarLeafPath(calendar, leaf), title: CALENDAR_LEAF_TITLES[leaf] };
}

/**
 * One report on a calendar's Reports leaf.
 *
 * @param calendar - The calendar's url name
 * @param reportId - The report's id
 */
export function calendarReportPath(calendar: string, reportId: string): string {
  return `${calendarLeafPath(calendar, 'reports')}/${reportId}`;
}

/**
 * One report on a calendar's Reports leaf, with its own title.
 *
 * @param calendar - The calendar's url name
 * @param reportId - The report's id
 */
export function calendarReport(calendar: string, reportId: string): SettingsPage {
  return { path: calendarReportPath(calendar, reportId), title: REPORT_DETAIL_TITLE };
}

/**
 * An instance-admin settings leaf.
 *
 * @param leaf - The leaf segment under /settings/admin
 */
export function adminLeafPath(leaf: AdminLeaf): string {
  return `${settingsPath.admin}/${leaf}`;
}

/**
 * An instance-admin settings leaf with the title its h1 shows.
 *
 * @param leaf - The leaf segment under /settings/admin
 */
export function adminLeaf(leaf: AdminLeaf): SettingsPage {
  return { path: adminLeafPath(leaf), title: ADMIN_LEAF_TITLES[leaf] };
}

/**
 * One report in instance moderation.
 *
 * @param reportId - The report's id
 */
export function adminReportPath(reportId: string): string {
  return `${adminLeafPath('moderation')}/reports/${reportId}`;
}

/**
 * One report in instance moderation, with its own title.
 *
 * @param reportId - The report's id
 */
export function adminReport(reportId: string): SettingsPage {
  return { path: adminReportPath(reportId), title: REPORT_DETAIL_TITLE };
}

/**
 * The settings page title: the layout's h1. On a leaf it is the leaf's tree
 * label ("Profile", "Security", "General"); on a list page it is the group
 * title or the calendar name.
 *
 * @param page - Playwright page instance
 * @param name - The exact en title; omit to match any page title
 */
export function settingsTitle(page: Page, name?: string): Locator {
  return page.getByRole('heading', { level: 1, name, exact: true });
}

/**
 * The settings page's help button. The page header owns it, at the end of
 * the h1's row; no pane renders one of its own.
 *
 * @param scope - The page, or a region to search within
 */
export function helpButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: HELP_BUTTON_LABEL, exact: true });
}

/**
 * The settings tree, the md+ sidebar. The tree and the list page's nav share
 * the "Settings" label, and each is display: none on the side of md where
 * the other shows, so one query reaches whichever is rendered:
 *
 * - at md+ it matches the tree (a list page is never shown there);
 * - below md on a leaf it matches nothing (the tree is hidden and no list
 *   page is mounted);
 * - below md on a list page (the root, a calendar, the account, the
 *   instance) it matches the list page's nav, not the tree.
 *
 * Use it for md+ assertions; use settingsList for the phone list page.
 *
 * @param page - Playwright page instance
 */
export function settingsTree(page: Page): Locator {
  return page.getByRole('navigation', { name: TREE_LABEL, exact: true });
}

/**
 * The list page's nav: the group's rows on a settings index below md. Same
 * query as settingsTree, named for the phone list page so a spec says which
 * nav it means; at md+ it matches the tree instead.
 *
 * @param page - Playwright page instance
 */
export function settingsList(page: Page): Locator {
  return settingsTree(page);
}

/**
 * A group in the settings tree: a role="group" named by its title
 * ("Calendar", "Account", "Instance"). Scope a row with it when the label
 * repeats across groups, e.g. "General".
 *
 * @param scope - The page or the tree
 * @param name - The group's exact en title
 */
export function settingsGroup(scope: Page | Locator, name: string): Locator {
  return scope.getByRole('group', { name, exact: true });
}

/**
 * The settings content column: the page header and the routed page, beside
 * the tree at md+. It has no landmark of its own (the shell's main wraps the
 * tree too), so this is the one class selector in the helper. It does not
 * clip overflow, which is what expectNoHorizontalScroll relies on.
 *
 * @param page - Playwright page instance
 */
export function settingsContent(page: Page): Locator {
  return page.locator('.settings-layout__content');
}

/**
 * The calendar switcher trigger, a button named by the calendar's name alone.
 * In settings it is the h1's content on a calendar index and the eyebrow
 * above the h1 on a calendar leaf at md+.
 *
 * Pass the calendar's display name whenever the test knows it. Without one
 * this matches any switcher, for a test that cannot know which calendar is
 * showing (a last-used calendar) or asserts that no switcher renders.
 *
 * @param scope - The page or a region within it
 * @param displayName - The calendar's display name, e.g. "Test Calendar"
 */
export function calendarSwitcherTrigger(scope: Page | Locator, displayName?: string): Locator {
  if (displayName === undefined) {
    return scope.locator('button.calendar-switcher');
  }
  return scope.getByRole('button', { name: displayName, exact: true });
}

/**
 * The open report's region on a calendar's Reports leaf. The instance
 * moderation report page renders no such region.
 *
 * @param page - Playwright page instance
 */
export function reportRegion(page: Page): Locator {
  return page.getByRole('region', { name: REPORT_REGION_LABEL, exact: true });
}

/**
 * The tree's skip control, a button that focuses the page h1 without
 * navigating. Visually hidden until focused; md+ only, with the tree.
 *
 * @param page - Playwright page instance
 */
export function treeSkipControl(page: Page): Locator {
  return page.getByRole('button', { name: TREE_SKIP_LABEL, exact: true });
}

/**
 * The shell's skip link to the main landmark. Visually hidden until focused.
 *
 * @param page - Playwright page instance
 */
export function shellSkipLink(page: Page): Locator {
  return page.getByRole('link', { name: SHELL_SKIP_LABEL, exact: true });
}

/**
 * The shell's main navigation (the md+ rail).
 *
 * @param page - Playwright page instance
 */
export function mainNav(page: Page): Locator {
  return page.getByRole('navigation', { name: MAIN_NAV_LABEL, exact: true });
}

/**
 * The shell's bottom bar below md.
 *
 * @param page - Playwright page instance
 */
export function mobileNav(page: Page): Locator {
  return page.getByRole('navigation', { name: MOBILE_NAV_LABEL, exact: true });
}

/**
 * A main-nav link's text label. On a settings route at md+ the nav is an icon
 * rail and the label is visually hidden (sr-only) while staying in the link's
 * accessible name; elsewhere it is drawn. A class selector because the label
 * has no role of its own.
 *
 * @param link - A link in mainNav(page)
 */
export function mainNavLinkLabel(link: Locator): Locator {
  return link.locator('.shell-nav-item__label');
}

/**
 * A settings row's trailing chevron (list page rows below md). A class
 * selector because the icon is decorative and has no role.
 *
 * @param row - A row from settingsRow
 */
export function settingsRowChevron(row: Locator): Locator {
  return row.locator('.shell-nav-item__chevron');
}

/**
 * The calendar settings loading announcement, which must be gone once the
 * page has settled.
 *
 * @param page - Playwright page instance
 */
export function calendarLoadingStatus(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: LOADING_CALENDAR_TEXT });
}

/**
 * The empty state a calendar settings page shows when its calendar does not
 * resolve for the viewer (nonexistent, or not a member): a section named by
 * its own heading. A class selector because its name is the message text.
 *
 * @param scope - The page or a region within it
 */
export function emptyState(scope: Page | Locator): Locator {
  return scope.locator('.empty-state');
}

/**
 * A settings row (a tree or list-page link). "General" occurs in both the
 * calendar and instance groups for an admin owner, so scope it to a group.
 *
 * @param scope - The page, the tree, or a group within it
 * @param name - The row's exact en label
 */
export function settingsRow(scope: Page | Locator, name: string): Locator {
  return scope.getByRole('link', { name, exact: true });
}

/**
 * The Log out row: in the tree footer at md+ (scope it with
 * settingsTree(page)), in the root list below md (scope it with
 * settingsList(page) on settingsRootList).
 *
 * @param scope - The tree, the root list, or the page
 */
export function logOutButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: LOG_OUT_LABEL, exact: true });
}

/**
 * The "Back to {parent}" link shown below md.
 *
 * @param page - Playwright page instance
 * @param parentName - The parent page's title
 */
export function backLink(page: Page, parentName: string): Locator {
  return page.getByRole('link', { name: `${BACK_TO_PREFIX} ${parentName}`, exact: true });
}

/**
 * Open a settings page and wait until its page title is visible.
 *
 * @param page - Playwright page instance
 * @param baseURL - Base URL of the test server
 * @param target - The page, e.g. settingsLeaf.security or calendarLeaf(cal, 'general')
 */
export async function gotoSettings(page: Page, baseURL: string, target: SettingsPage): Promise<void> {
  await page.goto(baseURL + target.path);
  await expect(settingsTitle(page, target.title)).toBeVisible({ timeout: 10000 });
}

/**
 * The session history's length, for asserting that a navigation replaced
 * the entry rather than pushing one.
 *
 * @param page - Playwright page instance
 */
export async function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length);
}

/**
 * Assert that nothing overflows the settings content column sideways. The
 * body sets overflow-x: hidden, so the page itself never scrolls and the
 * check has to be made on the column (or a scope inside it), whose
 * scrollWidth includes any overflowing descendant.
 *
 * @param page - Playwright page instance
 * @param scope - The element to check; defaults to settingsContent(page)
 */
export async function expectNoHorizontalScroll(page: Page, scope?: Locator): Promise<void> {
  const target = scope ?? settingsContent(page);
  const { scrollWidth, clientWidth } = await target.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth, 'content overflows horizontally').toBeLessThanOrEqual(clientWidth);
}

/** The axe tag set every settings accessibility scan runs with. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * One calendar's row on the Account → Calendars screen, found by the
 * calendar's display name, which is the row's link text.
 */
export function accountCalendarRow(scope: Page | Locator, name: string): Locator {
  // A `has` locator is matched inside each candidate row, so it starts from
  // the page rather than from the scope.
  const page = 'page' in scope ? scope.page() : scope;
  return scope.getByRole('listitem').filter({
    has: page.getByRole('link', { name, exact: true }),
  });
}

/**
 * The Leave button of an edited calendar's row, by its accessible name
 * ("Leave {calendar}"). An owned calendar's row has none.
 */
export function accountCalendarLeaveButton(scope: Page | Locator, name: string): Locator {
  return scope.getByRole('button', { name: `${LEAVE_LABEL_PREFIX} ${name}`, exact: true });
}

/** The confirm button of the Leave Calendar dialog. */
export function confirmLeaveButton(page: Page): Locator {
  return page.getByRole('dialog').getByRole('button', { name: CONFIRM_LEAVE_LABEL, exact: true });
}
