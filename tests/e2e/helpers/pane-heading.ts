import type { Locator, Page } from '@playwright/test';

/**
 * A settings leaf's own h2. The settings layout's h1 is the page title
 * (settingsTitle in ./settings-nav), so wait on that for page load; use this
 * only for a leaf heading whose text differs from that title. Pass the exact
 * en string.
 *
 * @param page - Playwright page instance
 * @param name - The leaf's heading text, e.g. "Moderation Settings"
 */
export function paneHeading(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 2, name, exact: true });
}
