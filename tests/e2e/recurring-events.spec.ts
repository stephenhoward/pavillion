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
 * UPDATED: Uses isolated test server with in-memory database for true test isolation.
 *
 * UPDATED (pv-j1pi.6): After the recurrence controls were moved into a Sheet
 * dialog (pv-j1pi.5), each test must:
 *   1. Click the "Add recurrence" / "Edit recurrence" trigger to open the sheet.
 *   2. Interact with `form.repeats`, `div.week-parameters`, and
 *      `div.month-parameters` inside the sheet (same selectors still match).
 *   3. Close the sheet (Escape key — matches the convention used by other
 *      sheet-aware specs such as modals-consolidation.spec.ts).
 *   4. Assert the `.recurrence-summary .summary-text` line is visible when a
 *      frequency has been configured (it only renders after the first save
 *      because `generateRecurrenceText` requires a non-null frequency).
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

    // Verify the "Add recurrence" trigger button is present (new sheet entry point).
    const addRecurrenceBtn = page.getByRole('button', { name: /add recurrence/i });
    await expect(addRecurrenceBtn).toBeVisible();

    // Click to open the recurrence sheet
    await addRecurrenceBtn.click();

    // Verify the sheet opens with dialog semantics and the recurrence form inside
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const repeatForm = dialog.locator('form.repeats');
    await expect(repeatForm).toBeVisible({ timeout: 5000 });

    // Close the sheet via Escape (consistent with modals-consolidation.spec.ts)
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 2000 });
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

    // Open the recurrence sheet via the trigger button
    await page.getByRole('button', { name: /add recurrence/i }).click();

    // Wait for the sheet/form
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const repeatForm = dialog.locator('form.repeats');
    await expect(repeatForm).toBeVisible({ timeout: 5000 });

    // Explicitly select weekly frequency so the week-parameters fieldset renders
    const frequencySelect = dialog.locator('.frequency-select');
    await frequencySelect.selectOption('weekly');

    // Set interval
    const intervalInput = dialog.locator('label.repeat-interval input[type="number"]');
    if (await intervalInput.isVisible()) {
      await intervalInput.fill('1');
    }

    // Verify weekly parameters section is visible inside the sheet
    const weekParams = dialog.locator('div.week-parameters, fieldset.week-parameters');
    await expect(weekParams).toBeVisible({ timeout: 5000 });

    // Select Monday and Wednesday
    const mondayLabel = weekParams.locator('label').filter({ hasText: /Monday|Mon/i });
    if (await mondayLabel.count() > 0) {
      await mondayLabel.first().click();
    }

    const wednesdayLabel = weekParams.locator('label').filter({ hasText: /Wednesday|Wed/i });
    if (await wednesdayLabel.count() > 0) {
      await wednesdayLabel.first().click();
    }

    // Verify Monday checkbox is checked
    const mondayCheckbox = mondayLabel.first().locator('input[type="checkbox"]');
    if (await mondayCheckbox.count() > 0) {
      await expect(mondayCheckbox).toBeChecked();
    }

    // Close the sheet via Escape
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 2000 });

    // Assert the human-readable summary line is visible after closing the sheet
    // (frequency is set, so generateRecurrenceText produces a "Every ..." string).
    const summary = page.locator('.recurrence-summary .summary-text');
    await expect(summary).toBeVisible({ timeout: 5000 });
    await expect(summary).toContainText(/every /i);
  });

  test('should configure a monthly recurring event', async ({ page }) => {
    // Set future date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dateStr = futureDate.toISOString().split('T')[0];

    const dateInput = page.locator('.schedule-grid input[type="date"]').first();
    await dateInput.fill(dateStr);

    // Open the recurrence sheet
    await page.getByRole('button', { name: /add recurrence/i }).click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const repeatForm = dialog.locator('form.repeats');
    await expect(repeatForm).toBeVisible({ timeout: 5000 });

    // Explicitly select monthly frequency so the month-parameters fieldset renders
    const frequencySelect = dialog.locator('.frequency-select');
    await frequencySelect.selectOption('monthly');

    // Check for monthly parameters grid inside the sheet
    const monthParams = dialog.locator('div.month-parameters, fieldset.month-parameters');
    await expect(monthParams).toBeVisible({ timeout: 5000 });

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

    // Close the sheet via Escape
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 2000 });

    // Assert the human-readable summary line is visible after closing the sheet.
    // Monthly with an nth-weekday checkbox produces patterns like
    // "First Sunday of the month" (no literal "every"/"monthly"), so match
    // either the "every..." form or the "Nth <weekday> of the month" form.
    const summary = page.locator('.recurrence-summary .summary-text');
    await expect(summary).toBeVisible({ timeout: 5000 });
    await expect(summary).toContainText(/every |monthly|of the month/i);
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

    // Open the recurrence sheet via the trigger. For an existing recurring
    // event the button should read "Edit recurrence"; for a non-recurring
    // schedule it reads "Add recurrence". Accept either.
    const recurrenceTrigger = page.getByRole('button', { name: /(add|edit) recurrence/i });
    await expect(recurrenceTrigger.first()).toBeVisible({ timeout: 5000 });
    await recurrenceTrigger.first().click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const repeatForm = dialog.locator('form.repeats');
    await expect(repeatForm).toBeVisible({ timeout: 5000 });

    // Verify end type section exists (visible because frequency is set)
    const endTypeSection = dialog.locator('.end-type, fieldset.end-type, div.end-type');
    await expect(endTypeSection.first()).toBeVisible({ timeout: 5000 });

    // Verify radio options exist
    const radioButtons = endTypeSection.first().locator('input[type="radio"]');
    const radioCount = await radioButtons.count();
    expect(radioCount).toBe(3); // never, after, on

    // Select "never" option
    const neverRadio = endTypeSection.first().locator('input[type="radio"][value="none"]');
    await neverRadio.check();
    await expect(neverRadio).toBeChecked();

    // Select "after N occurrences" option
    const afterRadio = endTypeSection.first().locator('input[type="radio"][value="after"]');
    await afterRadio.check();
    await expect(afterRadio).toBeChecked();

    // Set occurrence count
    const countInput = endTypeSection.first().locator('input[type="number"]');
    await countInput.fill('10');

    // Select "on date" option
    const onDateRadio = endTypeSection.first().locator('input[type="radio"][value="on"]');
    await onDateRadio.check();
    await expect(onDateRadio).toBeChecked();

    // Set end date (3 months from now)
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 3);
    const endDateStr = endDate.toISOString().split('T')[0];

    const endDateInput = endTypeSection.first().locator('input[type="date"]');
    await endDateInput.fill(endDateStr);

    // Close the sheet via Escape
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 2000 });

    // Assert the human-readable summary line is visible after closing the sheet
    // (existing recurring event has frequency set, so the summary must render).
    // The exact phrase depends on the seeded recurring event's frequency; accept
    // any non-empty recurrence pattern produced by generateRecurrenceText().
    const summary = page.locator('.recurrence-summary .summary-text').first();
    await expect(summary).toBeVisible({ timeout: 5000 });
    await expect(summary).not.toHaveText('');
    await expect(summary).toContainText(/every |monthly|yearly|daily|weekly|of the month/i);
  });
});
