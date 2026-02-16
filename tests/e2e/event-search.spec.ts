import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Event Search Functionality
 *
 * Tests complete user workflows for event search feature:
 * - User can search events and see filtered results
 * - Search queries are persisted in URL for bookmarking
 * - Revisiting bookmarked URLs restores search state
 * - Search works alongside category filtering
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 * Tests run serially within this file to share the same test server instance.
 */

let env: TestEnvironment;

// Configure tests to run serially within this file
test.describe.configure({ mode: 'serial' });

test.describe('Event Search End-to-End', () => {
  test.beforeAll(async () => {
    // Start isolated test server for this test file
    env = await startTestServer();
  });

  test.afterAll(async () => {
    // Clean up test server
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    // Log in as admin
    await loginAsAdmin(page, env.baseURL);
  });

  test('should allow user to search for events by text', async ({ page }) => {
    // Navigate directly to the test calendar which has events and categories
    await page.goto(env.baseURL + '/calendar/test_calendar');

    // Wait for events to load (the search input only appears when events exist)
    const searchInput = page.locator('#event-search');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    // Wait for at least one event item to render
    const eventItems = page.locator('.event-item');
    await expect(eventItems.first()).toBeVisible({ timeout: 10000 });

    // Read the first event's title to construct a search term from real data
    const firstEventTitle = await eventItems.first().locator('h3').textContent();
    expect(firstEventTitle).toBeTruthy();

    // Extract a meaningful search word from the event title (use the last word,
    // which is typically the most unique part of titles like "Summer Festival",
    // "Book Club Meeting", etc.)
    const words = firstEventTitle!.trim().split(/\s+/);
    const searchTerm = words[words.length - 1].toLowerCase();

    // Search for that term and wait for the API response
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/v1/calendars/test_calendar/events') && response.status() === 200,
    );
    await searchInput.fill(searchTerm);
    await responsePromise;

    // Check that URL was updated with search parameter
    await expect(page).toHaveURL(new RegExp(`search=${encodeURIComponent(searchTerm)}`));

    // Verify filtered events are shown - the term came from an existing event so it must match
    await expect(eventItems.first()).toBeVisible({ timeout: 5000 });
    const filteredEventCount = await eventItems.count();
    expect(filteredEventCount).toBeGreaterThan(0);
  });

  test('should restore search from URL on page load', async ({ page }) => {
    // First, navigate to the calendar to find an event name we can use
    await page.goto(env.baseURL + '/calendar/test_calendar');

    const eventItems = page.locator('.event-item');
    await expect(eventItems.first()).toBeVisible({ timeout: 15000 });

    // Get a search term from an actual event
    const firstEventTitle = await eventItems.first().locator('h3').textContent();
    const words = firstEventTitle!.trim().split(/\s+/);
    const searchTerm = words[words.length - 1].toLowerCase();

    // Navigate with that search term as a URL parameter
    await page.goto(env.baseURL + `/calendar/test_calendar?search=${encodeURIComponent(searchTerm)}`);

    // Wait for the search input to appear and verify it's populated
    const searchInput = page.locator('#event-search');
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await expect(searchInput).toHaveValue(searchTerm);

    // Verify URL still has search parameter
    expect(page.url()).toContain(`search=${encodeURIComponent(searchTerm)}`);
  });

  test('should combine search with category filters', async ({ page }) => {
    // Navigate directly to test_calendar which has both events and categories
    await page.goto(env.baseURL + '/calendar/test_calendar');

    // Wait for events and categories to load
    const eventItems = page.locator('.event-item');
    await expect(eventItems.first()).toBeVisible({ timeout: 15000 });
    const categoryChips = page.locator('.toggle-chip');
    await expect(categoryChips.first()).toBeVisible({ timeout: 10000 });

    // Get a search term from an actual event
    const firstEventTitle = await eventItems.first().locator('h3').textContent();
    const words = firstEventTitle!.trim().split(/\s+/);
    const searchTerm = words[words.length - 1].toLowerCase();

    // Add search query and wait for filtered API response
    const searchInput = page.locator('#event-search');
    await expect(searchInput).toBeVisible();

    const searchResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/calendars/test_calendar/events') && response.status() === 200,
    );
    await searchInput.fill(searchTerm);
    await searchResponse;

    // Verify URL has search parameter
    await expect(page).toHaveURL(new RegExp(`search=${encodeURIComponent(searchTerm)}`));

    // Select a category and wait for the filtered API response
    const categoryResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/calendars/test_calendar/events') && response.status() === 200,
    );
    await categoryChips.first().click();
    await categoryResponse;

    // Verify URL has both parameters
    const url = page.url();
    expect(url).toContain(`search=${encodeURIComponent(searchTerm)}`);
    expect(url).toContain('categories=');
  });

  test('should clear search when clear button is clicked', async ({ page }) => {
    // Navigate directly to test_calendar
    await page.goto(env.baseURL + '/calendar/test_calendar');

    // Wait for events to load
    const eventItems = page.locator('.event-item');
    await expect(eventItems.first()).toBeVisible({ timeout: 15000 });

    // Get a search term from an actual event
    const firstEventTitle = await eventItems.first().locator('h3').textContent();
    const words = firstEventTitle!.trim().split(/\s+/);
    const searchTerm = words[words.length - 1].toLowerCase();

    // Add search query and wait for API response
    const searchInput = page.locator('#event-search');
    await expect(searchInput).toBeVisible();

    const searchResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/calendars/test_calendar/events') && response.status() === 200,
    );
    await searchInput.fill(searchTerm);
    await searchResponse;

    // Verify URL updated
    await expect(page).toHaveURL(new RegExp(`search=${encodeURIComponent(searchTerm)}`));

    // Click clear button and wait for API response (clears search, reloads all events)
    const clearButton = page.locator('.clear-search');
    await expect(clearButton).toBeVisible();

    const clearResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/calendars/test_calendar/events') && response.status() === 200,
    );
    await clearButton.click();
    await clearResponse;

    // Verify search is cleared
    await expect(searchInput).toHaveValue('');

    // Verify URL no longer has search parameter
    expect(page.url()).not.toContain('search=');
  });

  test('should clear all filters when clear all button is clicked', async ({ page }) => {
    // Navigate directly to test_calendar
    await page.goto(env.baseURL + '/calendar/test_calendar');

    // Wait for events to load
    const eventItems = page.locator('.event-item');
    await expect(eventItems.first()).toBeVisible({ timeout: 15000 });

    // Get a search term from an actual event
    const firstEventTitle = await eventItems.first().locator('h3').textContent();
    const words = firstEventTitle!.trim().split(/\s+/);
    const searchTerm = words[words.length - 1].toLowerCase();

    // Add search query and wait for API response
    const searchInput = page.locator('#event-search');
    await expect(searchInput).toBeVisible();

    const searchResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/calendars/test_calendar/events') && response.status() === 200,
    );
    await searchInput.fill(searchTerm);
    await searchResponse;

    // Add category if available
    const firstCategory = page.locator('.toggle-chip').first();
    if (await firstCategory.count() > 0) {
      const categoryResponse = page.waitForResponse(
        (response) => response.url().includes('/api/v1/calendars/test_calendar/events') && response.status() === 200,
      );
      await firstCategory.click();
      await categoryResponse;
    }

    // Click clear all filters and wait for API response
    const clearAllButton = page.locator('.clear-filters-section .pill-button');
    await expect(clearAllButton).toBeVisible();

    const clearAllResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/calendars/test_calendar/events') && response.status() === 200,
    );
    await clearAllButton.click();
    await clearAllResponse;

    // Verify search is cleared
    await expect(searchInput).toHaveValue('');

    // Verify URL has no filter parameters
    const url = page.url();
    expect(url).not.toContain('search=');
    expect(url).not.toContain('categories=');
  });
});
