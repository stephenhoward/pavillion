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
    // Navigate directly to the test calendar which has events and categories
    await page.goto('/calendar/test_calendar');
    await page.waitForTimeout(1000);

    // Find the search input - should exist since test_calendar has events
    const searchInput = page.locator('#event-search');
    await expect(searchInput).toBeVisible();

    // Count initial events - should be greater than 0
    const initialEventCount = await page.locator('.event-item').count();
    expect(initialEventCount).toBeGreaterThan(0);

    // Type search query (search for 'festival' which exists in seed data)
    await searchInput.fill('festival');

    // Wait for debounce and API call
    await page.waitForTimeout(500);

    // Check that URL was updated
    const url = page.url();
    expect(url).toContain('search=festival');

    // Verify events are shown (filtered or all if all match)
    const filteredEventCount = await page.locator('.event-item').count();
    expect(filteredEventCount).toBeGreaterThan(0);
  });

  test('should restore search from URL on page load', async ({ page }) => {
    // Navigate directly to test_calendar with search parameter in URL
    await page.goto('/calendar/test_calendar?search=club');
    await page.waitForTimeout(1000);

    // Verify search input is populated
    const searchInput = page.locator('#event-search');

    if (await searchInput.count() > 0) {
      const searchValue = await searchInput.inputValue();
      expect(searchValue).toBe('club');

      // Verify URL still has search parameter
      expect(page.url()).toContain('search=club');
    }
  });

  test('should combine search with category filters', async ({ page }) => {
    // Navigate directly to test_calendar which has both events and categories
    await page.goto('/calendar/test_calendar');
    await page.waitForTimeout(1000);

    // Verify events and categories exist
    expect(await page.locator('.event-item').count()).toBeGreaterThan(0);
    expect(await page.locator('.toggle-chip').count()).toBeGreaterThan(0);

    // Add search query
    const searchInput = page.locator('#event-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('community');
      await page.waitForTimeout(500);

      // Select a category
      const firstCategory = page.locator('.toggle-chip').first();
      await firstCategory.click();
      await page.waitForTimeout(500);

      // Verify URL has both parameters
      const url = page.url();
      expect(url).toContain('search=community');
      expect(url).toContain('categories=');
    }
  });

  test('should clear search when clear button is clicked', async ({ page }) => {
    // Navigate directly to test_calendar
    await page.goto('/calendar/test_calendar');
    await page.waitForTimeout(1000);

    // Verify events exist
    expect(await page.locator('.event-item').count()).toBeGreaterThan(0);

    // Add search query
    const searchInput = page.locator('#event-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('picnic');
      await page.waitForTimeout(500);

      // Verify URL updated
      expect(page.url()).toContain('search=picnic');

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
    // Navigate directly to test_calendar
    await page.goto('/calendar/test_calendar');
    await page.waitForTimeout(1000);

    // Verify events exist
    expect(await page.locator('.event-item').count()).toBeGreaterThan(0);

    // Add search query
    const searchInput = page.locator('#event-search');
    if (await searchInput.count() > 0) {
      await searchInput.fill('book');
      await page.waitForTimeout(500);

      // Add category if available
      const firstCategory = page.locator('.toggle-chip').first();
      if (await firstCategory.count() > 0) {
        await firstCategory.click();
        await page.waitForTimeout(500);
      }

      // Click clear all filters
      const clearAllButton = page.locator('.clear-filters-section .pill-button');
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
