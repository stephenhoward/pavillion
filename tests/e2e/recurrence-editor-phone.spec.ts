import { test, expect, Page, Locator } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Recurrence editor sheet at phone width
 *
 * At 390px the weekly "on" row used to lay its seven weekday chips out on
 * one line with a hidden scrollbar, so the later days sat out of view and a
 * tap aimed at them landed on the controls below. These cases check that
 * every chip fits, and that the fewer-than-two-occurrences warning and the
 * Done button stay on screen.
 *
 * Runs in the Chromium project and, through its testMatch entry, the WebKit
 * (iPhone 13) project.
 */

const VIEWPORT = { width: 390, height: 844 };

let env: TestEnvironment;

test.use({ viewport: VIEWPORT });

async function openRecurrenceSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /add recurrence/i }).click();
  const dialog = page.locator('dialog[aria-modal="true"]');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await expect(dialog.locator('form.repeats')).toBeVisible({ timeout: 5000 });
  return dialog;
}

function expectWithinViewport(box: { x: number; y: number; width: number; height: number }) {
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width);
  expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height);
}

test.describe('Recurrence editor at phone width', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    await page.goto(env.baseURL + '/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });
    await page.getByRole('button', { name: 'Create an Event' }).click();
    await page.waitForSelector('[role="group"][aria-label="Event Schedules"]', { timeout: 10000 });
  });

  test('all seven weekday chips fit inside the chip row and the viewport', async ({ page }) => {
    const dialog = await openRecurrenceSheet(page);
    await dialog.locator('.frequency-select').selectOption('weekly');

    const container = dialog.locator('fieldset.week-parameters .weekday-chips');
    await expect(container).toBeVisible({ timeout: 5000 });

    const chips = container.locator('label');
    await expect(chips).toHaveCount(7);

    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();

    for (let i = 0; i < 7; i++) {
      const box = await chips.nth(i).boundingBox();
      expect(box, `chip ${i} has a box`).not.toBeNull();
      expect(box!.x, `chip ${i} left edge`).toBeGreaterThanOrEqual(containerBox!.x);
      expect(box!.x + box!.width, `chip ${i} right edge`)
        .toBeLessThanOrEqual(containerBox!.x + containerBox!.width);
      expect(box!.x + box!.width, `chip ${i} right edge in viewport`)
        .toBeLessThanOrEqual(VIEWPORT.width);
    }

    const { scrollWidth, clientWidth } = await container.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('the warning and the Done button stay in view for "after 1"', async ({ page }) => {
    const dialog = await openRecurrenceSheet(page);
    await dialog.locator('.frequency-select').selectOption('weekly');

    const endType = dialog.locator('fieldset.end-type');
    await endType.locator('input[type="radio"][value="after"]').check();
    await endType.locator('input[type="number"]').fill('1');
    await endType.locator('input[type="number"]').dispatchEvent('change');

    const warning = dialog.locator('[role="status"].recurrence-warning');
    await expect(warning).toHaveClass(/recurrence-warning--active/);
    await expect(warning).not.toBeEmpty();

    // The sheet is capped below the viewport height and scrolls, so bring
    // Done into view as the owner would; the warning must be on screen with it.
    const done = dialog.getByRole('button', { name: /^done$/i });
    await done.scrollIntoViewIfNeeded();
    await expect(done).toBeVisible();

    const warningBox = await warning.boundingBox();
    const doneBox = await done.boundingBox();
    expect(warningBox).not.toBeNull();
    expect(doneBox).not.toBeNull();
    expectWithinViewport(warningBox!);
    expectWithinViewport(doneBox!);
  });
});
