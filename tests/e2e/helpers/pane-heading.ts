import type { Locator, Page } from '@playwright/test';

/**
 * The heading of the pane under the settings root. The settings switcher is
 * the page's only h1, so every pane (account, calendar management, each
 * instance-admin page) titles itself with an h2. Pass the exact en string.
 *
 * @param page - Playwright page instance
 * @param name - The pane's heading text, e.g. "Moderation Dashboard"
 */
export function paneHeading(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 2, name, exact: true });
}
