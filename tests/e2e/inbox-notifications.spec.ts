import { test, expect, type Page } from '@playwright/test';
import axios from 'axios';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Inbox notification write surface (pv-jehu)
 *
 * Covers the PATCH /api/v1/notification/:id endpoint end-to-end through
 * the live server.
 *
 * Two layers:
 *
 *   1. Boundary contract tests against the API directly: 404 for unknown /
 *      malformed ids (no existence leak), 400 for empty bodies, 401 for
 *      anonymous requests, and a smoke load of /inbox itself.
 *
 *   2. A happy-path test that actually creates a notification via the Follow
 *      flow (the TestUser account follows the admin's test_calendar via
 *      `POST /api/v1/social/follows`), then drives the inbox UI as admin to
 *      mark the row seen and to dismiss it. The follow round-trip uses the
 *      local-loopback path (outbox → in-process dispatch → inbox →
 *      `activitypub:calendar:followed` → NotificationEventHandlers), so it
 *      exercises the same code path as a federated Follow without needing
 *      a second instance.
 *
 * The wire-level error responses are also covered exhaustively by the API
 * integration tests in `src/server/notifications/test/api.test.ts`; this
 * spec proves the endpoint is mounted on the routing table and reachable
 * through the full HTTP + auth stack in a real server, AND that the UI
 * actually responds to the resulting state transitions.
 */

let env: TestEnvironment;

// testuser_calendar (TestUser) seed IDs — see layouts/development/db/.
// TestUser is the account; testuser_calendar is the calendar TestUser owns
// and that we have TestUser issue the Follow from.
const TESTUSER_EMAIL = 'test@example.com';
const TESTUSER_PASSWORD = 'test';
const TESTUSER_CALENDAR_ID = 'cbe74815-939e-48b3-af44-1cd4eb3671bb';
const ADMIN_CALENDAR_ID = 'c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3';
const ADMIN_CALENDAR_URL_NAME = 'test_calendar';

// Override the AP `domain` config to a FQDN-shaped value. The default
// (`localhost:3000`) is rejected by ActivityPubService.isValidDomain's
// strict regex, which would 400 the Follow request before it ever
// reached the local-loopback branch in lookupRemoteCalendar. The
// happy-path test needs an FQDN-shaped local domain so that
// `${urlName}@${LOCAL_DOMAIN}` validates AND matches `localDomain`
// for the local-calendar shortcut.
const LOCAL_DOMAIN = 'pavillion.test';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer({ extraEnv: { LOCAL_DOMAIN } });
});

test.afterAll(async () => {
  if (env?.cleanup) {
    await env.cleanup();
  }
});

/**
 * Read the JWT the SPA wrote to localStorage after `loginAsAdmin`.
 * `page.request.*` does not automatically attach the Bearer token
 * because the SPA's axios interceptor lives in the browser; tests
 * that hit JSON APIs directly must read the JWT and pass it
 * explicitly as an Authorization header.
 */
async function authHeader(page: Page): Promise<Record<string, string>> {
  const jwt = await page.evaluate(() => window.localStorage.getItem('jwt'));
  if (!jwt) {
    throw new Error('Expected a JWT in localStorage after loginAsAdmin');
  }
  return { authorization: `Bearer ${jwt}` };
}

test.describe('Inbox notification PATCH endpoint', () => {
  test('returns 404 for an unknown notification id (existence-not-leak invariant)', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    const headers = await authHeader(page);

    // A random UUID that does not correspond to any seeded recipient row.
    // The route must return 404 — never 200 with an empty body, never 403.
    const response = await page.request.patch(
      `${env.baseURL}/api/v1/notification/00000000-0000-4000-8000-000000000000`,
      { headers, data: { seen: true } },
    );

    expect(response.status()).toBe(404);
  });

  test('returns 404 for a malformed id (collapses with the no-row case)', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    const headers = await authHeader(page);

    const response = await page.request.patch(
      `${env.baseURL}/api/v1/notification/not-a-uuid`,
      { headers, data: { seen: true } },
    );

    expect(response.status()).toBe(404);
  });

  test('returns 400 for an empty PATCH body', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    const headers = await authHeader(page);

    const response = await page.request.patch(
      `${env.baseURL}/api/v1/notification/00000000-0000-4000-8000-000000000000`,
      { headers, data: {} },
    );

    expect(response.status()).toBe(400);
  });

  test('returns 401 for an unauthenticated request', async ({ request }) => {
    // Use the test runner's bare request fixture (no auth cookies) to
    // hit the endpoint anonymously. The loggedInOnly middleware must
    // reject before the route handler runs.
    const response = await request.patch(
      `${env.baseURL}/api/v1/notification/00000000-0000-4000-8000-000000000000`,
      { data: { seen: true } },
    );

    expect([401, 403]).toContain(response.status());
  });

  test('inbox page renders without errors for the logged-in admin', async ({ page }) => {
    // Smoke test that the inbox UI itself loads cleanly with the new
    // PATCH-driven interaction handlers in place.
    await loginAsAdmin(page, env.baseURL);

    await page.goto(env.baseURL + '/inbox');
    // The heading is always rendered, regardless of whether any rows exist.
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('Inbox notification happy path (Follow → seen → dismiss)', () => {
  /**
   * Authenticate a non-admin account against the running server and return
   * a JWT bearer token suitable for API requests. Used to drive the Follow
   * action as TestUser; the UI helpers are admin-only.
   */
  async function getJwtFor(email: string, password: string): Promise<string> {
    const response = await axios.post(`${env.baseURL}/api/auth/v1/login`, {
      email,
      password,
    });
    // The login endpoint returns the JWT as a bare string body.
    return response.data;
  }

  /**
   * Poll the authenticated /api/v1/notification endpoint until a matching
   * row appears or the timeout elapses. The Follow round-trip goes
   * outbox → in-process inbox dispatch → bus event → notification recipient
   * insert, so the row arrives asynchronously and we need to wait it out
   * rather than assume the first GET sees it.
   */
  async function waitForNotificationRow(
    page: Page,
    predicate: (row: any) => boolean,
    timeoutMs = 15000,
  ): Promise<any> {
    const headers = await authHeader(page);
    const deadline = Date.now() + timeoutMs;
    let lastBody: any = null;
    while (Date.now() < deadline) {
      const response = await page.request.get(`${env.baseURL}/api/v1/notification`, { headers });
      if (response.ok()) {
        lastBody = await response.json();
        const match = lastBody.find(predicate);
        if (match) {
          return match;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(
      `Timed out waiting for notification row; last response body: ${JSON.stringify(lastBody)}`,
    );
  }

  test('happy path: row appears unread, click marks it seen, dismiss removes it', async ({ page }) => {
    // Step 1: TestUser (owner of testuser_calendar) follows admin's
    // test_calendar. The Follow loops through the local AP outbox/inbox
    // path and produces a Follow notification addressed to test_calendar's
    // editors — i.e. the admin account.
    //
    // The remoteCalendar handle uses the LOCAL_DOMAIN override (see
    // beforeAll) so it both satisfies ActivityPubService.isValidDomain's
    // FQDN regex AND matches the server's configured local domain,
    // which routes the lookup through the local-calendar shortcut
    // without making any HTTP calls.
    const testuserToken = await getJwtFor(TESTUSER_EMAIL, TESTUSER_PASSWORD);
    const remoteCalendarHandle = `${ADMIN_CALENDAR_URL_NAME}@${LOCAL_DOMAIN}`;

    const followResponse = await axios.post(
      `${env.baseURL}/api/v1/social/follows`,
      {
        calendarId: TESTUSER_CALENDAR_ID,
        remoteCalendar: remoteCalendarHandle,
      },
      {
        headers: { Authorization: `Bearer ${testuserToken}` },
        validateStatus: () => true,
      },
    );
    // Either the follow succeeded or it already existed (409). Both are
    // acceptable starting states for the happy-path UI assertions — the
    // notification row only needs to exist, not necessarily be brand-new.
    expect(
      [200, 409],
      `unexpected follow response: ${followResponse.status} ${JSON.stringify(followResponse.data)}`,
    ).toContain(followResponse.status);

    // Step 2: Log in as admin and wait for the Follow notification to
    // surface through the local-loopback round-trip.
    await loginAsAdmin(page, env.baseURL);

    const followRow = await waitForNotificationRow(
      page,
      (row: any) =>
        row.verb === 'Follow'
        && row.object?.type === 'calendar'
        && row.object?.id === ADMIN_CALENDAR_ID,
    );

    expect(followRow.seen).toBe(false);
    const followRowId: string = followRow.id;

    // Step 3: Load /inbox and assert the unread row is visible AND
    // carries the unread modifier class. The data-testid is stable across
    // rows; we narrow with hasText against the localized follow suffix.
    await page.goto(env.baseURL + '/inbox');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({
      timeout: 5000,
    });

    const unreadRow = page
      .locator('[data-testid="notification-item"]')
      .filter({ hasText: 'followed your calendar' })
      .first();
    await expect(unreadRow).toBeVisible({ timeout: 5000 });
    await expect(unreadRow).toHaveClass(/notification-item--unread/);

    // Step 4: Click the row. The handler PATCHes /notification/:id with
    // { seen: true } and the store mutates the local row, so the unread
    // class drops on the next tick. The server-side `seen_at` flip is
    // independently verifiable through the API.
    await unreadRow.click();
    await expect(unreadRow).not.toHaveClass(/notification-item--unread/, { timeout: 5000 });

    const adminHeaders = await authHeader(page);
    const afterSeenResponse = await page.request.get(`${env.baseURL}/api/v1/notification`, { headers: adminHeaders });
    expect(afterSeenResponse.ok()).toBe(true);
    const afterSeenBody = await afterSeenResponse.json();
    const stillThere = afterSeenBody.find((r: any) => r.id === followRowId);
    expect(stillThere).toBeTruthy();
    expect(stillThere.seen).toBe(true);

    // Step 5: Dismiss the row. The dismiss button PATCHes with
    // { dismissed: true } and the store splices the row out of the
    // local list. The server-side filter (pv-d84j.4) then keeps it out of
    // subsequent GETs, so the row disappears from both the UI and the API.
    const dismissButton = unreadRow.locator('[data-testid="notification-dismiss"]');
    await dismissButton.click();

    await expect(
      page
        .locator('[data-testid="notification-item"]')
        .filter({ hasText: 'followed your calendar' }),
    ).toHaveCount(0, { timeout: 5000 });

    const afterDismissResponse = await page.request.get(`${env.baseURL}/api/v1/notification`, { headers: adminHeaders });
    const afterDismissBody = await afterDismissResponse.json();
    expect(afterDismissBody.find((r: any) => r.id === followRowId)).toBeUndefined();
  });
});

