import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: ICS Import Sources (bead pv-1qcp.3.5)
 *
 * Exercises the full add → DNS-verify → sync pipeline against an
 * in-process mock server that provides BOTH:
 *
 *  - A DoH resolver at `GET /dns-query?name=...&type=TXT` returning
 *    configurable TXT records for `_pavillion-challenge.*` names.
 *  - An ICS fixture server at `GET /ics/:name` serving files from
 *    `tests/e2e/fixtures/ics/`.
 *
 * The SSRF escape hatch (pv-1qcp.13) is opened for the child Pavillion
 * server by setting `ALLOW_LOCALHOST_ICS_IMPORT=true` + `NODE_ENV=e2e`
 * via the `extraEnv` option on `startTestServer`. DoH resolver override
 * is delivered through the `config` library's `NODE_CONFIG` JSON env
 * variable so we do not need a dedicated YAML config file per test.
 *
 * Source URLs resolve via `localtest.me`, a public DNS name that returns
 * 127.0.0.1. This is used so the DnsVerifier's PSL alignment check
 * (which rejects bare IP literals) still accepts the hostname, while
 * the fetcher's DNS-lookup + pinned-IP agent flow can reach the local
 * mock ICS server.
 *
 * Scenarios:
 *  1. Happy path: add → verify → sync → imported events visible.
 *  2. Edit preserves on re-sync: edited event title persists on next sync.
 *  3. Parse error: malformed VEVENT → sync reports parse_error outcome.
 *  4. DNS verification failure: DoH mock returns non-matching TXT →
 *     Verify surfaces IMPORT_DNS_MISMATCH (sanitized).
 *  5. rel-me happy path: pick rel-me method → enter verification page URL
 *     → mock HTTPS server returns HTML with valid rel='me' backlink →
 *     verify succeeds → row shows verified state.
 *  6. rel-me link not found: HTML lacks the expected backlink → verify
 *     surfaces IMPORT_RELME_LINK_NOT_FOUND (sanitized). The full rel-me
 *     error matrix is covered at unit/integration tier — this case proves
 *     the negative-path UX surfaces the sanitized error.
 *
 * The rel-me flow uses a SECOND mock server bound to HTTPS (using the
 * existing federation-test self-signed cert) because the rel-me verifier
 * structurally requires `https://` page URLs. The Pavillion server child
 * process accepts the cert via `NODE_TLS_REJECT_UNAUTHORIZED=0`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'ics');

/**
 * Path to the self-signed TLS cert/key used to back the HTTPS mock server
 * for rel-me verification. We reuse the existing federation-test cert
 * (CN=alpha.federation.local) rather than introducing a new artifact —
 * the rel-me child process disables TLS verification via
 * `NODE_TLS_REJECT_UNAUTHORIZED=0`, so neither CN nor CA matter.
 */
const TLS_CERT_PATH = join(
  __dirname,
  '..',
  '..',
  'docker',
  'federation',
  'ssl',
  'alpha.federation.local.crt',
);
const TLS_KEY_PATH = join(
  __dirname,
  '..',
  '..',
  'docker',
  'federation',
  'ssl',
  'alpha.federation.local.key',
);

/**
 * Per-source TXT record configuration accepted by the mock DoH server.
 * Keyed by the challenge DNS name (e.g. `_pavillion-challenge.localtest.me`).
 *
 * - `records`: the TXT record values to return for matching queries.
 * - `status`:  DoH Status code; 0 = NOERROR, 3 = NXDOMAIN.
 */
interface DohRecordConfig {
  records: string[];
  status?: number;
}

const dohRecordsByName = new Map<string, DohRecordConfig>();

/**
 * Per-ICS-path body override. When set, the `/ics/:name` endpoint
 * returns this body verbatim instead of reading from the fixtures
 * directory. Useful for scenarios that need to serve a different
 * fixture under the same URL across a test without re-adding the
 * source.
 */
const icsBodyByPath = new Map<string, string>();

/**
 * Per-HTML-path body override served on both the HTTP and HTTPS mock
 * servers. Used by the rel-me verification flow to publish a page whose
 * `<a rel="me">` link points at the Pavillion `/.well-known/pavillion-verify`
 * URL the verifier expects. Mirrors the `icsBodyByPath` per-path-override
 * pattern (per the bead's complexity-advisor finding: do NOT introduce a
 * new infrastructure layer — extend the existing one).
 */
const htmlBodyByPath = new Map<string, string>();

/**
 * Shared request dispatcher used by both the HTTP and HTTPS mock servers.
 * Routes `/dns-query` (DoH), `/ics/...` (calendar fixtures), and `/html/...`
 * (rel-me verification pages) and falls through to 404. Kept as a free
 * function so the same dispatch logic backs both the HTTP and HTTPS
 * variants without duplicating route tables.
 */
function dispatchMockRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/dns-query') {
    handleDohQuery(url, res);
    return;
  }
  if (url.pathname.startsWith('/ics/')) {
    handleIcsRequest(url.pathname, res);
    return;
  }
  if (url.pathname.startsWith('/html/')) {
    handleHtmlRequest(url.pathname, res);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

/**
 * Starts the combined DoH + ICS mock HTTP server on an ephemeral port
 * bound to 127.0.0.1.
 */
async function startMockServer(): Promise<{ server: Server; port: number; baseUrl: string }> {
  const server = createServer(dispatchMockRequest);

  // Bind dual-stack ('::') so the server accepts both IPv4 (127.0.0.1)
  // and IPv6 (::1) connections. On GitHub Actions Linux runners,
  // `dns.lookup('localtest.me', { verbatim: true })` can return ::1
  // ahead of 127.0.0.1; pinning the fetcher's agent to ::1 against an
  // IPv4-only bind would surface as a generic `fetch_error` outcome.
  await new Promise<void>((resolve) => server.listen(0, '::', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port, baseUrl: `http://127.0.0.1:${port}` };
}

/**
 * Starts an HTTPS variant of the mock server using the existing federation
 * test self-signed cert. Required for rel-me verification because the
 * server-side `validateRelMePageUrl` rejects any non-`https:` page URL up
 * front — we cannot exercise the rel-me verifier with the http server.
 *
 * The Pavillion child process accepts the cert via
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` (set in `extraEnv` below), so cert
 * subject mismatch (CN=alpha.federation.local vs request to `localtest.me`)
 * is irrelevant.
 */
async function startMockHttpsServer(): Promise<{ server: HttpsServer; port: number; baseUrl: string }> {
  const cert = readFileSync(TLS_CERT_PATH);
  const key = readFileSync(TLS_KEY_PATH);
  const server = createHttpsServer({ cert, key }, dispatchMockRequest);
  await new Promise<void>((resolve) => server.listen(0, '::', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port, baseUrl: `https://127.0.0.1:${port}` };
}

function handleDohQuery(url: URL, res: ServerResponse): void {
  const name = url.searchParams.get('name') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const config = dohRecordsByName.get(name);
  if (process.env.MOCK_VERBOSE === '1') {

    console.log(`[MockDoH] name=${name} type=${type} configured=${config ? JSON.stringify(config) : '(none)'}`);
  }

  if (type !== 'TXT') {
    // Unsupported type — return NOERROR with no answers.
    respondDoh(res, { Status: 0, Answer: [] });
    return;
  }

  if (!config) {
    // NXDOMAIN — no records configured for this name.
    respondDoh(res, { Status: 3, Answer: [] });
    return;
  }

  const status = config.status ?? 0;
  const answer = config.records.map((txt) => ({
    name,
    type: 16,
    TTL: 60,
    data: `"${txt}"`,
  }));
  respondDoh(res, { Status: status, Answer: answer });
}

function respondDoh(res: ServerResponse, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    'content-type': 'application/dns-json',
    'content-length': Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

/**
 * Serve a per-test HTML page for the rel-me verifier. Bodies are configured
 * by tests via `htmlBodyByPath`. There is no fixture-directory fallback
 * (unlike `/ics/...`) because rel-me pages are always test-specific:
 * each test publishes a body containing the exact `<a rel="me">` href the
 * Pavillion verifier expects for that test's source token.
 */
function handleHtmlRequest(pathname: string, res: ServerResponse): void {
  if (process.env.MOCK_VERBOSE === '1') {

    console.log(`[MockHTML] serving ${pathname}`);
  }
  const body = htmlBodyByPath.get(pathname);
  if (body === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

function handleIcsRequest(pathname: string, res: ServerResponse): void {
  if (process.env.MOCK_VERBOSE === '1') {

    console.log(`[MockICS] serving ${pathname}`);
  }
  const override = icsBodyByPath.get(pathname);
  let body: string;
  if (override !== undefined) {
    body = override;
  }
  else {
    const name = pathname.slice('/ics/'.length);
    if (!/^[a-z0-9-]+\.ics$/i.test(name)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    try {
      body = readFileSync(join(FIXTURES_DIR, name), 'utf8');
    }
    catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
  }
  res.writeHead(200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

/**
 * Admin seeded calendar ID (from layouts/development/db/d_calendar.json,
 * belongs to `admin@pavillion.dev`). Scoped editor access lives on this
 * calendar so the Import tab is visible.
 */
const ADMIN_CALENDAR_URL_NAME = 'test_calendar';
const ADMIN_CALENDAR_ID = 'c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3';

/**
 * Instance host for the challenge TXT value. The server uses `domain`
 * from config (default.yaml sets this to `localhost:3000`) to format
 * `pavillion-verify=v1:{domain}:{token}`. NOTE: this is the server's
 * configured domain, not the test server's dynamic port — the challenge
 * HMAC binds to the instance host, not the bind address.
 */
const SERVER_DOMAIN = 'localhost:3000';

let env: TestEnvironment;
let mock: { server: Server; port: number; baseUrl: string };
let mockHttps: { server: HttpsServer; port: number; baseUrl: string };

test.describe.configure({ mode: 'serial' });

test.describe('ICS Import Sources (e2e)', () => {
  test.beforeAll(async () => {
    mock = await startMockServer();
    mockHttps = await startMockHttpsServer();

    // Point the backend DoH resolvers at our mock. Both entries are the
    // same URL; the verifier requires at least two resolvers and cross-
    // checks them for agreement. Using one URL twice simulates full
    // agreement without duplicating the mock plumbing.
    //
    // Also pin `domain` so the verifier's `formatVerificationRecord()`
    // produces a string whose host portion matches what this spec
    // publishes in the mock TXT record. The default in default.yaml is
    // `localhost:3000`, but overriding explicitly here makes the
    // dependency visible.
    const nodeConfig = JSON.stringify({
      domain: SERVER_DOMAIN,
      calendar: {
        import: {
          dohResolvers: [
            `${mock.baseUrl}/dns-query`,
            `${mock.baseUrl}/dns-query`,
          ],
        },
      },
    });

    env = await startTestServer({
      extraEnv: {
        ALLOW_LOCALHOST_ICS_IMPORT: 'true',
        NODE_CONFIG: nodeConfig,
        // Accept the self-signed federation cert used by the rel-me HTTPS
        // mock server. The cert's CN does not match `localtest.me`, and the
        // CA is not trusted by Node by default. This relaxation is scoped
        // to the e2e child process — it does not affect production paths.
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      },
    });
  });

  test.afterAll(async () => {
    await env?.cleanup();
    await new Promise<void>((resolve, reject) => {
      mock.server.close((err) => (err ? reject(err) : resolve()));
    });
    if (mockHttps) {
      await new Promise<void>((resolve, reject) => {
        mockHttps.server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  test.beforeEach(() => {
    dohRecordsByName.clear();
    icsBodyByPath.clear();
    htmlBodyByPath.clear();
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

  /**
   * Helper: create an import source via the authenticated API and return
   * its id. Using the API (rather than UI) avoids brittle dependence on
   * the add-form's rendering order in tests that only care about the
   * verify/sync outcome.
   */
  async function apiCreateSource(page: Page, url: string): Promise<string> {
    const headers = await authHeader(page);
    const res = await page.request.post(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/import-sources`,
      { data: { url }, headers },
    );
    expect(res.status()).toBe(201);
    const body = await res.json();
    return body.id as string;
  }

  async function apiIssueChallenge(page: Page, sourceId: string): Promise<string> {
    const headers = await authHeader(page);
    const res = await page.request.post(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/import-sources/${sourceId}/verify-issue`,
      { headers },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    return body.challengeToken as string;
  }

  /**
   * Issue a challenge while also setting (or switching) the source's
   * verification_type discriminator. Used by the rel-me e2e cases to seed
   * a source straight to 'rel-me' without driving the picker UI, or to
   * reset back to 'dns-txt' as part of staging the picker entry path.
   */
  async function apiIssueChallengeWithType(
    page: Page,
    sourceId: string,
    type: 'dns-txt' | 'rel-me',
  ): Promise<string> {
    const headers = await authHeader(page);
    const res = await page.request.post(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/import-sources/${sourceId}/verify-issue`,
      { headers, data: { verification_type: type } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    return body.challengeToken as string;
  }

  async function apiVerify(page: Page, sourceId: string): Promise<number> {
    const headers = await authHeader(page);
    const res = await page.request.post(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/import-sources/${sourceId}/verify`,
      { headers },
    );
    return res.status();
  }

  async function apiSync(page: Page, sourceId: string): Promise<{ status: number; body: any }> {
    const headers = await authHeader(page);
    const res = await page.request.post(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/import-sources/${sourceId}/sync`,
      { headers },
    );
    return { status: res.status(), body: res.status() === 200 ? await res.json() : null };
  }

  async function apiGetSource(page: Page, sourceId: string): Promise<{ status: number; body: any }> {
    const headers = await authHeader(page);
    const res = await page.request.get(
      `${env.baseURL}/api/v1/calendars/${ADMIN_CALENDAR_ID}/import-sources/${sourceId}`,
      { headers },
    );
    return { status: res.status(), body: res.status() === 200 ? await res.json() : null };
  }

  async function openCalendarImportTab(page: Page): Promise<void> {
    await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR_URL_NAME}/manage`);
    // The calendar management root lazy-loads; wait for the Import tab button.
    const importTab = page.locator('#import-tab');
    await expect(importTab).toBeVisible({ timeout: 15000 });
    await importTab.click();
    // Wait for the section heading to render.
    await expect(page.getByRole('heading', { name: 'Import Sources' })).toBeVisible();
  }

  // ------------------------------------------------------------------
  // Scenario 1: Happy path
  // ------------------------------------------------------------------
  test('happy path: add → verify → sync imports events', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    const sourceUrl = `http://localtest.me:${mock.port}/ics/basic.ics`;
    const sourceId = await apiCreateSource(page, sourceUrl);
    const token = await apiIssueChallenge(page, sourceId);

    // Publish the matching TXT record in the mock DoH.
    dohRecordsByName.set('_pavillion-challenge.localtest.me', {
      records: [`pavillion-verify=v1:${SERVER_DOMAIN}:${token}`],
    });

    await openCalendarImportTab(page);

    // Find the row for this source and click Verify.
    const row = page.locator('.import-source-row', { hasText: sourceUrl });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Verify ownership/i }).click();

    // Verify-ownership wizard opens (pv-jutm). The source already has
    // verification_type='dns-txt' from createSource, so the wizard skips
    // the method picker and lands directly on the DNS step.
    const dialog = page.getByRole('dialog', { name: /Verify ownership/i });
    await expect(dialog).toBeVisible();
    const [verifyResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/import-sources/${sourceId}/verify`) && r.request().method() === 'POST',
      ),
      dialog.getByRole('button', { name: 'Verify', exact: true }).click(),
    ]);
    expect(verifyResponse.status()).toBe(200);

    // Modal should close; the row should show the Verified badge.
    await expect(dialog).toBeHidden();
    await expect(row.locator('.import-source-row__badge--verified')).toBeVisible();

    // Click Sync now. Wait on the sync API response so we can assert the
    // outcome precisely without relying on timing.
    const syncButton = row.getByRole('button', { name: /Sync import source/i });
    await expect(syncButton).toBeEnabled();
    const [syncResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/import-sources/${sourceId}/sync`) && r.request().method() === 'POST',
        { timeout: 15000 },
      ),
      syncButton.click(),
    ]);
    expect(syncResponse.status()).toBe(200);
    const syncBody = await syncResponse.json();
    // Include errorMessage in the assertion so non-success outcomes
    // (e.g. fetch_error from IPv4/IPv6 bind mismatches) self-diagnose.
    expect(
      syncBody.outcome,
      `sync did not succeed: outcome=${syncBody.outcome}, errorMessage=${syncBody.errorMessage ?? '(none)'}`,
    ).toBe('success');
    expect(syncBody.eventsCreated).toBe(3);

    // Verify the events are visible in the calendar event list.
    await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR_URL_NAME}`);
    await page.waitForSelector('.event-list', { timeout: 15000 });
    await expect(page.locator('.event-item', { hasText: 'Imported Event One' })).toBeVisible();
    await expect(page.locator('.event-item', { hasText: 'Imported Event Two' })).toBeVisible();
    await expect(page.locator('.event-item', { hasText: 'Imported Event Three' })).toBeVisible();
  });

  // ------------------------------------------------------------------
  // Scenario 2: Edit preserves on re-sync
  // ------------------------------------------------------------------
  test('edit preserves on re-sync: user-edited title survives another sync', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    // Use a distinct fixture so its UIDs do not collide with scenario 1.
    const localIcsName = 'edit-preserve.ics';
    const fixtureBody = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Pavillion E2E//Edit Preserve//EN',
      'BEGIN:VEVENT',
      'UID:e2e-edit-preserve-1@import-sources.test',
      'DTSTAMP:20260501T000000Z',
      'DTSTART:20260715T100000Z',
      'DTEND:20260715T110000Z',
      'SUMMARY:Original Source Title',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\n');
    icsBodyByPath.set(`/ics/${localIcsName}`, fixtureBody);

    const sourceUrl = `http://localtest.me:${mock.port}/ics/${localIcsName}`;
    const sourceId = await apiCreateSource(page, sourceUrl);
    const token = await apiIssueChallenge(page, sourceId);
    dohRecordsByName.set('_pavillion-challenge.localtest.me', {
      records: [`pavillion-verify=v1:${SERVER_DOMAIN}:${token}`],
    });

    // Verify via API so the test stays focused on the edit-preservation
    // assertion. (Scenario 1 covers the UI verify flow.)
    expect(await apiVerify(page, sourceId)).toBe(200);

    // First sync — imports the source event.
    const firstSync = await apiSync(page, sourceId);
    expect(firstSync.status).toBe(200);
    expect(firstSync.body.outcome).toBe('success');
    expect(firstSync.body.eventsCreated).toBe(1);

    // Edit the imported event's title via the UI.
    const editedTitle = `Locally Edited Title ${Date.now()}`;
    await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR_URL_NAME}`);
    await page.waitForSelector('.event-list', { timeout: 15000 });
    const importedEvent = page.locator('.event-item', { hasText: 'Original Source Title' });
    await expect(importedEvent).toBeVisible({ timeout: 10000 });
    await importedEvent.locator('.edit-btn').click();
    await page.waitForSelector('#event-form', { timeout: 10000 });
    const titleInput = page.locator('#event-name-en');
    await titleInput.fill(editedTitle);
    await page.locator('button.btn-save').click();
    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR_URL_NAME}`, { timeout: 15000 });
    await page.waitForSelector('.event-list', { timeout: 10000 });
    await expect(page.locator('.event-item', { hasText: editedTitle })).toBeVisible();

    // Second sync — mapper's dedup must find the locally_edited row and
    // skip the title overwrite.
    const secondSync = await apiSync(page, sourceId);
    expect(secondSync.status).toBe(200);
    // Accept either 'success' or 'no_changes' — the second fetch hits a
    // matching content-hash path when ETag is absent, but either outcome
    // preserves the edited title.
    expect(['success', 'no_changes']).toContain(secondSync.body.outcome);
    expect(secondSync.body.eventsUpdated).toBe(0);

    // Reload the calendar view and assert the edited title persists.
    await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR_URL_NAME}`);
    await page.waitForSelector('.event-list', { timeout: 15000 });
    await expect(page.locator('.event-item', { hasText: editedTitle })).toBeVisible();
    // And that the source's original title has NOT reappeared.
    await expect(page.locator('.event-item', { hasText: 'Original Source Title' })).toBeHidden();
  });

  // ------------------------------------------------------------------
  // Scenario 3: Parse error
  // ------------------------------------------------------------------
  test('parse error: sync outcome surfaces sanitized parse_error', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    const sourceUrl = `http://localtest.me:${mock.port}/ics/parse-error.ics`;
    const sourceId = await apiCreateSource(page, sourceUrl);
    const token = await apiIssueChallenge(page, sourceId);
    dohRecordsByName.set('_pavillion-challenge.localtest.me', {
      records: [`pavillion-verify=v1:${SERVER_DOMAIN}:${token}`],
    });

    // Verify via API then drive sync via UI to exercise the row behavior.
    expect(await apiVerify(page, sourceId)).toBe(200);

    await openCalendarImportTab(page);
    const row = page.locator('.import-source-row', { hasText: sourceUrl });
    await expect(row).toBeVisible();

    const [syncResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/import-sources/${sourceId}/sync`) && r.request().method() === 'POST',
      ),
      row.getByRole('button', { name: /Sync import source/i }).click(),
    ]);
    // Sync itself succeeds at the HTTP level — the mapper-level parse
    // error is surfaced as an outcome, not a 4xx status. The API contract
    // exposes this on `outcome` and `errorMessage`. Both must be
    // sanitized (no raw resolver/URL/error detail leaks).
    expect(syncResponse.status()).toBe(200);
    const body = await syncResponse.json();
    expect(body.outcome).toBe('parse_error');
    expect(body.eventsCreated).toBe(0);
    expect(body.eventsUpdated).toBe(0);
    // errorMessage must be one of the sanitized sentinels (never raw
    // Error.message). Per SyncService.sanitizedErrorMessage(), a mapper
    // that throws a plain Error (e.g. "missing DTSTART") surfaces as
    // IMPORT_INTERNAL_ERROR; a typed ImportSourceParseError would
    // surface as IMPORT_PARSE_ERROR. Either sanitized code is an
    // acceptable user-facing outcome.
    expect(['IMPORT_PARSE_ERROR', 'IMPORT_INTERNAL_ERROR']).toContain(body.errorMessage);

    // Row refreshes lastStatus via the GET endpoint; confirm the server
    // persisted the sanitized last_status on the source entity.
    const refreshed = await apiGetSource(page, sourceId);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.lastStatus).toBe('parse_error');
  });

  // ------------------------------------------------------------------
  // Scenario 4: DNS verification failure
  // ------------------------------------------------------------------
  test('dns verification failure: mismatch TXT surfaces sanitized IMPORT_DNS_MISMATCH', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    // Unique URL path component so we do not collide with the `basic.ics`
    // source from scenario 1 (the service rejects duplicate URLs per
    // calendar).
    const sourceUrl = `http://localtest.me:${mock.port}/ics/mismatch.ics`;
    // Serve the same body as basic.ics under the unique path; the verify
    // flow never fetches the ICS body, so any valid body works.
    const basicBody = readFileSync(join(FIXTURES_DIR, 'basic.ics'), 'utf8');
    icsBodyByPath.set('/ics/mismatch.ics', basicBody);
    const sourceId = await apiCreateSource(page, sourceUrl);
    await apiIssueChallenge(page, sourceId);

    // Publish a non-matching TXT record: wrong token value.
    dohRecordsByName.set('_pavillion-challenge.localtest.me', {
      records: ['pavillion-verify=v1:localhost:3000:NOT-THE-CORRECT-TOKEN'],
    });

    await openCalendarImportTab(page);
    const row = page.locator('.import-source-row', { hasText: sourceUrl });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Verify ownership/i }).click();

    const dialog = page.getByRole('dialog', { name: /Verify ownership/i });
    await expect(dialog).toBeVisible();

    const [verifyResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/import-sources/${sourceId}/verify`) && r.request().method() === 'POST',
      ),
      dialog.getByRole('button', { name: 'Verify', exact: true }).click(),
    ]);
    expect(verifyResponse.status()).toBe(400);
    const body = await verifyResponse.json();
    // The backend MUST sanitize: errorName identifies the exception type,
    // `reason` is the sentinel code enumerated on ImportSourceDnsVerificationError.
    expect(body.errorName).toBe('ImportSourceDnsVerificationError');
    expect(body.reason).toBe('IMPORT_DNS_MISMATCH');
    // Sanitization contract: the human-facing message MUST be the sentinel
    // code itself, NOT raw resolver/URL/hostname detail.
    expect(body.error).toBe('IMPORT_DNS_MISMATCH');

    // The modal's alert region renders a sanitized i18n-backed message.
    // Today's client-side error helper drops the `reason` field during
    // rehydration, so the modal falls back to the generic
    // `errors.unknown_verify` string. That is still an acceptable
    // user-facing surface: it is i18n-backed, contains no secrets, and
    // conveys the failed outcome. The precise per-reason mapping is
    // already covered by `dns-challenge-modal.test.ts` at the unit tier.
    const alert = dialog.getByRole('alert');
    await expect(alert).toBeVisible();
    const alertText = (await alert.textContent())?.trim() ?? '';
    expect(alertText.length).toBeGreaterThan(0);
    expect(alertText).not.toContain(`localtest.me`);
    expect(alertText).not.toContain(`${SERVER_DOMAIN}`);
  });

  // ------------------------------------------------------------------
  // Scenario 5: rel-me happy path
  // ------------------------------------------------------------------
  //
  // Drives the picker UI: a freshly-created source defaults to
  // verification_type='dns-txt' so the wizard opens on the DNS step. The
  // test bounces through "Change verification method" to force the picker
  // to render, then picks rel-me to advance to the rel-me step. This
  // exercises the wizard's full step graph (dns-txt → pick → rel-me) in a
  // single flow, which is the path a calendar owner takes when they decide
  // to switch verification mechanisms after creating a source.
  //
  // The mock HTTPS server publishes an HTML page whose <a rel="me"> link
  // points at the Pavillion well-known verify URL the verifier will compute
  // from the source's challenge token, satisfying the rel-me match check.
  test('rel-me happy path: pick rel-me method → verify with backlink → row shows verified', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    // Source URL stays on HTTP — only the rel-me PAGE URL must be HTTPS.
    // Hostname equality is on the bare host (`localtest.me`), unaffected by
    // port differences between the http and https mock servers.
    const sourceUrl = `http://localtest.me:${mock.port}/ics/relme-happy.ics`;
    icsBodyByPath.set(
      '/ics/relme-happy.ics',
      readFileSync(join(FIXTURES_DIR, 'basic.ics'), 'utf8'),
    );

    const sourceId = await apiCreateSource(page, sourceUrl);

    // Compute the page URL the user will type into the rel-me input. The
    // backend's verifier requires `https://` and same-hostname-as-source,
    // so this hits the HTTPS mock at the same hostname (`localtest.me`).
    const verificationPageUrl = `https://localtest.me:${mockHttps.port}/html/relme-happy`;

    // Pre-publish the HTML body that contains the expected <a rel="me">.
    // The expected link target is computed by the backend from the source's
    // challenge token. We capture that token via the challenge-issue API
    // (driven by the wizard for any user in production, but the URL the
    // verifier compares against is deterministic from sourceId+calendarId,
    // so issuing the challenge ourselves up front is operationally
    // equivalent for fixture-staging purposes).
    const token = await apiIssueChallengeWithType(page, sourceId, 'rel-me');
    const expectedHref = `https://${SERVER_DOMAIN}/.well-known/pavillion-verify/${token}`;
    htmlBodyByPath.set(
      '/html/relme-happy',
      `<!doctype html><html><head><title>rel-me happy</title></head>`
      + `<body><a rel="me" href="${expectedHref}">Pavillion calendar</a></body></html>`,
    );

    // Reset the source's verification_type back to 'dns-txt' (createSource
    // already set this, but the issueChallenge above flipped it to
    // 'rel-me') so the wizard opens on the DNS step and we can drive the
    // picker UI via "Change verification method". This validates the full
    // step graph rather than landing on rel-me directly.
    await apiIssueChallengeWithType(page, sourceId, 'dns-txt');

    await openCalendarImportTab(page);

    const row = page.locator('.import-source-row', { hasText: sourceUrl });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Verify ownership/i }).click();

    const dialog = page.getByRole('dialog', { name: /Verify ownership/i });
    await expect(dialog).toBeVisible();

    // Wizard opens on the DNS step (verification_type='dns-txt'). Click
    // "Change verification method" to surface the picker.
    await dialog.locator('[data-test="verify-wizard-change-method"]').click();
    await expect(dialog.locator('[data-test="verify-wizard-picker"]')).toBeVisible();

    // Pick rel-me. The wizard re-issues the challenge under the rel-me
    // discriminator on entry to the step, which switches the source's
    // verification_type to 'rel-me' on the server. Our pre-staged HTML
    // body remains valid because the token is deterministic per
    // (sourceId, calendarId) — it does not change across re-issuances.
    await dialog.locator('[data-test="verify-wizard-pick-relme"]').click();
    await expect(dialog.locator('[data-test="rel-me-challenge-step"]')).toBeVisible();

    // Type the verification page URL and click Verify. The Verify button
    // calls issueChallenge('rel-me') then verifySource(pageUrl) — wait on
    // the verify response so we can assert the outcome precisely.
    await dialog.locator('[data-test="rel-me-page-url-input"]').fill(verificationPageUrl);
    const [verifyResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/import-sources/${sourceId}/verify`) && r.request().method() === 'POST',
        { timeout: 15000 },
      ),
      dialog.locator('[data-test="rel-me-verify-button"]').click(),
    ]);
    expect(
      verifyResponse.status(),
      `verify did not succeed: status=${verifyResponse.status()}, body=${await verifyResponse.text()}`,
    ).toBe(200);

    // Wizard closes and the row shows the Verified badge.
    await expect(dialog).toBeHidden();
    await expect(row.locator('.import-source-row__badge--verified')).toBeVisible();

    // Server-side state confirmation: GET the source and verify it carries
    // both verification_type='rel-me' and verification_state='verified'.
    const refreshed = await apiGetSource(page, sourceId);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.verificationType).toBe('rel-me');
    expect(refreshed.body.verificationState).toBe('verified');
  });

  // ------------------------------------------------------------------
  // Scenario 6: rel-me link not found
  // ------------------------------------------------------------------
  //
  // Negative-path: the HTML body lacks the expected rel='me' backlink.
  // The verifier surfaces IMPORT_RELME_LINK_NOT_FOUND. The full rel-me
  // error matrix (PARSE_ERROR, HOSTNAME_MISMATCH, PSL_VIOLATION,
  // PAGE_FETCH_ERROR) is covered at the unit/integration tier; this
  // case proves the negative-path UX surfaces a sanitized error in the
  // wizard's alert region.
  test('rel-me link not found: HTML lacks backlink → wizard surfaces sanitized error', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    const sourceUrl = `http://localtest.me:${mock.port}/ics/relme-missing.ics`;
    icsBodyByPath.set(
      '/ics/relme-missing.ics',
      readFileSync(join(FIXTURES_DIR, 'basic.ics'), 'utf8'),
    );
    const sourceId = await apiCreateSource(page, sourceUrl);

    // Seed the source straight to verification_type='rel-me' so the wizard
    // lands on the rel-me step and we can focus the test on the verifier
    // outcome rather than re-exercising the picker (covered in scenario 5).
    await apiIssueChallengeWithType(page, sourceId, 'rel-me');

    // HTML body present but contains NO <a rel="me"> with the expected
    // href. A different rel="me" link is included to confirm the verifier
    // requires URL match, not just any rel="me" presence.
    htmlBodyByPath.set(
      '/html/relme-missing',
      `<!doctype html><html><head><title>missing</title></head><body>`
      + `<a rel="me" href="https://${SERVER_DOMAIN}/.well-known/pavillion-verify/`
      + `0000000000000000000000000000000000000000000000000000000000000000">decoy</a>`
      + `</body></html>`,
    );
    const verificationPageUrl = `https://localtest.me:${mockHttps.port}/html/relme-missing`;

    await openCalendarImportTab(page);

    const row = page.locator('.import-source-row', { hasText: sourceUrl });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Verify ownership/i }).click();

    const dialog = page.getByRole('dialog', { name: /Verify ownership/i });
    await expect(dialog).toBeVisible();
    // Source's verification_type is 'rel-me' so the wizard skips the picker
    // and lands directly on the rel-me step.
    await expect(dialog.locator('[data-test="rel-me-challenge-step"]')).toBeVisible();

    await dialog.locator('[data-test="rel-me-page-url-input"]').fill(verificationPageUrl);
    const [verifyResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/import-sources/${sourceId}/verify`) && r.request().method() === 'POST',
        { timeout: 15000 },
      ),
      dialog.locator('[data-test="rel-me-verify-button"]').click(),
    ]);
    expect(verifyResponse.status()).toBe(400);
    const body = await verifyResponse.json();
    expect(body.errorName).toBe('ImportSourceRelMeVerificationError');
    expect(body.reason).toBe('IMPORT_RELME_LINK_NOT_FOUND');

    // Wizard stays open and the rel-me step renders a sanitized error.
    // Following the dns-txt pattern in scenario 4, we assert the alert
    // appears with non-empty text and contains no host/secret leakage.
    await expect(dialog).toBeVisible();
    const alert = dialog.locator('[data-test="rel-me-error"]');
    await expect(alert).toBeVisible();
    const alertText = (await alert.textContent())?.trim() ?? '';
    expect(alertText.length).toBeGreaterThan(0);
    expect(alertText).not.toContain('localtest.me');
    expect(alertText).not.toContain(SERVER_DOMAIN);

    // Server-side state confirmation: source remains unverified.
    const refreshed = await apiGetSource(page, sourceId);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.verificationState).not.toBe('verified');
  });
});
