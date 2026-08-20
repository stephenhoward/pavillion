import { test, expect, type Page } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import {
  ADMIN_CALENDAR_URL_NAME,
  ADMIN_EMAIL,
  ADMIN_EVENT_ID,
  ADMIN_PASSWORD,
  FRESHUSER_EMAIL,
  FRESHUSER_PASSWORD,
  LOCAL_DOMAIN,
  TESTUSER_CALENDAR_URL_NAME,
  TESTUSER_EMAIL,
  TESTUSER_PASSWORD,
  loginViaUi,
  seedNotificationFixtures,
  type NotificationFixtures,
} from './helpers/notification-fixtures';

/**
 * E2E Tests: inbox row navigation, the `?report=` deep link, and row keyboard
 * order (pv-mvfk.7).
 *
 * Kept out of `inbox-notifications.spec.ts` deliberately: that file is a
 * serial block covering the PATCH write surface, and these concerns share
 * none of its state.
 *
 * ## Why four navigation cases and not five
 *
 * Five verbs produce a linked row, but they resolve to only four target
 * kinds — `event`, `calendar`, `moderation_report`, `owner_report`. The
 * verb→kind mapping is exhaustively covered at the unit tier
 * (`src/server/notifications/test/notification-target.test.ts` and
 * `src/client/test/service/notification-target.test.ts`). What only e2e can
 * prove is that a *kind* resolves through the real router to a real page, so
 * there is exactly one case per kind and each names the verb standing in for
 * it. `ReportEscalated` and `ReportResolved` map to the same two report kinds
 * as `Flag` and are intentionally not given their own e2e cases.
 *
 * The two report cases run against the **same** `reportId` viewed by two
 * different accounts, so they pin the server-side role branch rather than two
 * unrelated fixtures.
 */

let env: TestEnvironment;
let fixtures: NotificationFixtures;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer({ extraEnv: { LOCAL_DOMAIN } });
  fixtures = await seedNotificationFixtures(env.baseURL);
});

test.afterAll(async () => {
  if (env?.cleanup) {
    await env.cleanup();
  }
});

/**
 * Open /inbox and return the single row whose sentence contains `sentence`.
 *
 * Each fixture verb renders a distinct sentence, so the visible wording is a
 * stable narrowing key across rows that all share one `data-testid`.
 */
async function inboxRow(page: Page, sentence: string) {
  await page.goto(env.baseURL + '/inbox');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({
    timeout: 10000,
  });
  const row = page
    .locator('[data-testid="notification-item"]')
    .filter({ hasText: sentence })
    .first();
  await expect(row).toBeVisible({ timeout: 10000 });
  return row;
}

/**
 * Open /inbox and return the report row for `reportId`.
 *
 * The two report cases cannot narrow on the sentence alone: an instance admin
 * receives a `Flag` row for *every* report on the instance, and the fixtures
 * deliberately create a second report on another calendar for the
 * unauthorised deep-link case. Narrowing on the report id in the row's own
 * link is what keeps the admin case and the owner case pinned to the same
 * report — which is the whole point of the pair.
 */
async function inboxReportRow(page: Page, reportId: string) {
  await page.goto(env.baseURL + '/inbox');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({
    timeout: 10000,
  });
  const row = page
    .locator('[data-testid="notification-item"]')
    .filter({ hasText: 'flagged' })
    .filter({ has: page.locator(`a.object-link[href*="${reportId}"]`) });
  await expect(row).toHaveCount(1, { timeout: 10000 });
  return row;
}

test.describe('Inbox row navigation — one case per target kind', () => {
  test('event target (verb: Announce) opens the event editor', async ({ page }) => {
    // `Announce` stands in for the `event` kind. It is the only verb that
    // derives `{ kind: 'event' }`; the mapping itself is unit-tested.
    await loginViaUi(page, env.baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);

    const row = await inboxRow(page, 'reposted');
    await row.locator('a.object-link').click();

    await page.waitForURL(`**/event/${ADMIN_EVENT_ID}`, { timeout: 10000 });
    expect(page.url()).toBe(`${env.baseURL}/event/${ADMIN_EVENT_ID}`);
  });

  test('calendar target (verb: EditorInvited) opens calendar management', async ({ page }) => {
    // `EditorInvited` stands in for the `calendar` kind. `EditorRevoked`
    // stores the same object shape but deliberately derives `null`, which is
    // a unit-tier distinction, not a routing one.
    await loginViaUi(page, env.baseURL, FRESHUSER_EMAIL, FRESHUSER_PASSWORD);

    const row = await inboxRow(page, 'invited you to edit');
    await row.locator('a.object-link').click();

    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR_URL_NAME}/manage`, { timeout: 10000 });
    expect(page.url()).toBe(`${env.baseURL}/calendar/${ADMIN_CALENDAR_URL_NAME}/manage`);
  });

  test('moderation_report target (verb: Flag, viewed as instance admin) opens the moderation queue', async ({ page }) => {
    // `Flag` stands in for both report kinds. Seen by an instance admin the
    // same row resolves to the admin moderation surface. `ReportEscalated`
    // and `ReportResolved` reach this identical branch — verb→kind is
    // unit-tier, so they get no separate e2e case.
    await loginViaUi(page, env.baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);

    const row = await inboxReportRow(page, fixtures.ownedReportId);
    await row.locator('a.object-link').click();

    await page.waitForURL(`**/admin/moderation/reports/${fixtures.ownedReportId}`, { timeout: 10000 });
    expect(page.url()).toBe(`${env.baseURL}/admin/moderation/reports/${fixtures.ownedReportId}`);
  });

  test('owner_report target (verb: Flag, same report viewed as the calendar owner) opens the calendar reports tab', async ({ page }) => {
    // The same `Flag` row and the SAME reportId as the case above, viewed by
    // TestUser — a calendar owner who is not an instance admin. Two viewers,
    // one report, two destinations: that is the server-side role branch this
    // pair exists to pin.
    await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);

    const row = await inboxReportRow(page, fixtures.ownedReportId);
    const objectLink = row.locator('a.object-link');

    // Nothing in the app emits a `?report=` URL as a string — `routeFor`
    // returns a structured location and vue-router serializes it at render
    // time. Reading the rendered href is the only way to assert the exact
    // query the producer actually emits.
    await expect(objectLink).toHaveAttribute(
      'href',
      `/calendar/${TESTUSER_CALENDAR_URL_NAME}/manage?tab=reports&report=${fixtures.ownedReportId}`,
    );

    await objectLink.click();
    await page.waitForURL('**/manage?tab=reports&report=*', { timeout: 10000 });
    expect(page.url()).toBe(
      `${env.baseURL}/calendar/${TESTUSER_CALENDAR_URL_NAME}/manage`
      + `?tab=reports&report=${fixtures.ownedReportId}`,
    );

    // The click path is a cross-route navigation, so the management view
    // mounts fresh and its `onBeforeMount` deep-link handler fires.
    await expect(page.locator('.report-detail')).toBeVisible({ timeout: 10000 });
  });
});

/**
 * Observable state of the calendar management view, reduced to the things a
 * viewer could use to tell one `?report=` outcome from another.
 *
 * The deep link must not disclose whether a report exists, so the malformed,
 * non-existent and unauthorised cases have to be identical to the absent
 * case — not merely "no crash". Comparing a structured snapshot makes the
 * failure legible when they diverge.
 */
async function managementViewState(page: Page) {
  return page.evaluate(() => ({
    // `|| null` rather than `?? null`: an unfocused page leaves
    // `document.activeElement` on `<body>`, whose id is the empty string.
    activeElementId: document.activeElement?.id || null,
    activeElementTag: document.activeElement?.tagName.toLowerCase() ?? null,
    reportsTabSelected: document.getElementById('reports-tab')?.getAttribute('aria-selected') ?? null,
    reportsPanelHidden: document.getElementById('reports-panel')?.hasAttribute('hidden') ?? null,
    tabIds: Array.from(document.querySelectorAll('[role="tab"]')).map(tab => tab.id),
    reportDetailCount: document.querySelectorAll('.report-detail').length,
    reportsDashboardCount: document.querySelectorAll('.reports-dashboard').length,
    alertCount: document.querySelectorAll('[role="alert"]').length,
  }));
}

/**
 * Load the owner's management view at `query` and wait for the reports
 * dashboard's table to finish rendering, so the snapshot is taken against a
 * settled view rather than a loading state.
 *
 * Only for cases that issue NO report-detail request — the baseline with no
 * `?report=`, and the malformed id that `root.vue`'s `UUID_REGEX` rejects
 * before any fetch. The dashboard's own list request is on a different
 * timeline from the detail fetch, so for cases that do fetch, this settle
 * point proves nothing about the thing under test: use
 * `loadRejectedReportView`.
 */
async function loadPlainReportsView(page: Page, query: string) {
  await page.goto(`${env.baseURL}/calendar/${TESTUSER_CALENDAR_URL_NAME}/manage${query}`);
  await expect(page.locator('.reports-dashboard__table-container')).toBeVisible({ timeout: 10000 });
  return managementViewState(page);
}

/**
 * Load the owner's management view deep-linked at `reportId`, wait for the
 * report-detail request the deep link issues, and assert the server refused
 * it — then snapshot.
 *
 * Settling on the response rather than on the dashboard table is the point.
 * The dashboard's list request and the detail fetch are independent; the
 * detail fetch happening to resolve first is incidental to the order
 * `root.vue` awaits them in, not enforced by anything. Waiting on the
 * dashboard would let a regression that DID render a foreign report still
 * snapshot green, because the snapshot could be taken before that render
 * landed. Asserting the 404 also upgrades the case from "nothing rendered" to
 * "the server refused", which is where the guarantee actually has to live.
 */
async function loadRejectedReportView(page: Page, reportId: string) {
  const detailResponse = page.waitForResponse(
    response => response.url().includes(`/reports/${reportId}`),
    { timeout: 10000 },
  );

  await page.goto(
    `${env.baseURL}/calendar/${TESTUSER_CALENDAR_URL_NAME}/manage`
    + `?tab=reports&report=${reportId}`,
  );

  expect((await detailResponse).status()).toBe(404);
  await expect(page.locator('.reports-dashboard__table-container')).toBeVisible({ timeout: 10000 });
  return managementViewState(page);
}

test.describe('Reports deep link (?report=)', () => {
  // Every case here is an OWNER on their own calendar. A viewer with no
  // relationship to the calendar renders a blank management page by
  // pre-existing route design, unrelated to `?report=` — filed as pv-gfm9 and
  // out of scope.
  //
  // Every case also holds `?tab=reports` constant. `routeFor` emits both query
  // keys, and the tab is restored from `?tab=` before and independently of the
  // report gate, so the reports tab activates even when the report id is
  // rejected. Baselining against a bare no-query URL would compare two
  // different views and fail on a non-defect.

  test('a valid owned report activates the reports tab and moves focus to the panel', async ({ page }) => {
    await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);

    await page.goto(
      `${env.baseURL}/calendar/${TESTUSER_CALENDAR_URL_NAME}/manage`
      + `?tab=reports&report=${fixtures.ownedReportId}`,
    );

    await expect(page.locator('.report-detail')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#reports-tab')).toHaveAttribute('aria-selected', 'true');

    // Focus, not merely visibility: the whole point of the deep link is that
    // a keyboard or screen-reader user arrives inside the panel.
    const focusedId = await page.evaluate(() => document.activeElement?.id ?? null);
    expect(focusedId).toBe('reports-panel');
  });

  test('malformed, non-existent and unauthorised report ids are indistinguishable from absent', async ({ page }) => {
    await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);

    // Baseline: the reports tab requested, no report named.
    const absent = await loadPlainReportsView(page, '?tab=reports');
    expect(absent.reportsTabSelected).toBe('true');
    expect(absent.reportDetailCount).toBe(0);
    expect(absent.activeElementId).toBeNull();
    expect(absent.activeElementTag).toBe('body');

    // Malformed ids never reach the network: `root.vue` rejects them on shape
    // before the fetch, so this is the one negative case with no response to
    // settle on and it stays on the dashboard settle point.
    const malformed = await loadPlainReportsView(page, '?tab=reports&report=not-a-uuid');
    expect(malformed).toEqual(absent);

    // Well-formed UUID v4, no such report anywhere.
    const missing = await loadRejectedReportView(page, '00000000-0000-4000-8000-000000000000');
    expect(missing).toEqual(absent);

    // A real report — on a calendar this viewer does not own. The 404 is what
    // proves the scope lives in the query rather than in a post-fetch
    // comparison the client could be talked out of.
    const unauthorised = await loadRejectedReportView(page, fixtures.foreignReportId);
    expect(unauthorised).toEqual(absent);
  });
});

/**
 * The `data-testid`, or failing that the class, of whatever currently holds
 * focus — plus which inbox row it belongs to. Row membership is what proves
 * the traversal stayed inside one row and then left it.
 */
async function focusDescriptor(page: Page): Promise<{ stop: string; rowIndex: number }> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) {
      return { stop: 'body', rowIndex: -1 };
    }
    const rows = Array.from(document.querySelectorAll('[data-testid="notification-item"]'));
    const row = active.closest('[data-testid="notification-item"]');
    return {
      stop: active.getAttribute('data-testid') ?? active.className ?? active.tagName.toLowerCase(),
      rowIndex: row ? rows.indexOf(row) : -1,
    };
  });
}

test.describe('Inbox row keyboard order', () => {
  test('an unread Announce row exposes actor, object, mark-as-read and dismiss in that order', async ({ page }) => {
    // Pinned to an UNREAD Announce (repost) row, and that is a constraint,
    // not a preference:
    //
    //  - The actor renders as a focusable link only when the row carries an
    //    `https://` actor URL, and only `Follow` and `Announce` supply one.
    //    `Follow` in turn derives `target: null`, so its object is a span.
    //    Announce is therefore the ONLY verb with both an actor link and an
    //    object link.
    //  - The mark-as-read button renders on unread rows only. A read row has
    //    three stops, not four. Row stop count ranges from 2 to 4 by verb and
    //    seen state; asserting a constant would be wrong.
    await loginViaUi(page, env.baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);

    const row = await inboxRow(page, 'reposted');
    await expect(row).toHaveClass(/notification-item--unread/);

    const actorLink = row.locator('a.actor-link');
    await expect(actorLink).toBeVisible();
    await actorLink.focus();

    const first = await focusDescriptor(page);
    expect(first.stop).toBe('actor-link');
    expect(first.rowIndex).toBeGreaterThanOrEqual(0);
    const rowIndex = first.rowIndex;

    // Backwards out of the actor link must leave the row: that is what makes
    // the actor link the row's FIRST stop rather than merely one of them.
    await page.keyboard.press('Shift+Tab');
    expect((await focusDescriptor(page)).rowIndex).not.toBe(rowIndex);

    await actorLink.focus();

    const forwardStops: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const descriptor = await focusDescriptor(page);
      expect(descriptor.rowIndex).toBe(rowIndex);
      forwardStops.push(descriptor.stop);
    }

    expect(forwardStops).toEqual([
      'object-link',
      'notification-mark-seen',
      'notification-dismiss',
    ]);

    // One more Tab leaves the row, so the unread Announce row has exactly the
    // four stops asserted above and no silent fifth.
    await page.keyboard.press('Tab');
    expect((await focusDescriptor(page)).rowIndex).not.toBe(rowIndex);
  });
});
