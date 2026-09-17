import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Translatable image alt text
 *
 * The end-to-end proof for the alt-text feature: what an organizer types into
 * the event editor's alt-text editor is what a screen reader is handed on the
 * public event page, in the visitor's own language.
 *
 * Three behaviours, chained on one event so the flow reads as one session:
 *
 * 1. Describe in two languages — the public page emits the English alt to an
 *    English visitor and the French alt to a French visitor.
 * 2. Per-language fallback — alt written in English but left blank in French
 *    is still announced to a French visitor, rather than the image silently
 *    going decorative for them.
 * 3. Decorative — the public page emits alt="", not a missing attribute and
 *    not the event name. This is the regression the feature exists to fix.
 *
 * Tests are serial and share one test server and one event; each step starts
 * from the state the previous one saved.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_IMAGE_PATH = path.resolve(__dirname, 'fixtures/test-image.png');

const ENGLISH_TITLE = `Alt Text Event ${Date.now()}`;
const FRENCH_TITLE = `Evenement texte alternatif ${Date.now()}`;
const ENGLISH_ALT = 'A brass band playing under a striped marquee';
const FRENCH_ALT = 'Une fanfare joue sous un chapiteau raye';

let env: TestEnvironment;

/** The event created by the first test and re-edited by the ones after it. */
let eventId = '';

test.describe.configure({ mode: 'serial' });

/**
 * Opens the event editor for the shared event and waits for the attached
 * image — the alt editor shares the image's mount condition, so the workspace
 * being on screen is what says the alt editor is there to interact with.
 *
 * @param page - Playwright page
 */
async function openEditorWithImage(page: Page): Promise<void> {
  await page.goto(`${env.baseURL}/event/${eventId}`);
  await expect(page.locator('#event-form')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.image-workspace .workspace-image')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.image-alt-editor')).toBeVisible();
}

/**
 * Saves the open editor and waits for the return to the calendar view, which
 * only happens after the save request has succeeded.
 *
 * @param page - Playwright page
 */
async function saveEditor(page: Page): Promise<void> {
  await page.locator('button.btn-save').click();
  await page.waitForURL('**/calendar/test_calendar', { timeout: 15000 });
}

/**
 * Loads the public event page in the given locale and asserts the alt text the
 * image is announced with.
 *
 * The public page is a separate app from the editor, reached anonymously at the
 * calendar's root URL (DEC-018), with a locale prefix for anything but English.
 *
 * @param page - Playwright page
 * @param locale - Visitor locale ('en' takes no URL prefix)
 * @param expectedTitle - The event title expected in that locale
 * @param expectedAlt - The alt attribute the hero image must carry
 */
async function expectPublicAlt(
  page: Page,
  locale: string,
  expectedTitle: string,
  expectedAlt: string,
): Promise<void> {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  await page.goto(`${env.baseURL}${prefix}/test_calendar/events/${eventId}`);

  await expect(page.locator('h1.event-title')).toHaveText(expectedTitle, { timeout: 15000 });

  // The hero <img> only renders once its bytes have been fetched, so waiting
  // for the element is also waiting for media processing to finish.
  const heroImage = page.locator('.hero-image-wrapper .event-image img');
  await expect(heroImage).toHaveAttribute('alt', expectedAlt, { timeout: 30000 });
}

test.describe('Event image alt text', () => {
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

  test('describes an image in two languages and announces each on the public page', async ({ page }) => {
    await page.goto(`${env.baseURL}/calendar/test_calendar`);
    await expect(page.locator('.event-list')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /create an event/i }).click();
    await expect(page.locator('#event-form')).toBeVisible({ timeout: 15000 });

    // English content and a future date, so the event has a public page.
    await page.locator('#event-name-en').fill(ENGLISH_TITLE);
    await page.locator('.schedule-grid input[type="date"]').first().fill('2026-12-15');
    await page.locator('.schedule-grid input[type="time"]').first().fill('19:00');

    // The alt editor only exists once an image does.
    await expect(page.locator('.image-alt-editor')).toHaveCount(0);
    await page.locator('input.file-input').setInputFiles(TEST_IMAGE_PATH);
    await expect(page.locator('.image-workspace .workspace-image')).toBeVisible({ timeout: 15000 });

    const altEditor = page.locator('.image-alt-editor');
    await expect(altEditor).toBeVisible();

    // Decorative is the default; describing the image is a deliberate choice.
    await expect(page.getByRole('radio', { name: 'Skip description' })).toBeChecked();
    await page.getByRole('radio', { name: 'Add a description' }).check();

    await page.getByLabel('Image description (English)').fill(ENGLISH_ALT);

    // Adding a language selects it, so the fields below switch to French.
    await page.getByRole('button', { name: 'Add language' }).click();
    await expect(page.getByRole('heading', { name: 'Select a Language' })).toBeVisible();
    await page.getByRole('searchbox', { name: /search for a language/i }).fill('French');
    await page.getByRole('button', { name: /^Français\s+French$/ }).click();

    await expect(page.getByRole('tab', { name: 'Edit French content' })).toHaveAttribute('aria-selected', 'true');
    await page.locator('#event-name-fr').fill(FRENCH_TITLE);

    // The alt editor follows the panel's language tabs; it has no tabs of its own.
    const frenchAlt = page.getByLabel('Image description (French)');
    await expect(frenchAlt).toBeVisible();
    await expect(frenchAlt).toHaveValue('');
    await frenchAlt.fill(FRENCH_ALT);

    const created = page.waitForResponse(
      response => response.url().endsWith('/api/v1/events')
        && response.request().method() === 'POST'
        && response.status() === 201,
    );
    await page.locator('button.btn-save').click();
    eventId = (await (await created).json()).id;
    expect(eventId).toBeTruthy();

    await page.waitForURL('**/calendar/test_calendar', { timeout: 15000 });

    await expectPublicAlt(page, 'en', ENGLISH_TITLE, ENGLISH_ALT);
    await expectPublicAlt(page, 'fr', FRENCH_TITLE, FRENCH_ALT);
  });

  test('announces the English alt to a French visitor when French alt is blank', async ({ page }) => {
    await openEditorWithImage(page);

    // The editor reopens in Describe because a language still carries alt text.
    await expect(page.getByRole('radio', { name: 'Add a description' })).toBeChecked();

    await page.getByRole('tab', { name: 'Edit French content' }).click();
    const frenchAlt = page.getByLabel('Image description (French)');
    await expect(frenchAlt).toHaveValue(FRENCH_ALT);
    await frenchAlt.fill('');

    await saveEditor(page);

    // Alt resolves per field, not per content row: the French row still exists
    // and carries the French title, but its blank alt falls through to English
    // rather than making the image decorative for French visitors alone.
    await expectPublicAlt(page, 'fr', FRENCH_TITLE, ENGLISH_ALT);
    await expectPublicAlt(page, 'en', ENGLISH_TITLE, ENGLISH_ALT);
  });

  test('marks the image decorative and emits an empty alt on the public page', async ({ page }) => {
    await openEditorWithImage(page);

    await page.getByRole('radio', { name: 'Skip description' }).check();

    // Switching to Decorative clears the model and warns that the text written
    // so far is about to go.
    await expect(page.getByLabel('Image description (English)')).toHaveCount(0);
    await expect(page.locator('.image-alt-editor__stash-note')).toBeVisible();

    await saveEditor(page);

    // The point of the feature: a decorative image is announced as decorative —
    // an empty alt attribute, not a missing one and not the event's name.
    await expectPublicAlt(page, 'en', ENGLISH_TITLE, '');
    await expectPublicAlt(page, 'fr', FRENCH_TITLE, '');
  });
});
