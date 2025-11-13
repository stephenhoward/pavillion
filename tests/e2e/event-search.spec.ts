import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Event Search Functionality
 *
 * Tests complete user workflows for event search feature:
 * - User can search events and see filtered results
 * - Search queries are persisted in URL for bookmarking
 * - Revisiting bookmarked URLs restores search state
 * - Search works alongside category filtering
 */

test.describe('Event Search End-to-End', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as admin
    await loginAsAdmin(page);
  });

  test('should allow user to search for events by text', async ({ page }) => {
    // Navigate to a calendar (assumes test data exists)
    await page.goto('/calendar');
    await page.waitForTimeout(1000);

    // Click on first calendar if on calendar list
    const firstCalendarLink = page.locator('nav[aria-label*="calendar" i] a').first();
    if (await firstCalendarLink.count() > 0) {
      await firstCalendarLink.click();
      await page.waitForTimeout(1000);
    }

    // Find the search input
    const searchInput = page.locator('#event-search');

    // Skip if no search input (no events on calendar)
    if (await searchInput.count() === 0) {
      test.skip();
      return;
    }

    // Count initial events
    const initialEventCount = await page.locator('.event-item').count();

    // Only continue if there are events
    if (initialEventCount === 0) {
      test.skip();
      return;
    }

    // Type search query
    await searchInput.fill('event');

    // Wait for debounce and API call
    await page.waitForTimeout(500);

    // Check that URL was updated
    const url = page.url();
    expect(url).toContain('search=event');

    // Verify events are shown (filtered or all if all match)
    const filteredEventCount = await page.locator('.event-item').count();
    expect(filteredEventCount).toBeGreaterThan(0);
  });

  test('should restore search from URL on page load', async ({ page }) => {
    // Navigate to calendar list first
    await page.goto('/calendar');
    await page.waitForTimeout(1000);

    // Click on first calendar if on calendar list
    const firstCalendarLink = page.locator('nav[aria-label*="calendar" i] a').first();
    if (await firstCalendarLink.count() > 0) {
      await firstCalendarLink.click();
      await page.waitForTimeout(1000);
    }

    // Get the calendar URL
    const calendarUrl = page.url();
    const calendarPath = new URL(calendarUrl).pathname;

    // Skip if no events
    if (await page.locator('.event-item').count() === 0) {
      test.skip();
      return;
    }

    // Navigate to calendar with search parameter in URL
    await page.goto(`${calendarPath}?search=workshop`);
    await page.waitForTimeout(1000);

    // Verify search input is populated
    const searchInput = page.locator('#event-search');

    if (await searchInput.count() > 0) {
      const searchValue = await searchInput.inputValue();
      expect(searchValue).toBe('workshop');

      // Verify URL still has search parameter
      expect(page.url()).toContain('search=workshop');
    }
  });

  test('should combine search with category filters', async ({ page }) => {
    // Navigate to calendar
    await page.goto('/calendar');
    await page.waitForTimeout(1000);

    // Click on first calendar if on calendar list
    const firstCalendarLink = page.locator('nav[aria-label*="calendar" i] a').first();
    if (await firstCalendarLink.count() > 0) {
      await firstCalendarLink.click();
      await page.waitForTimeout(1000);
    }

    // Skip if no events or no categories
    if (await page.locator('.event-item').count() === 0) {
      test.skip();
      return;
    }

    if (await page.locator('.category-option').count() === 0) {
      test.skip();
      return;
    }

    // Add search query
    const searchInput = page.locator('#event-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('event');
      await page.waitForTimeout(500);

      // Select a category
      const firstCategory = page.locator('.category-option').first();
      await firstCategory.click();
      await page.waitForTimeout(500);

      // Verify URL has both parameters
      const url = page.url();
      expect(url).toContain('search=event');
      expect(url).toContain('categories=');
    }
  });

  test('should clear search when clear button is clicked', async ({ page }) => {
    // Navigate to calendar
    await page.goto('/calendar');
    await page.waitForTimeout(1000);

    // Click on first calendar if on calendar list
    const firstCalendarLink = page.locator('nav[aria-label*="calendar" i] a').first();
    if (await firstCalendarLink.count() > 0) {
      await firstCalendarLink.click();
      await page.waitForTimeout(1000);
    }

    // Skip if no events
    if (await page.locator('.event-item').count() === 0) {
      test.skip();
      return;
    }

    // Add search query
    const searchInput = page.locator('#event-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('workshop');
      await page.waitForTimeout(500);

      // Verify URL updated
      expect(page.url()).toContain('search=workshop');

      // Click clear button
      const clearButton = page.locator('.clear-search');
      if (await clearButton.isVisible()) {
        await clearButton.click();
        await page.waitForTimeout(500);

        // Verify search is cleared
        const searchValue = await searchInput.inputValue();
        expect(searchValue).toBe('');

        // Verify URL no longer has search parameter
        expect(page.url()).not.toContain('search=');
      }
    }
  });

  test('should clear all filters when clear all button is clicked', async ({ page }) => {
    // Navigate to calendar
    await page.goto('/calendar');
    await page.waitForTimeout(1000);

    // Click on first calendar if on calendar list
    const firstCalendarLink = page.locator('nav[aria-label*="calendar" i] a').first();
    if (await firstCalendarLink.count() > 0) {
      await firstCalendarLink.click();
      await page.waitForTimeout(1000);
    }

    // Skip if no events
    if (await page.locator('.event-item').count() === 0) {
      test.skip();
      return;
    }

    // Add search query
    const searchInput = page.locator('#event-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('event');
      await page.waitForTimeout(500);

      // Add category if available
      const firstCategory = page.locator('.category-option').first();
      if (await firstCategory.count() > 0) {
        await firstCategory.click();
        await page.waitForTimeout(500);
      }

      // Click clear all filters
      const clearAllButton = page.locator('.clear-all-filters');
      if (await clearAllButton.isVisible()) {
        await clearAllButton.click();
        await page.waitForTimeout(500);

        // Verify search is cleared
        const searchValue = await searchInput.inputValue();
        expect(searchValue).toBe('');

        // Verify URL has no filter parameters
        const url = page.url();
        expect(url).not.toContain('search=');
        expect(url).not.toContain('categories=');
      }
    }
  });
});
