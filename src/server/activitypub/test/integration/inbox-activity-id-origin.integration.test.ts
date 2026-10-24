/**
 * Integration test for the activity-id ownership gate on the live inbox path.
 *
 * `ap_inbox` is keyed on the activity `id`, first writer wins. The signature
 * gate binds `actor` to the signing key but says nothing about `id`, and
 * Delete/Undo ids are deterministic (`{objectUrl}/delete`). Without this gate
 * a peer holding any valid key could POST an activity under another host's
 * future Delete id; the genuine Delete would then land on the existing row,
 * be answered 200, and never be dispatched.
 *
 * The gate keys on the verified origin (`InboxAuthContext.origin`, from the
 * signing keyId), never on a host derived from the self-asserted `actor`
 * (DEC-013). These tests drive it over real HTTP requests.
 *
 * Scaffolding follows `inbox-auth.integration.test.ts`: `SKIP_SIGNATURES=true`
 * bypasses signature verification, while `extractKeyIdOrigin` still parses the
 * Signature header, so the origin the gate compares against is the production
 * value.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';
import crypto from 'crypto';

import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';

const ORIGIN_HOST = 'origin.example.com';
const ORIGIN_ACTOR = `https://${ORIGIN_HOST}/calendars/source`;
const FOREIGN_HOST = 'foreign.example.com';
const FOREIGN_ACTOR = `https://${FOREIGN_HOST}/calendars/squatter`;

describe('Inbox activity id must be on the signing origin', () => {
  let env: TestEnvironment;
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

    const ownerInfo = await accountService._setupAccount('owner-id-origin@pavillion.dev', 'testpassword');
    testCalendar = await calendarInterface.createCalendar(ownerInfo.account, 'idorigincalendar');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  let originalSkipSignatures: string | undefined;

  beforeEach(() => {
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

  /**
   * POSTs an activity signed (header-wise) by `signerActor`'s key. The keyId
   * is what the gate's verified origin is derived from.
   */
  const postSigned = async (activity: Record<string, unknown>, signerActor: string) => {
    const signature =
      `keyId="${signerActor}#main-key",algorithm="rsa-sha256",` +
      'headers="(request-target) host date content-type digest",signature="fakeSignature"';

    return request(env.app)
      .post(`/calendars/${testCalendar.urlName}/inbox`)
      .set('Content-Type', 'application/activity+json')
      .set('Date', new Date().toUTCString())
      .set('Host', 'localhost')
      .set('Signature', signature)
      .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(activity)).digest('base64')}`)
      .send(activity);
  };

  const awaitDispatched = async (activityId: string): Promise<ActivityPubInboxMessageEntity> =>
    waitFor(async () => {
      const found = await ActivityPubInboxMessageEntity.findByPk(activityId);
      return found?.processed_status ? found : null;
    });

  it('refuses a signed POST whose id host differs from the signer host and writes no row', async () => {
    const activityId = `https://${ORIGIN_HOST}/activities/claimed-by-foreign`;
    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Announce',
      actor: FOREIGN_ACTOR,
      object: `https://${ORIGIN_HOST}/events/claimed-by-foreign`,
    };

    const response = await postSigned(activity, FOREIGN_ACTOR);

    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ActivityIdOriginMismatchError');
    expect(await ActivityPubInboxMessageEntity.findByPk(activityId)).toBeNull();
  });

  it('refuses a POST whose verified origin cannot be determined and writes no row', async () => {
    const activityId = `https://${ORIGIN_HOST}/activities/no-verified-origin`;
    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Announce',
      actor: ORIGIN_ACTOR,
      object: `https://${ORIGIN_HOST}/events/no-verified-origin`,
    };

    // A structurally valid Signature header whose keyId is not a URL:
    // extractKeyIdOrigin returns null, so there is no origin to own the id.
    const response = await request(env.app)
      .post(`/calendars/${testCalendar.urlName}/inbox`)
      .set('Content-Type', 'application/activity+json')
      .set('Date', new Date().toUTCString())
      .set('Host', 'localhost')
      .set('Signature', 'keyId="not-a-valid-url",algorithm="rsa-sha256",headers="(request-target) host date content-type digest",signature="fakeSignature"')
      .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(activity)).digest('base64')}`)
      .send(activity);

    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ActivityIdOriginMismatchError');
    expect(await ActivityPubInboxMessageEntity.findByPk(activityId)).toBeNull();
  });

  it('stores a signed POST whose id host matches the signer host', async () => {
    const activityId = `https://${ORIGIN_HOST}/activities/same-host`;
    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Announce',
      actor: ORIGIN_ACTOR,
      object: `https://${ORIGIN_HOST}/events/same-host`,
    };

    const response = await postSigned(activity, ORIGIN_ACTOR);

    expect(response.status).toBe(200);
    const row = await awaitDispatched(activityId);
    expect(row.auth_origin).toBe(`https://${ORIGIN_HOST}`);
  });

  it('dispatches the genuine Delete even after a foreign host tried to claim its id', async () => {
    const objectUrl = `https://${ORIGIN_HOST}/events/squatted-delete`;
    const deleteId = `${objectUrl}/delete`;

    const squat = await postSigned({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: deleteId,
      type: 'Announce',
      actor: FOREIGN_ACTOR,
      object: objectUrl,
    }, FOREIGN_ACTOR);
    expect(squat.status).toBe(400);

    const genuine = await postSigned({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: deleteId,
      type: 'Delete',
      actor: ORIGIN_ACTOR,
      object: objectUrl,
    }, ORIGIN_ACTOR);
    expect(genuine.status).toBe(200);

    const row = await awaitDispatched(deleteId);
    expect(row.type).toBe('Delete');
    expect((row.message as Record<string, unknown>).actor).toBe(ORIGIN_ACTOR);
    expect(row.auth_origin).toBe(`https://${ORIGIN_HOST}`);
  });
});
