/**
 * Integration test for DEC-011 inbox auth-source tracking on the live HTTP path.
 *
 * Verifies that an HTTP-signed POST to the inbox endpoint persists a row in
 * `ap_inbox` with the correct `auth_source` and `auth_origin` columns:
 *   - `auth_source === 'http_signature'` for every row admitted via the live
 *     inbox POST (set unconditionally by the route handler).
 *   - `auth_origin === <scheme+host of the keyId URL>` when the keyId parses,
 *     or `null` when keyId is unparseable (e.g., the value is not a URL). The
 *     null case proves the degraded path: the middleware accepted the
 *     signature upstream, the row still writes, but the verified-origin
 *     breadcrumb is lost.
 *
 * Uses the same scaffolding as `inbox-security.test.ts`: TestEnvironment, real
 * supertest POSTs against the inbox route, and `SKIP_SIGNATURES=true` to bypass
 * the signature-verify middleware so we do not have to manage real keys.
 * `extractKeyIdOrigin` parses the Signature header independently of that flag,
 * so the auth_origin assertion still exercises the production code path.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';
import crypto from 'crypto';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';

describe('ActivityPub Inbox Auth Columns (DEC-011)', () => {
  let env: TestEnvironment;
  let ownerAccount: Account;
  let testCalendar: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    const calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const ownerInfo = await accountService._setupAccount('owner-auth@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;

    testCalendar = await calendarInterface.createCalendar(ownerAccount, 'authcalendar');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  let originalSkipSignatures: string | undefined;

  beforeEach(() => {
    // Bypass signature verification — the route handler still calls
    // extractKeyIdOrigin(req) regardless of this flag, so the auth_origin
    // assertion exercises the real parsing path.
    originalSkipSignatures = process.env.SKIP_SIGNATURES;
    process.env.SKIP_SIGNATURES = 'true';
  });

  afterEach(() => {
    if (originalSkipSignatures === undefined) {
      delete process.env.SKIP_SIGNATURES;
    }
    else {
      process.env.SKIP_SIGNATURES = originalSkipSignatures;
    }
  });

  it('writes auth_source=http_signature and auth_origin=<keyId origin> for a signed POST with a valid keyId', async () => {
    const remoteDomain = 'remote.example.com';
    const remoteCalendar = 'authsource';
    const activityId = 'https://remote.example.com/activities/auth-valid-keyid';

    const announceActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Announce',
      actor: `https://${remoteDomain}/calendars/${remoteCalendar}`,
      object: 'https://remote.example.com/events/auth-valid-keyid',
    };

    // The Signature header value (per draft-cavage-http-signatures) is the
    // comma-separated parameter list with no "Signature " prefix — that prefix
    // belongs on the Authorization header when using `Authorization: Signature ...`.
    const validSignature =
      `keyId="https://${remoteDomain}/calendars/${remoteCalendar}#main-key",algorithm="rsa-sha256",` +
      'headers="(request-target) host date content-type digest",' +
      'signature="fakeSignature"';

    const response = await request(env.app)
      .post(`/calendars/${testCalendar.urlName}/inbox`)
      .set('Content-Type', 'application/activity+json')
      .set('Date', new Date().toUTCString())
      .set('Host', 'localhost')
      .set('Signature', validSignature)
      .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(announceActivity)).digest('base64')}`)
      .send(announceActivity);

    expect(response.status).toBe(200);

    const row = await ActivityPubInboxMessageEntity.findByPk(activityId);
    expect(row).not.toBeNull();
    expect(row!.auth_source).toBe('http_signature');
    expect(row!.auth_origin).toBe(`https://${remoteDomain}`);
  });

  it('writes auth_source=http_signature and auth_origin=null when the keyId cannot be parsed as a URL', async () => {
    const activityId = 'https://remote.example.com/activities/auth-malformed-keyid';

    const announceActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Announce',
      actor: 'https://remote.example.com/calendars/anotheractor',
      object: 'https://remote.example.com/events/auth-malformed-keyid',
    };

    // The Signature header value is structurally well-formed (bare params, no
    // "Signature " prefix — which would belong on the Authorization header,
    // not on the Signature header), so http-signature.parseRequest extracts a
    // keyId successfully. The keyId VALUE is then not a valid URL, so
    // `new URL(keyId)` throws inside extractKeyIdOrigin and the helper returns
    // null. Signature verification is upstream of this; the row still persists
    // because the middleware (SKIP_SIGNATURES) accepted the request.
    const malformedSignature =
      'keyId="not-a-valid-url",algorithm="rsa-sha256",' +
      'headers="(request-target) host date content-type digest",' +
      'signature="fakeSignature"';

    const response = await request(env.app)
      .post(`/calendars/${testCalendar.urlName}/inbox`)
      .set('Content-Type', 'application/activity+json')
      .set('Date', new Date().toUTCString())
      .set('Host', 'localhost')
      .set('Signature', malformedSignature)
      .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(announceActivity)).digest('base64')}`)
      .send(announceActivity);

    expect(response.status).toBe(200);

    const row = await ActivityPubInboxMessageEntity.findByPk(activityId);
    expect(row).not.toBeNull();
    expect(row!.auth_source).toBe('http_signature');
    expect(row!.auth_origin).toBeNull();
  });
});
