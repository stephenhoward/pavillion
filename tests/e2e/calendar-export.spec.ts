import { readFileSync } from 'node:fs';
import { test, expect, type Download, type Page } from '@playwright/test';
import axios from 'axios';
import ical from 'node-ical';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  ADMIN_CALENDAR_ID,
  ADMIN_CALENDAR_URL_NAME,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  loginViaApi,
} from './helpers/notification-fixtures';
import {
  PHONE,
  calendarLeafPath,
  gotoSettings,
  settingsPath,
  settingsRow,
  settingsTitle,
} from './helpers/settings-nav';

/**
 * E2E Tests: an owner exports their calendar as one .ics file, at phone size.
 *
 * Listed in the webkit project (iPhone 13) as well as chromium; the file-scope
 * phone viewport puts the chromium run through the same drill-down.
 *
 * The seeded calendar's languages column says en,es. Setup gives it French
 * content through the API, which the column never learns, so a picker that
 * offers en, es and fr can only have read the export endpoint's list.
 *
 * Setup also saves Spanish as the owner's language. The list starts with en,
 * so a picker pre-filled with es shows the interface-language default, not
 * the first-entry fallback. The UI is therefore in Spanish, and every label
 * below is read from the es locale files rather than written out.
 */

/** A string from a client locale file, by dotted key. */
function esString(namespace: 'settings' | 'calendars', key: string): string {
  const file = new URL(`../../src/client/locales/es/${namespace}.json`, import.meta.url);
  const bundle = JSON.parse(readFileSync(file, 'utf8'));
  const value = key.split('.').reduce((node, part) => node?.[part], bundle);
  if (typeof value !== 'string') {
    throw new Error(`es/${namespace}.json has no string at ${key}`);
  }
  return value;
}

const ES = {
  settingsTitle: esString('settings', 'titles.settings'),
  calendarRow: esString('settings', 'nav.root.calendar'),
  exportRow: esString('settings', 'nav.calendar.export'),
  languageLabel: esString('calendars', 'export.language_label'),
  downloadButton: esString('calendars', 'export.download_button'),
};

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE });

/** Press Download and wait for the browser's download of the file. */
async function downloadExport(page: Page): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: ES.downloadButton, exact: true }).click(),
  ]);
  return download;
}

/** The VEVENTs in a downloaded .ics file. */
async function vevents(download: Download) {
  const path = await download.path();
  const parsed = ical.sync.parseICS(readFileSync(path, 'utf8'));
  return Object.values(parsed).filter((component) => component?.type === 'VEVENT');
}

test.describe('Calendar export', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
    const token = await loginViaApi(env.baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    await axios.patch(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/settings`,
      { content: { fr: { name: 'Calendrier de test', imageAlt: '' } } },
      auth,
    );
    await axios.patch(`${env.baseURL}/api/v1/accounts/me/profile`, { language: 'es' }, auth);
  });

  test.afterAll(async () => {
    await env?.cleanup();
  });

  test('the owner opens Export by the drill-down and downloads a parseable file per language', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    const main = page.getByRole('main');

    await gotoSettings(page, env.baseURL, { path: settingsPath.root, title: ES.settingsTitle });
    // Scoped to main: the bottom bar has its own calendar link.
    await settingsRow(main, ES.calendarRow).click();
    await settingsRow(main, ES.exportRow).click();
    await expect(settingsTitle(page, ES.exportRow)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'export')}$`));

    const picker = page.getByLabel(ES.languageLabel, { exact: true });
    const options = await picker.locator('option').evaluateAll(
      (nodes) => nodes.map((node) => (node as HTMLOptionElement).value),
    );
    expect(options).toEqual(['en', 'es', 'fr']);
    // The interface language, though the list starts with en.
    await expect(picker).toHaveValue('es');

    const spanish = await downloadExport(page);
    expect(spanish.suggestedFilename()).toBe(`${ADMIN_CALENDAR_URL_NAME}-es.ics`);
    const spanishEvents = await vevents(spanish);
    expect(spanishEvents.length).toBeGreaterThan(0);
    expect(spanishEvents.some((event) => typeof event.summary === 'string' && event.summary.length > 0)).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: `${ADMIN_CALENDAR_URL_NAME}-es.ics` })).toBeVisible();

    // No event has French text: the server falls back, and still accepts fr.
    await picker.selectOption('fr');
    const french = await downloadExport(page);
    expect(french.suggestedFilename()).toBe(`${ADMIN_CALENDAR_URL_NAME}-fr.ics`);
    expect((await vevents(french)).length).toBeGreaterThan(0);
  });
});
