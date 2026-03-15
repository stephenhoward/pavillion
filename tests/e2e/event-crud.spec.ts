import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Event CRUD Lifecycle
 *
 * Tests the core event lifecycle: create, edit, and delete.
 * This is the most critical user workflow for the calendar application.
 *
 * Uses isolated test server with in-memory database for true test isolation.
 * Tests run serially to share the same test server instance.
 */

let env: TestEnvironment;

// Configure tests to run serially within this file
test.describe.configure({ mode: 'serial' });

test.describe('Event CRUD', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('should create a new event with title and date', async ({ page }) => {
    // Navigate to the calendar view
    await page.goto(env.baseURL + '/calendar/test_calendar');
    await page.waitForSelector('.event-list', { timeout: 15000 });

    // Count initial events
    const initialCount = await page.locator('.event-item').count();

    // Click "Create an Event" button
    const createButton = page.getByRole('button', { name: /create an event/i });
    await createButton.click();

    // Wait for event editor page to load
    await page.waitForSelector('#event-form', { timeout: 10000 });

    // Fill in the event title
    const uniqueTitle = `E2E Test Event ${Date.now()}`;
    const titleInput = page.locator('#event-name-en');
    await titleInput.fill(uniqueTitle);

    // Fill in the description
    const descriptionInput = page.locator('#event-description-en');
    await descriptionInput.fill('This is a test event created by e2e tests');

    // Fill in the date (the schedule section has a date input)
    const dateInput = page.locator('.schedule-grid input[type="date"]').first();
    await dateInput.fill('2026-06-15');

    // Fill in the time
    const timeInput = page.locator('.schedule-grid input[type="time"]').first();
    await timeInput.fill('14:00');

    // Click Save Changes button
    const saveButton = page.locator('button.btn-save');
    await saveButton.click();

    // Wait for navigation back to calendar view
    await page.waitForURL('**/calendar/test_calendar', { timeout: 15000 });

    // Wait for event list to load
    await page.waitForSelector('.event-list', { timeout: 10000 });

    // Verify the new event appears in the list
    const newEvent = page.locator('.event-item').filter({ hasText: uniqueTitle });
    await expect(newEvent).toBeVisible({ timeout: 10000 });

    // Verify event count increased
    const finalCount = await page.locator('.event-item').count();
    expect(finalCount).toBeGreaterThan(initialCount);
  });

  test('should edit an existing event title', async ({ page }) => {
    // Navigate to calendar
    await page.goto(env.baseURL + '/calendar/test_calendar');
    await page.waitForSelector('.event-list', { timeout: 15000 });

    // Get the first event's title
    const firstEvent = page.locator('.event-item').first();
    const originalTitle = await firstEvent.locator('h3').textContent();
    expect(originalTitle).toBeTruthy();

    // Click the edit button on the first event
    const editButton = firstEvent.locator('.edit-btn');
    await editButton.click();

    // Wait for event editor to load
    await page.waitForSelector('#event-form', { timeout: 10000 });

    // Modify the title
    const updatedTitle = `Updated ${Date.now()}`;
    const titleInput = page.locator('#event-name-en');
    await titleInput.clear();
    await titleInput.fill(updatedTitle);

    // Click Save Changes
    const saveButton = page.locator('button.btn-save');
    await saveButton.click();

    // Wait for navigation back to calendar view
    await page.waitForURL('**/calendar/test_calendar', { timeout: 15000 });

    // Wait for event list to load
    await page.waitForSelector('.event-list', { timeout: 10000 });

    // Verify the updated title appears in the list
    const updatedEvent = page.locator('.event-item').filter({ hasText: updatedTitle });
    await expect(updatedEvent).toBeVisible({ timeout: 10000 });
  });

  test('should delete a single event', async ({ page }) => {
    // Navigate to calendar
    await page.goto(env.baseURL + '/calendar/test_calendar');
    await page.waitForSelector('.event-list', { timeout: 15000 });

    // Count initial events
    const initialCount = await page.locator('.event-item').count();
    expect(initialCount).toBeGreaterThan(0);

    // Get the title of the first event for verification
    const firstEvent = page.locator('.event-item').first();
    const eventTitle = await firstEvent.locator('h3').textContent();

    // Select the first event via checkbox
    const firstCheckbox = firstEvent.locator('input[type="checkbox"]');
    await firstCheckbox.check();

    // Click the delete button in the bulk operations menu
    const deleteButton = page.locator('[data-testid="delete-events-btn"]');
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    // Wait for the confirmation modal to appear
    const confirmModal = page.locator('dialog.delete-events-modal');
    await expect(confirmModal).toBeVisible({ timeout: 5000 });

    // Click the confirm delete button inside the modal
    await confirmModal.locator('button.pill-button--danger').click();

    // Wait for deletion to complete (event count should decrease)
    await page.waitForFunction(
      (count) => document.querySelectorAll('.event-item').length < count,
      initialCount,
      { timeout: 10000 },
    );

    // Verify the deleted event is no longer in the list
    if (eventTitle) {
      const deletedEvent = page.locator('.event-item').filter({ hasText: eventTitle.trim() });
      await expect(deletedEvent).toBeHidden({ timeout: 5000 });
    }

    // Verify event count decreased
    const finalCount = await page.locator('.event-item').count();
    expect(finalCount).toBe(initialCount - 1);
  });

  test('should create an event with category assignment', async ({ page }) => {
    // Navigate to the calendar view
    await page.goto(env.baseURL + '/calendar/test_calendar');
    await page.waitForSelector('.event-list', { timeout: 15000 });

    // Click "Create an Event" button
    const createButton = page.getByRole('button', { name: /create an event/i });
    await createButton.click();

    // Wait for event editor page to load
    await page.waitForSelector('#event-form', { timeout: 10000 });

    // Fill in the event title
    const uniqueTitle = `Categorized Event ${Date.now()}`;
    const titleInput = page.locator('#event-name-en');
    await titleInput.fill(uniqueTitle);

    // Fill in date and time
    const dateInput = page.locator('.schedule-grid input[type="date"]').first();
    await dateInput.fill('2026-07-20');
    const timeInput = page.locator('.schedule-grid input[type="time"]').first();
    await timeInput.fill('10:00');

    // Select a category if available (CategorySelector renders toggle chips)
    const categoryChips = page.locator('.category-selector .toggle-chip, .category-selector button');
    const chipCount = await categoryChips.count();
    if (chipCount > 0) {
      // Click the first available category chip to select it
      await categoryChips.first().click();
    }

    // Click Save Changes
    const saveButton = page.locator('button.btn-save');
    await saveButton.click();

    // Wait for navigation back to calendar view
    await page.waitForURL('**/calendar/test_calendar', { timeout: 15000 });

    // Wait for event list to load
    await page.waitForSelector('.event-list', { timeout: 10000 });

    // Verify the new event appears in the list
    const newEvent = page.locator('.event-item').filter({ hasText: uniqueTitle });
    await expect(newEvent).toBeVisible({ timeout: 10000 });

    // If a category was assigned, verify the category badge appears on the event
    if (chipCount > 0) {
      const categoryBadge = newEvent.locator('.category-badge');
      await expect(categoryBadge.first()).toBeVisible({ timeout: 5000 });
    }
  });
});
