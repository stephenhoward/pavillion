import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Bulk Event Operations & Event Duplication
 *
 * Tests bulk selection, bulk delete, bulk category assignment,
 * deselect-all, and event duplication via the calendar management UI.
 *
 * Covers workflow audit gaps:
 * - 1.6 Bulk Event Operations
 * - 1.7 Event Duplication
 */

test.describe('Bulk Event Operations', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should show bulk operations menu when events are selected', async ({ page }) => {
    // Navigate to the calendar event list
    await page.goto('/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });

    // Verify bulk menu is hidden initially
    const bulkMenu = page.locator('.bulk-operations-menu');
    await expect(bulkMenu).toBeHidden();

    // Select first event via checkbox
    const firstCheckbox = page.locator('.event-item input[type="checkbox"]').first();
    await firstCheckbox.check();

    // Verify bulk menu appears
    await expect(bulkMenu).toBeVisible();

    // Verify selection count is displayed
    const selectionCount = page.locator('.selection-count');
    await expect(selectionCount).toBeVisible();

    // Verify toolbar has proper ARIA role
    await expect(bulkMenu).toHaveAttribute('role', 'toolbar');

    // Verify action buttons exist
    await expect(page.locator('[data-testid="assign-categories-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="delete-events-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="deselect-all-btn"]')).toBeVisible();
  });

  test('should deselect all events via deselect button', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });

    // Select multiple events
    const checkboxes = page.locator('.event-item input[type="checkbox"]');
    const count = await checkboxes.count();
    if (count < 2) {
      test.skip();
      return;
    }

    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    // Verify bulk menu shows
    const bulkMenu = page.locator('.bulk-operations-menu');
    await expect(bulkMenu).toBeVisible();

    // Click deselect all
    await page.locator('[data-testid="deselect-all-btn"]').click();

    // Verify bulk menu disappears
    await expect(bulkMenu).toBeHidden();

    // Verify checkboxes are unchecked
    await expect(checkboxes.nth(0)).not.toBeChecked();
    await expect(checkboxes.nth(1)).not.toBeChecked();
  });

  test('should bulk delete selected events with confirmation', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });

    // Count initial events
    const initialCount = await page.locator('.event-item').count();
    if (initialCount < 1) {
      test.skip();
      return;
    }

    // Select first event
    await page.locator('.event-item input[type="checkbox"]').first().check();

    // Set up dialog handler for window.confirm
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      await dialog.accept();
    });

    // Click delete
    await page.locator('[data-testid="delete-events-btn"]').click();

    // Wait for deletion to complete (event count should decrease)
    await page.waitForFunction(
      (count) => document.querySelectorAll('.event-item').length < count,
      initialCount,
      { timeout: 10000 }
    );

    // Verify bulk menu disappears after deletion
    await expect(page.locator('.bulk-operations-menu')).toBeHidden();
  });

  test('should open category assignment dialog for selected events', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });

    // Select first event
    const firstCheckbox = page.locator('.event-item input[type="checkbox"]').first();
    await firstCheckbox.check();

    // Click assign categories
    await page.locator('[data-testid="assign-categories-btn"]').click();

    // Verify category selection dialog opens
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify dialog has proper ARIA attributes
    const dialogTitle = page.locator('#category-dialog-title');
    await expect(dialogTitle).toBeVisible();

    // Verify selection summary is shown
    const selectionSummary = page.locator('.selection-summary');
    await expect(selectionSummary).toBeVisible();

    // Verify category toggle chips are present (scoped to dialog)
    const toggleChips = dialog.locator('button.toggle-chip');
    const chipCount = await toggleChips.count();

    // If categories exist, verify we can toggle them
    if (chipCount > 0) {
      const firstChip = toggleChips.first();
      await expect(firstChip).toHaveAttribute('role', 'switch');
      await firstChip.click();
      await expect(firstChip).toHaveAttribute('aria-checked', 'true');
    }

    // Verify cancel and assign buttons in footer
    const footerButtons = dialog.locator('footer button');
    await expect(footerButtons).toHaveCount(2);

    // Close dialog via close button
    await page.locator('button.close-button').click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('Event Duplication', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should duplicate an event via duplicate button', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });

    const eventCount = await page.locator('.event-item').count();
    if (eventCount < 1) {
      test.skip();
      return;
    }

    // Get the first event's title for verification
    const firstEventTitle = await page.locator('.event-item').first().locator('h3').textContent();

    // Hover over event to reveal action buttons
    await page.locator('.event-item').first().hover();

    // Click duplicate button
    const duplicateBtn = page.locator('.duplicate-btn').first();
    await duplicateBtn.click();

    // Verify navigation to event editor with ?from= parameter
    await page.waitForURL(/\/event\?from=/, { timeout: 10000 });

    // Verify the event editor loaded with "Duplicate Event" heading
    const heading = page.getByRole('heading', { name: 'Duplicate Event' });
    await expect(heading).toBeVisible({ timeout: 10000 });

    // The title field should contain the duplicated event's title
    if (firstEventTitle) {
      const titleInput = page.getByRole('textbox', { name: 'Event Title' });
      const titleValue = await titleInput.inputValue().catch(() => '');
      // Duplicated event should have content pre-filled
      expect(titleValue.length).toBeGreaterThan(0);
    }
  });
});
