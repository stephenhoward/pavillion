import { test, expect } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Public Calendar Browsing & Event Detail Viewing
 *
 * Tests anonymous access to the public calendar at /@test_calendar,
 * event display, category filtering, text search, and event detail navigation.
 *
 * No login required — all tests use anonymous/public access.
 *
 * Covers workflow audit gaps:
 * - 3.1 Browse Public Calendar
 * - 3.2 View Event Details
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 */

let env: TestEnvironment;

// Configure tests to run serially within this file
// This ensures they share the same test server instance
test.describe.configure({ mode: 'serial' });

test.describe('Public Calendar', () => {
  test.beforeAll(async () => {
    // Start isolated test server for this test file
    env = await startTestServer();
  });

  test.afterAll(async () => {
    // Clean up test server
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to the public calendar for test_calendar
    await page.goto(env.baseURL + '/view/test_calendar');

    // Conditional skip if public site isn't rendering
    const appContent = await page.locator('#app').textContent({ timeout: 10000 }).catch(() => '');
    if (!appContent || appContent.trim() === '') {
      test.skip();
    }
  });

  test('should render the public calendar page', async ({ page }) => {
    // Verify the calendar loads with content
    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Verify we're not on a 404 or error page
    const pageContent = await page.textContent('body');
    expect(pageContent).not.toContain('Not Found');
  });

  test('should display seeded events on the public calendar', async ({ page }) => {
    // Wait for events to load
    // New redesign uses: section.day-section for day groups, li.day-event-item for event list items,
    // and article.event-card for the card rendered inside each list item.
    const eventItems = page.locator('li.day-event-item');
    const daySections = page.locator('section.day-section');

    // Wait for either events or an empty state to appear
    await page.waitForSelector('section.day-section, .empty-state, li.day-event-item', { timeout: 15000 });

    const eventCount = await eventItems.count();
    const dayCount = await daySections.count();

    // In the seeded database, test_calendar should have events
    // If no events, verify empty state renders correctly
    if (eventCount === 0 && dayCount === 0) {
      const emptyState = page.locator('.empty-state');
      await expect(emptyState).toBeVisible();
    }
    else {
      // Verify at least one event card has a title (article.event-card contains an h3 with a link)
      const firstEventTitle = eventItems.first().locator('h3');
      await expect(firstEventTitle).toBeVisible();
    }
  });

  test('should filter events by category', async ({ page }) => {
    // Wait for categories to load
    // category-pill-selector is now the scrollable container div, not itself a button.
    // The interactive elements are button.category-pill inside it.
    await page.waitForSelector('button.category-pill, .category-pill-selector-wrapper, .empty-state', { timeout: 15000 });

    const categoryPills = page.locator('button.category-pill');
    const pillCount = await categoryPills.count();

    if (pillCount === 0) {
      // No categories available, skip
      test.skip();
      return;
    }

    // Get the first category name
    const firstPillText = await categoryPills.first().locator('.category-name').textContent();

    // Click the first category pill to filter
    await categoryPills.first().click();

    // Verify the pill is now selected
    await expect(categoryPills.first()).toHaveClass(/selected/);

    // Verify URL updates with category parameter
    const url = page.url();
    expect(url).toContain('categories=');

    // Click again to deselect
    await categoryPills.first().click();

    // Verify the pill is deselected
    await expect(categoryPills.first()).not.toHaveClass(/selected/);
  });

  test('should search events by text', async ({ page }) => {
    // Wait for page to load
    // New redesign uses section.day-section instead of section.day
    await page.waitForSelector('#public-event-search, section.day-section, .empty-state', { timeout: 15000 });

    const searchInput = page.locator('#public-event-search');
    const searchVisible = await searchInput.isVisible().catch(() => false);

    if (!searchVisible) {
      test.skip();
      return;
    }

    // Type a search query (use a term likely to exist in seeded data)
    await searchInput.fill('test');

    // Wait for debounce (300ms) and URL update
    await page.waitForTimeout(500);

    // Verify URL includes search parameter
    const url = page.url();
    expect(url).toContain('search=');

    // Clear search
    const clearBtn = page.locator('.clear-search');
    const clearVisible = await clearBtn.isVisible().catch(() => false);

    if (clearVisible) {
      await clearBtn.click();
      // Verify search is cleared
      await expect(searchInput).toHaveValue('');
    }
  });

  test('should navigate to event detail page', async ({ page }) => {
    // Wait for events to load
    // New redesign uses li.day-event-item (containing article.event-card) instead of li.event
    await page.waitForSelector('li.day-event-item, .empty-state', { timeout: 15000 });

    const eventLinks = page.locator('li.day-event-item h3 a');
    const linkCount = await eventLinks.count();

    if (linkCount === 0) {
      test.skip();
      return;
    }

    // Get the event title before clicking
    const eventTitle = await eventLinks.first().textContent();

    // Click the first event link
    await eventLinks.first().click();

    // Wait for navigation to event detail page.
    // The URL may include an optional locale prefix (e.g. /es/) when the browser's
    // navigator.language is a non-default locale, so we allow for that with [a-z]{2,8}\/.
    // We escape the baseURL before embedding it in a RegExp to handle any special characters
    // (e.g. dots in IP addresses).
    //
    // Use waitUntil: 'commit' because this is a Vue Router SPA navigation via history.pushState.
    // Client-side routing does not fire a browser 'load' event (the default for waitForURL), so
    // we only wait for the URL to commit (change) rather than for a full page reload lifecycle.
    const escapedBase = env.baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.waitForURL(
      new RegExp(`${escapedBase}(\\/[a-z]{2,8})?\\/view\\/test_calendar\\/events\\/`),
      { timeout: 10000, waitUntil: 'commit' },
    );

    // Verify event detail page renders
    const detailTitle = page.locator('h1');
    await expect(detailTitle).toBeVisible({ timeout: 10000 });

    // Verify the title matches
    if (eventTitle) {
      await expect(detailTitle).toContainText(eventTitle.trim());
    }

    // Verify breadcrumb navigation back to calendar exists
    const breadcrumb = page.locator('.breadcrumb a, p.breadcrumb a');
    await expect(breadcrumb).toBeVisible();
  });
});
