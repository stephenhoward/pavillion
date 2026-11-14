/**
 * Integration test: a successful calendar inbox delivery answers with JSON.
 *
 * Gancio treats a delivery as failed unless the response Content-Type
 * contains `json`, so an accepted POST must not answer with a plain-text body.
 * Status codes are unchanged (200); only the body and content type are pinned.
 */

import { describe, it, expect, afterEach, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns') & { default: typeof import('dns') }>();
  return { ...actual, default: { ...actual.default, lookup: vi.fn() } };
});

import sinon from 'sinon';
import axios from 'axios';
import httpSignature from 'http-signature';
import { EventEmitter } from 'events';
import dns from 'dns';
import { mockDnsLookup, PUBLIC_IP } from '@/server/activitypub/test/helper/pinned-dns';

import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { createFollowingRelationship } from '@/server/common/test/helpers/database';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

beforeEach(() => {
  mockDnsLookup(vi.mocked(dns.lookup), [PUBLIC_IP]);
});

describe('ActivityPub inbox success response', () => {
  let env: TestEnvironment;
  let calendar: Calendar;
  const calendarName = 'jsonresponsecalendar';
  const sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());
    const accountInfo = await accountService._setupAccount('jsonresponse@pavillion.dev', 'testpassword');
    calendar = await calendarInterface.createCalendar(accountInfo.account, calendarName);
  });

  afterEach(() => {
    sandbox.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('answers an accepted delivery with 200 and a JSON body', async () => {
    const remoteDomain = 'remotedomain.dev';
    const remoteCalendar = 'jsonresponsesender';
    const remoteActorUri = `https://${remoteDomain}/calendars/${remoteCalendar}`;
    const remoteEventUrl = `https://${remoteDomain}/api/v1/events/json-response`;

    await createFollowingRelationship(calendar.id, remoteActorUri, false, false);

    const getStub = sandbox.stub(axios, 'get');
    sandbox.stub(httpSignature, 'verifySignature').returns(true);
    env.stubRemoteCalendar(getStub, remoteDomain, remoteCalendar);
    getStub.withArgs(remoteEventUrl).resolves({
      status: 200,
      data: { id: remoteEventUrl, type: 'Event', attributedTo: remoteActorUri },
    });

    const response = await env.signedPost(
      `/calendars/${calendarName}/inbox`,
      env.fakeRemoteAuth(remoteDomain, remoteCalendar),
      {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${remoteEventUrl}/create`,
        type: 'Create',
        actor: remoteActorUri,
        object: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: remoteEventUrl,
          type: 'Event',
          attributedTo: remoteActorUri,
          content: { en: { name: 'JSON Response Event', description: 'Body check' } },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('json');
    expect(response.body).toEqual({});
  });
});
