import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Test: Single (non-recurring) event cancel/restore + public Cancelled badge
 *
 * Exercises the single-event cancel flow end-to-end (single-instance, no Docker):
 *
 *   1. Log in as admin and create a single (non-recurring) event.
 *   2. Re-open the event in the editor and use the inline SingleEventCancelControl
 *      to cancel it (show-as-cancelled; the EventCancelConfirmModal is reused with
 *      its hide-from-public toggle suppressed).
 *   3. Assert the Cancelled badge appears on the event's card in the public view
 *      (/view/<calendar>, rendered by src/site/components/event-card.vue).
 *   4. Restore the event from the editor.
 *   5. Assert the Cancelled badge is gone from the public card.
 *
 * Uses the shared isolated test-server harness (in-memory SQLite, fresh seeded
 * admin@pavillion.dev / test_calendar). Runs serially.
 *
 * Selectors of record:
 *   - Cancel control container: [data-testid="single-event-cancel-control"]
 *   - Cancel trigger:           [data-testid="single-event-cancel"]
 *   - Modal confirm:            [data-testid="confirm-submit"]
 *   - Cancelled status text:    [data-testid="single-event-cancelled-status"]
 *   - Restore trigger:          [data-testid="single-event-restore"]
 *   - Public badge:             article.event-card [data-testid="cancelled-badge"]
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

const ADMIN_CALENDAR = 'test_calendar';
const EVENT_TITLE = `Single Cancel Badge E2E ${Date.now()}`;
// A near-future date keeps the event inside the public upcoming-events window
// while remaining a single (non-recurring) occurrence.
const EVENT_DATE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

/**
 * Create a single (non-recurring) event on the admin's calendar and return to
 * the events tab. Leaves exactly one positive schedule so the editor renders
 * SingleEventCancelControl (not the multi-occurrence panel).
 */
async function createSingleEvent(page: Page, title: string): Promise<void> {
  await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR}`);
  await page.waitForSelector('.event-list, [class*="empty"]', { timeout: 15000 });

  await page.getByRole('button', { name: /create an event/i }).click();
  await page.waitForSelector('#event-form', { timeout: 10000 });

  await page.locator('#event-name-en').fill(title);
  await page.locator('.schedule-grid input[type="date"]').first().fill(EVENT_DATE);
  await page.locator('.schedule-grid input[type="time"]').first().fill('14:00');

  await page.locator('button.btn-save').click();

  await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}`, { timeout: 15000 });
  await page.waitForSelector('.event-list', { timeout: 10000 });

  const item = page.locator('.event-item').filter({ hasText: title }).first();
  await expect(item).toBeVisible({ timeout: 10000 });
}

/**
 * Open the named event in the editor via the events-tab pencil button and wait
 * for the SingleEventCancelControl to finish loading its occurrence state.
 */
async function openEditor(page: Page, title: string): Promise<void> {
  await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR}`);
  await page.waitForSelector('.event-list', { timeout: 15000 });

  const item = page.locator('.event-item').filter({ hasText: title }).first();
  await expect(item).toBeVisible({ timeout: 10000 });
  await item.locator('.edit-btn').click();

  await page.waitForSelector('#event-form', { timeout: 10000 });
  await expect(
    page.locator('[data-testid="single-event-cancel-control"]'),
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Locate the public event card for the named event. Uses the public search box
 * to narrow the list to the single matching event regardless of how many
 * seeded events the calendar contains.
 */
async function publicEventCard(page: Page, title: string) {
  await page.goto(`${env.baseURL}/view/${ADMIN_CALENDAR}`);

  const search = page.locator('#public-event-search');
  await search.waitFor({ state: 'visible', timeout: 15000 });
  await search.fill(title);

  // Search is debounced (~300ms) before it updates the rendered list. Wait
  // deterministically for the filtered card rather than sleeping a fixed time;
  // the title filter is unique so exactly one card matches regardless of
  // seeded-event volume.
  const card = page.locator('article.event-card').filter({ hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  return card;
}

test.describe('Single-event cancel/restore + public Cancelled badge', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('cancel shows the badge on the public card; restore removes it', async ({ page }) => {
    // 1. Create a single (non-recurring) event.
    await createSingleEvent(page, EVENT_TITLE);

    // Baseline: the public card exists and is NOT cancelled.
    const baselineCard = await publicEventCard(page, EVENT_TITLE);
    await expect(baselineCard).toBeVisible({ timeout: 15000 });
    await expect(baselineCard.locator('[data-testid="cancelled-badge"]')).toHaveCount(0);

    // 2. Cancel the event from the editor (show-as-cancelled).
    await openEditor(page, EVENT_TITLE);
    await page.locator('[data-testid="single-event-cancel"]').click();

    const confirm = page.locator('[data-testid="confirm-submit"]');
    await expect(confirm).toBeVisible({ timeout: 5000 });
    await confirm.click();

    // The control flips to the cancelled status + Restore button in place.
    await expect(
      page.locator('[data-testid="single-event-cancelled-status"]'),
    ).toBeVisible({ timeout: 10000 });

    // 3. Cancelled badge appears on the public card.
    const cancelledCard = await publicEventCard(page, EVENT_TITLE);
    await expect(cancelledCard).toBeVisible({ timeout: 15000 });
    await expect(cancelledCard.locator('[data-testid="cancelled-badge"]')).toBeVisible({ timeout: 10000 });

    // 4. Restore the event from the editor.
    await openEditor(page, EVENT_TITLE);
    await expect(
      page.locator('[data-testid="single-event-cancelled-status"]'),
    ).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="single-event-restore"]').click();

    // The control flips back to the Cancel trigger.
    await expect(
      page.locator('[data-testid="single-event-cancel"]'),
    ).toBeVisible({ timeout: 10000 });

    // 5. Cancelled badge is gone from the public card.
    const restoredCard = await publicEventCard(page, EVENT_TITLE);
    await expect(restoredCard).toBeVisible({ timeout: 15000 });
    await expect(restoredCard.locator('[data-testid="cancelled-badge"]')).toHaveCount(0);
  });
});
