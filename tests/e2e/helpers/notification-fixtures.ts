import { expect, type Page } from '@playwright/test';
import axios from 'axios';

/**
 * Shared notification fixtures for the inbox e2e specs.
 *
 * Two spec files need the same set of live notification rows —
 * `inbox-navigation.spec.ts` (routing, deep link, keyboard order) and
 * `a11y/inbox-axe.spec.ts` (axe scans). Each starts its own server with its
 * own database, so the fixtures have to be built twice; building them from
 * one module keeps the two specs asserting against the same world rather
 * than two hand-copied approximations of it.
 *
 * Every fixture is produced by driving a real API, never by writing rows
 * directly: the point of the e2e tier here is that a verb emitted by its own
 * domain arrives in the inbox with the target the read path decided.
 */

// Seed identities — see layouts/development/db/.
export const ADMIN_EMAIL = 'admin@pavillion.dev';
export const ADMIN_PASSWORD = 'admin';

/** TestUser owns `testuser_calendar` and is NOT an instance admin. That is what
 *  makes the `owner_report` case constructible: the same report is a
 *  `moderation_report` to the admin and an `owner_report` to this account. */
export const TESTUSER_EMAIL = 'test@example.com';
export const TESTUSER_PASSWORD = 'test';

/** FreshUser owns no calendar. Used as the report submitter and as the
 *  invited editor, so neither role collides with a recipient we assert on. */
export const FRESHUSER_EMAIL = 'fresh@example.com';
export const FRESHUSER_PASSWORD = 'test';

export const ADMIN_CALENDAR_ID = 'c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3';
export const ADMIN_CALENDAR_URL_NAME = 'test_calendar';
export const TESTUSER_CALENDAR_ID = 'cbe74815-939e-48b3-af44-1cd4eb3671bb';
export const TESTUSER_CALENDAR_URL_NAME = 'testuser_calendar';

/** An event on the admin's calendar. Reposted by TestUser's calendar to
 *  produce the `Announce` row, and separately reported to produce a report
 *  that TestUser does *not* own. */
export const ADMIN_EVENT_ID = '37d1bb5a-452b-432e-ac46-268b9c565bde';
/** An event on TestUser's calendar — the one that gets flagged. */
export const TESTUSER_EVENT_ID = '34ca7066-322c-4b66-ad78-00360f71e698';

/**
 * Override the ActivityPub `domain` config to an FQDN-shaped value.
 *
 * The default (`localhost:3000`) is rejected by
 * `ActivityPubService.isValidDomain`'s strict regex, which would 400 the
 * Follow request before it ever reached the local-loopback branch in
 * `lookupRemoteCalendar`. The Follow and Announce fixtures need an
 * FQDN-shaped local domain so that `${urlName}@${LOCAL_DOMAIN}` validates AND
 * matches `localDomain` for the local-calendar shortcut.
 *
 * It is also what makes the actor link reachable at all: the calendar actor
 * URL is built as `'https://' + config.get('domain') + '/calendars/...'`, and
 * `inbox.vue`'s `safeActorUrl` only renders an anchor for an `https://` URL.
 * The app's own base URL stays `http://localhost:31xx`; the actor URL is a
 * federation identity, not a bind address, and the mismatch is expected.
 */
export const LOCAL_DOMAIN = 'pavillion.test';

/** Shape of the `GET /api/v1/notification` rows the specs poll for. */
export interface NotificationRow {
  id: string;
  verb: string;
  seen: boolean;
  actor: { displayName: string; displayUrl: string | null };
  object: { type: string; id: string; label: string; target: Record<string, unknown> | null };
}

export interface NotificationFixtures {
  /** The report on TestUser's own calendar. One report, two viewers. */
  ownedReportId: string;
  /** A report on the admin's calendar — TestUser is not its owner. */
  foreignReportId: string;
}

/**
 * Authenticate against the running server and return a bearer JWT.
 *
 * `page.request.*` does not attach the SPA's axios interceptor token, and the
 * fixtures run before any page exists, so setup talks to the API with an
 * explicitly-carried token rather than through a browser session.
 */
export async function loginViaApi(
  baseURL: string,
  email: string,
  password: string,
): Promise<string> {
  const response = await axios.post(`${baseURL}/api/auth/v1/login`, { email, password });
  // The login endpoint returns the JWT as a bare string body.
  return response.data;
}

/**
 * Log in through the SPA's login form, for the accounts `helpers/auth.ts`
 * does not cover. Assertions that need a real router need a real session.
 */
export async function loginViaUi(
  page: Page,
  baseURL: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(baseURL + '/auth/login');
  await page.getByRole('textbox', { name: 'email' }).fill(email);
  await page.getByRole('textbox', { name: 'password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/calendar', { timeout: 30000 });
}

/**
 * Poll `GET /api/v1/notification` until a matching row appears.
 *
 * Every fixture here reaches the inbox through a bus round-trip (outbox →
 * in-process dispatch → domain event → recipient insert), so the row arrives
 * asynchronously. The first GET routinely does not see it.
 */
export async function waitForNotificationRow(
  baseURL: string,
  token: string,
  predicate: (row: NotificationRow) => boolean,
  timeoutMs = 20000,
): Promise<NotificationRow> {
  const deadline = Date.now() + timeoutMs;
  let lastBody: unknown = null;
  while (Date.now() < deadline) {
    const response = await axios.get(`${baseURL}/api/v1/notification`, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true,
    });
    if (response.status === 200) {
      lastBody = response.data;
      const match = (response.data as NotificationRow[]).find(predicate);
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

/**
 * Build every notification row the inbox specs assert against, and wait until
 * each has actually landed in its recipient's inbox.
 *
 * Produced here, one verb per target kind (see the spec files for why one
 * case per *kind* rather than one per verb):
 *
 * | verb            | recipient | target kind         |
 * |-----------------|-----------|---------------------|
 * | `Follow`        | admin     | `null`              |
 * | `Announce`      | admin     | `event`             |
 * | `EditorInvited` | FreshUser | `calendar`          |
 * | `Flag`          | admin     | `moderation_report` |
 * | `Flag` (same)   | TestUser  | `owner_report`      |
 *
 * @param baseURL - Base URL of the running test server
 * @returns The two report ids the deep-link cases need
 */
export async function seedNotificationFixtures(baseURL: string): Promise<NotificationFixtures> {
  const adminToken = await loginViaApi(baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
  const testuserToken = await loginViaApi(baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);
  const freshToken = await loginViaApi(baseURL, FRESHUSER_EMAIL, FRESHUSER_PASSWORD);

  const asTestUser = { headers: { Authorization: `Bearer ${testuserToken}` }, validateStatus: () => true };
  const asAdmin = { headers: { Authorization: `Bearer ${adminToken}` }, validateStatus: () => true };
  const asFresh = { headers: { Authorization: `Bearer ${freshToken}` }, validateStatus: () => true };

  // --- Follow: TestUser's calendar follows the admin's. Addressed to the
  // admin (a test_calendar editor). Derives `target: null`, which the axe
  // scan needs alongside a linked row. ---
  const followResponse = await axios.post(
    `${baseURL}/api/v1/social/follows`,
    { calendarId: TESTUSER_CALENDAR_ID, remoteCalendar: `${ADMIN_CALENDAR_URL_NAME}@${LOCAL_DOMAIN}` },
    asTestUser,
  );
  expect(
    [200, 409],
    `unexpected follow response: ${followResponse.status} ${JSON.stringify(followResponse.data)}`,
  ).toContain(followResponse.status);

  // Drain the Follow before issuing the repost. Both notifications are
  // addressed to the admin, but the repost's audience is computed as
  // `editors(source) - editors(reposter)` at handling time, and issuing it
  // while the Follow is still in flight let that resolution observe a
  // half-applied relationship: the row silently came back with no recipients
  // and only the Follow ever landed. Measured at roughly one run in four when
  // the two inbox specs ran concurrently, and never once the seed was
  // serialised. Wait for each row before provoking the next.
  await waitForNotificationRow(
    baseURL,
    adminToken,
    row => row.verb === 'Follow' && row.object.id === ADMIN_CALENDAR_ID,
  );

  // --- Announce: TestUser's calendar reposts an admin event. `shareEvent`
  // takes an AP event URL and resolves the embedded UUID to the local event,
  // creating the EventObjectEntity on the fly for a seed event that was never
  // published. Audience is the source calendar's editors minus the
  // reposter's, i.e. the admin. ---
  const shareResponse = await axios.post(
    `${baseURL}/api/v1/social/shares`,
    {
      calendarId: TESTUSER_CALENDAR_ID,
      eventId: `https://${LOCAL_DOMAIN}/calendars/${ADMIN_CALENDAR_URL_NAME}/events/${ADMIN_EVENT_ID}`,
    },
    asTestUser,
  );
  expect(
    [200, 409],
    `unexpected share response: ${shareResponse.status} ${JSON.stringify(shareResponse.data)}`,
  ).toContain(shareResponse.status);

  await waitForNotificationRow(
    baseURL,
    adminToken,
    row => row.verb === 'Announce' && row.object.id === ADMIN_EVENT_ID,
  );

  // --- EditorInvited: the admin grants FreshUser edit access to
  // test_calendar. Addressed explicitly to the invitee. ---
  const inviteResponse = await axios.post(
    `${baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/editors`,
    { email: FRESHUSER_EMAIL },
    asAdmin,
  );
  expect(
    [201, 409],
    `unexpected editor-grant response: ${inviteResponse.status} ${JSON.stringify(inviteResponse.data)}`,
  ).toContain(inviteResponse.status);

  await waitForNotificationRow(
    baseURL,
    freshToken,
    row => row.verb === 'EditorInvited' && row.object.id === ADMIN_CALENDAR_ID,
  );

  // --- Flag (owned): FreshUser reports an event on TestUser's calendar. An
  // authenticated report is SUBMITTED immediately, so the Flag is emitted
  // without an email verification round-trip. The audience is
  // owners(testuser_calendar) ∪ instance-admins = { TestUser, admin }: one
  // report, two viewers, two target kinds. ---
  const ownedReportResponse = await axios.post(
    `${baseURL}/api/v1/reports`,
    {
      eventId: TESTUSER_EVENT_ID,
      category: 'spam',
      description: 'e2e fixture: report against an event on testuser_calendar',
    },
    asFresh,
  );
  expect(
    ownedReportResponse.status,
    `unexpected report response: ${JSON.stringify(ownedReportResponse.data)}`,
  ).toBe(201);
  const ownedReportId: string = ownedReportResponse.data.report.id;

  // --- Flag (foreign): a second report, this one against an event on the
  // *admin's* calendar. TestUser does not own it, so it is the unauthorised
  // `?report=` case. A different event id keeps it clear of the
  // one-report-per-reporter-per-event duplicate guard. ---
  const foreignReportResponse = await axios.post(
    `${baseURL}/api/v1/reports`,
    {
      eventId: ADMIN_EVENT_ID,
      category: 'spam',
      description: 'e2e fixture: report against an event on test_calendar',
    },
    asFresh,
  );
  expect(
    foreignReportResponse.status,
    `unexpected report response: ${JSON.stringify(foreignReportResponse.data)}`,
  ).toBe(201);
  const foreignReportId: string = foreignReportResponse.data.report.id;

  // The Follow, Announce and EditorInvited rows were each drained at the point
  // they were provoked, so only the Flag pair is outstanding. Both are raised
  // by the same report and must be visible to both viewers before any test
  // reads the UI — that one report seen through two roles is what the
  // moderation_report / owner_report cases are pinned to.
  await waitForNotificationRow(
    baseURL,
    adminToken,
    row => row.verb === 'Flag' && row.object.id === ownedReportId,
  );
  await waitForNotificationRow(
    baseURL,
    testuserToken,
    row => row.verb === 'Flag' && row.object.id === ownedReportId,
  );

  return { ownedReportId, foreignReportId };
}
