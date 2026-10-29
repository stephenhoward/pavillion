/**
 * Integration test: the calendar inbox parses an `application/ld+json` body.
 *
 * ActivityPub (section 3.2) names two request content types a server must
 * accept: `application/activity+json` and
 * `application/ld+json; profile="https://www.w3.org/ns/activitystreams"`.
 * Mastodon and others deliver with the latter. Without `application/ld+json`
 * in `activityJsonBodyParser`'s type list the body is never parsed or
 * captured, so the Digest check in `verifyHttpSignature` fails closed and the
 * signed request is rejected with 401 before any handler runs.
 *
 * Mirrors the signed Create(Event) flow in `receive_create_activity.test.ts`
 * (axios stubs for the remote actor and event, `verifySignature` stubbed),
 * differing only in the Content-Type of the POST.
 */

import { describe, it, expect, afterEach, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// The signed-request path resolves the remote actor's hostname before the
// (stubbed) key fetch and pins the connection to the address it validated.
// The remote hostnames here are fictional, so DNS is mocked to answer every
// name with one public address. vi.mock is hoisted, so ip-validation captures
// the mock when it promisifies dns.lookup at load time.
vi.mock('dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns') & { default: typeof import('dns') }>();
  return { ...actual, default: { ...actual.default, lookup: vi.fn() } };
});

import request from 'supertest';
import sinon from 'sinon';
import axios from 'axios';
import crypto from 'crypto';
import httpSignature from 'http-signature';
import { EventEmitter } from 'events';
import dns from 'dns';
import { mockDnsLookup, PUBLIC_IP } from '@/server/activitypub/test/helper/pinned-dns';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';
import { createFollowingRelationship } from '@/server/common/test/helpers/database';
import AccountService from '@/server/accounts/service/account';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

const LD_JSON_ACTIVITYSTREAMS = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';


beforeEach(() => {
  mockDnsLookup(vi.mocked(dns.lookup), [PUBLIC_IP]);
});

describe('ActivityPub inbox with application/ld+json content type', () => {
  let env: TestEnvironment;
  let account: Account;
  let calendar: Calendar;
  const calendarName = 'ldjsoncalendar';
  const sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const accountInfo = await accountService._setupAccount('ldjson@pavillion.dev', 'testpassword');
    account = accountInfo.account;
    calendar = await calendarInterface.createCalendar(account, calendarName);
  });

  afterEach(() => {
    sandbox.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('accepts and ingests a signed Create(Event) sent with the ActivityStreams ld+json profile', async () => {
    const remoteDomain = 'remotedomain.dev';
    const remoteCalendar = 'ldjsonsender';
    const remoteActorUri = `https://${remoteDomain}/calendars/${remoteCalendar}`;
    const remoteEventUrl = `https://${remoteDomain}/api/v1/events/ld-json`;
    const activityId = `${remoteEventUrl}/create`;

    // The inbox dispatch gate only accepts a Create from a followed calendar.
    await createFollowingRelationship(calendar.id, remoteActorUri, false, false);

    const getStub = sandbox.stub(axios, 'get');
    sandbox.stub(httpSignature, 'verifySignature').returns(true);
    env.stubRemoteCalendar(getStub, remoteDomain, remoteCalendar);
    getStub.withArgs(remoteEventUrl).resolves({
      status: 200,
      data: { id: remoteEventUrl, type: 'Event', attributedTo: remoteActorUri },
    });

    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Create',
      actor: remoteActorUri,
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: remoteEventUrl,
        type: 'Event',
        attributedTo: remoteActorUri,
        content: { en: { name: 'LD JSON Event', description: 'Delivered as ld+json' } },
      },
    };

    // Same shape as TestEnvironment.signedPost, with the Content-Type a
    // spec-conformant peer sends instead of supertest's default.
    const response = await request(env.app)
      .post(`/calendars/${calendarName}/inbox`)
      .set('Content-Type', LD_JSON_ACTIVITYSTREAMS)
      .set('Authorization', env.fakeRemoteAuth(remoteDomain, remoteCalendar))
      .set('Date', new Date().toUTCString())
      .set('Digest', 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(activity)).digest('base64'))
      .send(JSON.stringify(activity));

    expect(response.status, 'ld+json body was parsed and the activity accepted').toBe(200);

    const inboxRow = await waitFor(async () => {
      const row = await ActivityPubInboxMessageEntity.findByPk(activityId);
      return row?.processed_status ? row : null;
    });
    expect(inboxRow.processed_status, 'inbox message admitted and processed').toBe('ok');

    const entity = await EventEntity.findOne({ where: { event_source_url: remoteEventUrl } });
    expect(entity, 'remote event was ingested').not.toBeNull();
  });
});
