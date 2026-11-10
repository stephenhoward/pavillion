import { test, expect } from '@playwright/test';
import axios from 'axios';
import { loginViaUi } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  LOCAL_DOMAIN,
  TESTUSER_CALENDAR_ID,
  TESTUSER_CALENDAR_URL_NAME,
  TESTUSER_EMAIL,
  TESTUSER_PASSWORD,
  loginViaApi,
} from './helpers/notification-fixtures';

/**
 * E2E Tests: the followed-calendars feed loads past its first page
 *
 * The feed asks the server for 20 events at a time. A calendar following
 * more than that must still reach every event, by keyboard, and see where
 * the feed ends — otherwise older events cannot be reposted by hand.
 */

const SOURCE_URL_NAME = 'paged_source';
// One more than a full page plus a couple, so the oldest sits on page two.
const EVENT_COUNT = 23;
const eventName = (i: number) => `Paged Event ${String(i).padStart(2, '0')}`;

let env: TestEnvironment;

test.describe('Feed load more', () => {
  test.beforeAll(async () => {
    // An FQDN-shaped domain makes `${urlName}@${LOCAL_DOMAIN}` resolve as a
    // local follow (see LOCAL_DOMAIN in notification-fixtures).
    env = await startTestServer({ extraEnv: { LOCAL_DOMAIN } });

    const adminToken = await loginViaApi(env.baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    const adminAuth = { headers: { Authorization: `Bearer ${adminToken}` } };

    const calendar = await axios.post(
      `${env.baseURL}/api/v1/calendars`,
      { urlName: SOURCE_URL_NAME, content: { en: { name: 'Paged Source' } } },
      adminAuth,
    );

    // Created oldest first, so eventName(0) is the last event in the feed.
    for (let i = 0; i < EVENT_COUNT; i++) {
      await axios.post(
        `${env.baseURL}/api/v1/events`,
        {
          calendarId: calendar.data.id,
          content: { en: { name: eventName(i) } },
          schedules: [{ start: '2030-06-01T18:00:00Z', eventEndTime: '2030-06-01T20:00:00Z' }],
        },
        adminAuth,
      );
    }

    const testUserToken = await loginViaApi(env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);
    await axios.post(
      `${env.baseURL}/api/v1/social/follows`,
      {
        calendarId: TESTUSER_CALENDAR_ID,
        remoteCalendar: `${SOURCE_URL_NAME}@${LOCAL_DOMAIN}`,
        autoRepostOriginals: false,
        autoRepostReposts: false,
      },
      { headers: { Authorization: `Bearer ${testUserToken}` } },
    );
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('reaches the oldest followed event by keyboard and reposts it', async ({ page }) => {
    await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);
    await page.goto(`${env.baseURL}/feed/${TESTUSER_CALENDAR_URL_NAME}`);

    const items = page.getByTestId('event-item');
    const oldest = items.filter({ has: page.getByRole('heading', { name: eventName(0), exact: true }) });

    await expect(items.filter({ has: page.getByRole('heading', { name: eventName(EVENT_COUNT - 1) }) })).toBeVisible();
    await expect(oldest).toHaveCount(0);

    // Load pages from the keyboard until the feed says it has ended.
    const loadMore = page.getByRole('button', { name: 'Load more events' });
    const status = page.getByRole('status').filter({ hasText: /more events? loaded/ });
    while (await loadMore.isVisible()) {
      const before = await items.count();
      await loadMore.focus();
      await page.keyboard.press('Enter');
      await expect(items).not.toHaveCount(before);
      await expect(status).not.toBeEmpty();
      // Focus lands on the first event the page added.
      await expect(items.nth(before)).toBeFocused();
    }

    await expect(page.getByText('That\'s every event from the calendars you follow.').first()).toBeVisible();
    await expect(oldest).toHaveCount(1);

    // The source calendar has no categories, so Repost acts without a dialog.
    await oldest.getByRole('button', { name: `Repost event: ${eventName(0)}` }).click();
    await expect(oldest.getByRole('button', { name: `Remove repost for: ${eventName(0)}` })).toBeVisible();
  });
});
