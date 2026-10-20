import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Settings navigation for e2e specs: the leaf URLs and the role-based
 * selectors every settings spec shares. Specs never hard-code a settings
 * selector; a spec that needs a new one adds it here.
 *
 * The en strings below are held once, copied from
 * src/client/locales/en/settings.json (`tree_label`, `back_to`,
 * `nav.root.log_out`) and src/client/locales/en/system.json
 * (`navigation.main_label`, `navigation.mobile_label`).
 */

const TREE_LABEL = 'Settings';
const LOG_OUT_LABEL = 'Log out';
const BACK_TO_PREFIX = 'Back to';
const MAIN_NAV_LABEL = 'Main navigation';
const MOBILE_NAV_LABEL = 'Mobile navigation';

/** Phone viewport, matching calendar-switcher.spec.ts. */
export const PHONE = { width: 390, height: 844 };

/** Desktop viewport, comfortably above the md breakpoint. */
export const DESKTOP = { width: 1280, height: 800 };

/**
 * The md breakpoint at which the settings tree appears. Mirrors
 * SHELL_SIDEBAR_UP_PX in src/client/assets/breakpoints.ts; e2e cannot import
 * client code that pulls in Vue, so the literal is kept here.
 */
export const SHELL_MD = 768;

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
  fundingPlan: '/settings/account/funding',
  admin: '/settings/admin',
} as const;

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
 * One report on a calendar's Reports leaf.
 *
 * @param calendar - The calendar's url name
 * @param reportId - The report's id
 */
export function calendarReportPath(calendar: string, reportId: string): string {
  return `${calendarLeafPath(calendar, 'reports')}/${reportId}`;
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
 * The settings tree. It is display: none below md, so at phone width the
 * locator has no accessible match.
 *
 * @param page - Playwright page instance
 */
export function settingsTree(page: Page): Locator {
  return page.getByRole('navigation', { name: TREE_LABEL, exact: true });
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
 * The Log out row: in the tree footer at md+, in the root list below md.
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
 * Open a settings path and wait until its page title is visible.
 *
 * @param page - Playwright page instance
 * @param baseURL - Base URL of the test server
 * @param path - Root-relative settings path, e.g. settingsPath.security
 * @param title - The exact en page title the path settles on
 */
export async function gotoSettings(page: Page, baseURL: string, path: string, title: string): Promise<void> {
  await page.goto(baseURL + path);
  await expect(settingsTitle(page, title)).toBeVisible({ timeout: 10000 });
}
