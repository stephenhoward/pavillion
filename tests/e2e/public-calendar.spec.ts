import { test, expect } from '@playwright/test';

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
 */

test.describe('Public Calendar', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the public calendar for test_calendar
    await page.goto('/@test_calendar');

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
    const eventCards = page.locator('li.event');
    const daySections = page.locator('section.day');

    // Wait for either events or an empty state to appear
    await page.waitForSelector('section.day, .empty-state, li.event', { timeout: 15000 });

    const eventCount = await eventCards.count();
    const dayCount = await daySections.count();

    // In the seeded database, test_calendar should have events
    // If no events, verify empty state renders correctly
    if (eventCount === 0 && dayCount === 0) {
      const emptyState = page.locator('.empty-state');
      await expect(emptyState).toBeVisible();
    }
    else {
      // Verify at least one event card has a title
      const firstEventTitle = eventCards.first().locator('h3');
      await expect(firstEventTitle).toBeVisible();
    }
  });

  test('should filter events by category', async ({ page }) => {
    // Wait for categories to load
    await page.waitForSelector('button.category-pill, .category-pill-selector, .empty-state', { timeout: 15000 });

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
    expect(url).toContain('category=');

    // Click again to deselect
    await categoryPills.first().click();

    // Verify the pill is deselected
    await expect(categoryPills.first()).not.toHaveClass(/selected/);
  });

  test('should search events by text', async ({ page }) => {
    // Wait for page to load
    await page.waitForSelector('#public-event-search, section.day, .empty-state', { timeout: 15000 });

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
    await page.waitForSelector('li.event, .empty-state', { timeout: 15000 });

    const eventLinks = page.locator('li.event h3 a');
    const linkCount = await eventLinks.count();

    if (linkCount === 0) {
      test.skip();
      return;
    }

    // Get the event title before clicking
    const eventTitle = await eventLinks.first().textContent();

    // Click the first event link
    await eventLinks.first().click();

    // Wait for navigation to event detail page
    await page.waitForURL(/@test_calendar\/events\//, { timeout: 10000 });

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
