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
  settingsRootList,
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
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE });

/** Press Download and wait for the browser's download of the file. */
async function downloadExport(page: Page): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
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
    await axios.patch(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/settings`,
      { content: { fr: { name: 'Calendrier de test', imageAlt: '' } } },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  });

  test.afterAll(async () => {
    await env?.cleanup();
  });

  test('the owner opens Export by the drill-down and downloads a parseable file per language', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    const main = page.getByRole('main');

    await gotoSettings(page, env.baseURL, settingsRootList);
    // Scoped to main: the bottom bar has its own "Calendar" link.
    await settingsRow(main, 'Calendar').click();
    await settingsRow(main, 'Export').click();
    await expect(settingsTitle(page, 'Export')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${calendarLeafPath(ADMIN_CALENDAR_URL_NAME, 'export')}$`));

    const picker = page.getByLabel('Language');
    await expect(picker).toHaveValue('en');
    const options = await picker.locator('option').evaluateAll(
      (nodes) => nodes.map((node) => (node as HTMLOptionElement).value),
    );
    expect(options).toEqual(['en', 'es', 'fr']);

    const english = await downloadExport(page);
    expect(english.suggestedFilename()).toBe(`${ADMIN_CALENDAR_URL_NAME}-en.ics`);
    const englishEvents = await vevents(english);
    expect(englishEvents.length).toBeGreaterThan(0);
    expect(englishEvents.some((event) => typeof event.summary === 'string' && event.summary.length > 0)).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: `${ADMIN_CALENDAR_URL_NAME}-en.ics` })).toBeVisible();

    // No event has French text: the server falls back, and still accepts fr.
    await picker.selectOption('fr');
    const french = await downloadExport(page);
    expect(french.suggestedFilename()).toBe(`${ADMIN_CALENDAR_URL_NAME}-fr.ics`);
    expect((await vevents(french)).length).toBeGreaterThan(0);
  });
});
