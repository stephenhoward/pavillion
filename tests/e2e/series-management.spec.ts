import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Series management and inline series creation
 *
 * Exercises the client-to-server contract for event series in a real browser:
 *
 *   1. Calendar management → Series tab: create a series, rename it, delete it.
 *   2. Event editor → "+ New series": create a series inline from a new event,
 *      save the event, and confirm the event is assigned to it (the select on
 *      reopening the event, and the series page's event count).
 *   3. The duplicate URL-name error surfaces inside the inline dialog, and
 *      cancelling leaves the event's series selection untouched.
 *
 * Uses the isolated test server (in-memory SQLite, seeded admin@pavillion.dev
 * owning test_calendar). Tests run serially: test 3 reuses the URL name that
 * test 2 created.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

const ADMIN_CALENDAR = 'test_calendar';

// Series URL names are limited to 24 characters, so the stamp is base36.
const STAMP = Date.now().toString(36);
const INLINE_URL_NAME = `inline-${STAMP}`;
const INLINE_SERIES_NAME = `Inline Series ${STAMP}`;

/**
 * Open the Series tab on the admin's seeded calendar via direct URL and wait
 * for the series list (or empty state) to finish loading. Both states render
 * an "Add Series" button.
 */
async function gotoSeriesTab(page: Page) {
  await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR}?tab=series`);
  await expect(page.locator('#series-panel')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /add series/i })).toBeVisible({ timeout: 15000 });
}

/**
 * Start a new event from the calendar's event list, fill the required title,
 * date and time, and wait for the series selector to finish loading.
 */
async function startNewEvent(page: Page, title: string) {
  await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR}`);
  await page.waitForSelector('.event-list', { timeout: 15000 });

  await page.getByRole('button', { name: /create an event/i }).click();
  await page.waitForSelector('#event-form', { timeout: 10000 });

  await page.locator('#event-name-en').fill(title);
  await page.locator('.schedule-grid input[type="date"]').first().fill('2026-08-12');
  await page.locator('.schedule-grid input[type="time"]').first().fill('18:30');

  await expect(page.locator('#series-select')).toBeVisible({ timeout: 10000 });
}

/**
 * Open the inline create-series dialog from the event editor's series
 * selector and return a locator scoped to the open dialog.
 */
async function openInlineSeriesDialog(page: Page) {
  await page.locator('[data-test="add-series-button"]').click();
  const dialog = page.locator('dialog.modal-dialog[open]');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await expect(dialog.getByRole('heading', { name: 'Add a Series' })).toBeVisible();
  return dialog;
}

test.describe('Series management', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('creates, renames and deletes a series from calendar management', async ({ page }) => {
    const urlName = `mgmt-${STAMP}`;
    const seriesName = `Managed Series ${STAMP}`;
    const renamedSeriesName = `Renamed Series ${STAMP}`;

    await gotoSeriesTab(page);

    // Create
    await page.getByRole('button', { name: /add series/i }).click();
    const editor = page.locator('.series-editor-page');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('#series-url-name').fill(urlName);
    await editor.locator('#name-en').fill(seriesName);
    await editor.getByRole('button', { name: 'Create Series' }).click();

    await expect(editor).toBeHidden({ timeout: 10000 });
    const createdCard = page.locator('.series-card').filter({ hasText: seriesName });
    await expect(createdCard).toBeVisible({ timeout: 10000 });
    await expect(createdCard.locator('.series-info__meta')).toHaveText('0 events');

    // Rename
    await createdCard.getByRole('button', { name: 'Edit' }).click();
    await expect(editor).toBeVisible({ timeout: 5000 });
    // The URL name is fixed after creation, so the editor does not offer it.
    await expect(editor.locator('#series-url-name')).toHaveCount(0);

    const nameInput = editor.locator('#name-en');
    await expect(nameInput).toHaveValue(seriesName);
    await nameInput.fill(renamedSeriesName);
    await editor.getByRole('button', { name: 'Save Changes' }).click();

    await expect(editor).toBeHidden({ timeout: 10000 });
    const renamedCard = page.locator('.series-card').filter({ hasText: renamedSeriesName });
    await expect(renamedCard).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.series-card').filter({ hasText: seriesName })).toHaveCount(0);

    // Delete
    await renamedCard.getByRole('button', { name: 'Delete' }).click();
    const confirmDialog = page.locator('dialog.delete-series-modal[open]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await confirmDialog.getByRole('button', { name: 'Delete' }).click();

    await expect(confirmDialog).toBeHidden({ timeout: 10000 });
    await expect(renamedCard).toHaveCount(0, { timeout: 10000 });
  });

  test('creates a series inline from the event editor and assigns the event to it', async ({ page }) => {
    const eventTitle = `Inline Series Event ${STAMP}`;

    await startNewEvent(page, eventTitle);
    const select = page.locator('#series-select');
    await expect(select).toHaveValue('');

    const dialog = await openInlineSeriesDialog(page);
    await dialog.locator('#series-url-name').fill(INLINE_URL_NAME);
    await dialog.locator('#name-en').fill(INLINE_SERIES_NAME);
    await dialog.locator('[data-test="create-series-submit"]').click();

    // The new series is added to the selector and selected
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(select.locator('option:checked')).toHaveText(INLINE_SERIES_NAME);
    await expect(select).not.toHaveValue('');

    // Save the event and return to the list
    await page.locator('button.btn-save').click();
    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}`, { timeout: 15000 });
    await page.waitForSelector('.event-list', { timeout: 10000 });

    const eventItem = page.locator('.event-item').filter({ hasText: eventTitle });
    await expect(eventItem).toBeVisible({ timeout: 10000 });

    // Reopen the event: the series selector shows the assigned series
    await eventItem.locator('.edit-btn').click();
    await page.waitForSelector('#event-form', { timeout: 10000 });
    await expect(page.locator('#series-select option:checked')).toHaveText(INLINE_SERIES_NAME, { timeout: 10000 });

    // The series page counts the assigned event
    await gotoSeriesTab(page);
    const seriesCard = page.locator('.series-card').filter({ hasText: INLINE_SERIES_NAME });
    await expect(seriesCard).toBeVisible({ timeout: 10000 });
    await expect(seriesCard.locator('.series-info__meta')).toHaveText('1 event');
  });

  test('shows the duplicate URL-name error inside the inline dialog', async ({ page }) => {
    await startNewEvent(page, `Duplicate Series Event ${STAMP}`);
    const select = page.locator('#series-select');

    const dialog = await openInlineSeriesDialog(page);
    await dialog.locator('#series-url-name').fill(INLINE_URL_NAME);
    await dialog.locator('#name-en').fill(`Another Series ${STAMP}`);
    await dialog.locator('[data-test="create-series-submit"]').click();

    // The error is reported in the dialog, which stays open
    const alert = dialog.getByRole('alert');
    await expect(alert).toHaveText('A series with this URL name already exists', { timeout: 10000 });
    await expect(dialog).toBeVisible();

    // Cancelling leaves the event's series selection untouched
    await dialog.locator('[data-test="create-series-cancel"]').click();
    await expect(dialog).toBeHidden({ timeout: 5000 });
    await expect(select).toHaveValue('');
    await expect(select.locator('option', { hasText: `Another Series ${STAMP}` })).toHaveCount(0);
  });

  test('removing a translation from a series persists across a reload', async ({ page }) => {
    const urlName = `xlate-${STAMP}`;
    const seriesName = `Translated Series ${STAMP}`;
    const frenchName = `Série traduite ${STAMP}`;
    const frenchTab = page.getByRole('tab', { name: 'Edit French content' });

    await gotoSeriesTab(page);

    // Create the series with English and French content
    await page.getByRole('button', { name: /add series/i }).click();
    const editor = page.locator('.series-editor-page');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('#series-url-name').fill(urlName);
    await editor.locator('#name-en').fill(seriesName);
    await editor.getByRole('button', { name: 'Add language' }).click();
    await expect(page.getByRole('heading', { name: 'Select a Language' })).toBeVisible();
    await page.getByRole('searchbox', { name: /search for a language/i }).fill('French');
    await page.getByRole('button', { name: /^Français\s+French$/ }).click();
    await expect(frenchTab).toHaveAttribute('aria-selected', 'true');
    await editor.locator('#name-fr').fill(frenchName);
    await editor.getByRole('button', { name: 'Create Series' }).click();

    await expect(editor).toBeHidden({ timeout: 10000 });
    const card = page.locator('.series-card').filter({ hasText: seriesName });
    await expect(card).toBeVisible({ timeout: 10000 });

    // Remove the French translation and save
    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await frenchTab.click();
    await expect(editor.locator('#name-fr')).toHaveValue(frenchName);
    await editor.getByRole('button', { name: 'Remove French translation' }).click();
    await expect(frenchTab).toHaveCount(0);
    await editor.getByRole('button', { name: 'Save Changes' }).click();
    await expect(editor).toBeHidden({ timeout: 10000 });

    // After a reload the series still has no French translation
    await gotoSeriesTab(page);
    const reloadedCard = page.locator('.series-card').filter({ hasText: seriesName });
    await expect(reloadedCard).toBeVisible({ timeout: 10000 });
    await reloadedCard.getByRole('button', { name: 'Edit' }).click();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor.locator('#name-en')).toHaveValue(seriesName);
    await expect(frenchTab).toHaveCount(0);
  });
});
