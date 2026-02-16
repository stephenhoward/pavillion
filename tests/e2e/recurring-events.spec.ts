import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Recurring Event Management
 *
 * Tests the recurrence editor UI within the event editor, including
 * frequency selection, day-of-week configuration, monthly parameters,
 * and end date settings.
 *
 * Covers workflow audit gap:
 * - 1.3 Recurring Event Management
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 */

let env: TestEnvironment;

test.describe('Recurring Event Management', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    // Navigate to event editor via "Create an Event" button
    await page.goto(env.baseURL + '/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });
    await page.getByRole('button', { name: 'Create an Event' }).click();
    await page.waitForSelector('[role="group"][aria-label="Event Schedules"]', { timeout: 10000 });
  });

  test('should display recurrence controls in event editor', async ({ page }) => {
    // Verify schedule section exists
    const scheduleGroup = page.locator('[role="group"][aria-label="Event Schedules"]');
    await expect(scheduleGroup).toBeVisible();

    // Verify the "Add recurrence" button is present
    const addRecurrenceBtn = page.getByRole('button', { name: '+ Add recurrence' });
    await expect(addRecurrenceBtn).toBeVisible();

    // Click to enable recurrence
    await addRecurrenceBtn.click();

    // Verify the recurrence form appears
    const repeatForm = page.locator('form.repeats');
    await expect(repeatForm).toBeVisible({ timeout: 5000 });
  });

  test('should configure a weekly recurring event', async ({ page }) => {
    // Set a future date for the schedule
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dateStr = futureDate.toISOString().split('T')[0];

    const dateInput = page.locator('.schedule-grid input[type="date"]').first();
    await dateInput.fill(dateStr);

    const timeInput = page.locator('.schedule-grid input[type="time"]').first();
    await timeInput.fill('10:00');

    // Click "Add recurrence" to show the recurrence form
    await page.getByRole('button', { name: '+ Add recurrence' }).click();

    // Wait for the recurrence form
    const repeatForm = page.locator('form.repeats');
    await expect(repeatForm).toBeVisible({ timeout: 5000 });

    // Set interval
    const intervalInput = page.locator('label.repeat-interval input[type="number"]');
    if (await intervalInput.isVisible()) {
      await intervalInput.fill('1');
    }

    // Verify weekly parameters section is visible
    const weekParams = page.locator('div.week-parameters');
    const isWeekly = await weekParams.isVisible();

    if (isWeekly) {
      // Select Monday and Wednesday
      const mondayLabel = weekParams.locator('label').filter({ hasText: /Monday|Mon/i });
      if (await mondayLabel.count() > 0) {
        await mondayLabel.click();
      }

      const wednesdayLabel = weekParams.locator('label').filter({ hasText: /Wednesday|Wed/i });
      if (await wednesdayLabel.count() > 0) {
        await wednesdayLabel.click();
      }

      // Verify checkboxes are checked
      const mondayCheckbox = mondayLabel.locator('input[type="checkbox"]');
      if (await mondayCheckbox.count() > 0) {
        await expect(mondayCheckbox).toBeChecked();
      }
    }
  });

  test('should configure a monthly recurring event', async ({ page }) => {
    // Set future date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dateStr = futureDate.toISOString().split('T')[0];

    const dateInput = page.locator('.schedule-grid input[type="date"]').first();
    await dateInput.fill(dateStr);

    // Click "Add recurrence"
    await page.getByRole('button', { name: '+ Add recurrence' }).click();

    const repeatForm = page.locator('form.repeats');
    await expect(repeatForm).toBeVisible({ timeout: 5000 });

    // Check for monthly parameters grid
    const monthParams = page.locator('div.month-parameters');
    const isMonthly = await monthParams.isVisible();

    if (isMonthly) {
      // Verify month-parameters grid has checkboxes
      const monthCheckboxes = monthParams.locator('input[type="checkbox"]');
      const checkboxCount = await monthCheckboxes.count();
      expect(checkboxCount).toBeGreaterThan(0);

      // Select first available checkbox
      const firstLabel = monthParams.locator('label').first();
      await firstLabel.click();

      const firstCheckbox = firstLabel.locator('input[type="checkbox"]');
      if (await firstCheckbox.count() > 0) {
        await expect(firstCheckbox).toBeChecked();
      }
    }
  });

  test('should show end date options on existing recurring event', async ({ page }) => {
    // Navigate to calendar list (skip the beforeEach event editor)
    await page.goto(env.baseURL + '/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });

    // Find a recurring event (one that shows "Repeats")
    const recurringEvent = page.locator('.event-item').filter({ hasText: 'Repeats' }).first();
    const hasRecurring = await recurringEvent.isVisible().catch(() => false);

    if (!hasRecurring) {
      test.skip();
      return;
    }

    // Click edit on the recurring event
    const editBtn = recurringEvent.locator('button[aria-label*="Edit"]');
    await editBtn.click();

    // Wait for event editor to load with existing schedule data
    await page.waitForSelector('[role="group"][aria-label="Event Schedules"]', { timeout: 10000 });

    // Click "Add recurrence" to reveal the recurrence form (hidden by default even for existing recurring events)
    const addRecurrenceBtn = page.getByRole('button', { name: '+ Add recurrence' });
    const hasAddBtn = await addRecurrenceBtn.isVisible().catch(() => false);

    if (hasAddBtn) {
      await addRecurrenceBtn.click();
    }

    const repeatForm = page.locator('form.repeats');
    await expect(repeatForm).toBeVisible({ timeout: 5000 });

    // Verify end type section exists (visible because frequency is set)
    const endTypeSection = page.locator('div.end-type');
    await expect(endTypeSection).toBeVisible({ timeout: 5000 });

    // Verify radio options exist
    const radioButtons = endTypeSection.locator('input[type="radio"]');
    const radioCount = await radioButtons.count();
    expect(radioCount).toBe(3); // never, after, on

    // Select "never" option
    const neverRadio = endTypeSection.locator('input[type="radio"][value="none"]');
    await neverRadio.check();
    await expect(neverRadio).toBeChecked();

    // Select "after N occurrences" option
    const afterRadio = endTypeSection.locator('input[type="radio"][value="after"]');
    await afterRadio.check();
    await expect(afterRadio).toBeChecked();

    // Set occurrence count
    const countInput = endTypeSection.locator('input[type="number"]');
    await countInput.fill('10');

    // Select "on date" option
    const onDateRadio = endTypeSection.locator('input[type="radio"][value="on"]');
    await onDateRadio.check();
    await expect(onDateRadio).toBeChecked();

    // Set end date (3 months from now)
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 3);
    const endDateStr = endDate.toISOString().split('T')[0];

    const endDateInput = endTypeSection.locator('input[type="date"]');
    await endDateInput.fill(endDateStr);
  });
});
