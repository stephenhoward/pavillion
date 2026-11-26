import { describe, it, expect, afterEach, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// The signed-request path resolves the remote actor's hostname before the
// (stubbed) key fetch and pins the connection to the address it validated.
// The remote hostnames here are reserved test names, so DNS is mocked to
// answer every name with one public address. vi.mock is hoisted, so
// ip-validation captures the mock when it promisifies dns.lookup at load time.
vi.mock('dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns') & { default: typeof import('dns') }>();
  return { ...actual, default: { ...actual.default, lookup: vi.fn() } };
});

import request from 'supertest';
import sinon from 'sinon';
import axios from 'axios';
import httpSignature from 'http-signature';
import express from 'express';
import { EventEmitter } from 'events';
import dns from 'dns';
import { mockDnsLookup, PUBLIC_IP } from '@/server/activitypub/test/helper/pinned-dns';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';
import { createFollowingRelationship } from '@/server/common/test/helpers/database';
import AccountService from '@/server/accounts/service/account';
import AccountsInterface from '@/server/accounts/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import { EventEntity } from '@/server/calendar/entity/event';
import {
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  SharedEventEntity,
} from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';
const REMOTE_DOMAIN = 'peer.example';

const findInboxForCalendar = async (calendarName: string, app: express.Application): Promise<string> => {
  const webFingerResponse = await request(app).get(`/.well-known/webfinger?resource=acct:${calendarName}@pavillion.dev`);
  expect(webFingerResponse.status, 'webfinger lookup succeeded').toBe(200);

  const profileLink = webFingerResponse.body.links.find((link: any) => link.rel === 'self');
  expect(profileLink, 'found an inbox url').toBeDefined();

  const profileResponse = await request(app).get(profileLink.href.replace('https://pavillion.dev', ''));
  expect(profileResponse.status, 'actor document fetched').toBe(200);

  return profileResponse.body.inbox.replace('https://pavillion.dev', '');
};

type Addressing = { to: string[]; cc?: string[] };

interface AddressingCase {
  name: string;
  /** Distinguishes the case's sender, follower calendar, event and activity. */
  key: string;
  addressing: (followersUrl: string) => Addressing;
  expected: {
    stored: boolean;
    inFeed: boolean;
    listedOnFollower: boolean;
    autoReposted: boolean;
    announceAddressesPublic: boolean;
  };
}

/**
 * Expected values were recorded from a run against the current code. They
 * pin current inbound handling by addressing, which may change deliberately;
 * when it does, update the affected row.
 */
const CASES: AddressingCase[] = [
  {
    name: 'to as:Public, cc followers',
    key: 'publicto',
    addressing: followers => ({ to: [AS_PUBLIC], cc: [followers] }),
    expected: {
      stored: true,
      inFeed: true,
      listedOnFollower: true,
      autoReposted: true,
      announceAddressesPublic: true,
    },
  },
  {
    name: 'to followers, cc as:Public',
    key: 'publiccc',
    addressing: followers => ({ to: [followers], cc: [AS_PUBLIC] }),
    expected: {
      stored: true,
      inFeed: true,
      listedOnFollower: true,
      autoReposted: true,
      announceAddressesPublic: true,
    },
  },
  {
    name: 'to followers, no as:Public',
    key: 'followersonly',
    addressing: followers => ({ to: [followers] }),
    expected: {
      stored: true,
      inFeed: true,
      listedOnFollower: true,
      autoReposted: true,
      announceAddressesPublic: true,
    },
  },
];

beforeEach(() => {
  mockDnsLookup(vi.mocked(dns.lookup), [PUBLIC_IP]);
});

describe('ActivityPub inbox: remote Create(Event) by addressing', () => {
  let env: TestEnvironment;
  let account: Account;
  let calendarInterface: CalendarInterface;
  let activityPubInterface: ActivityPubInterface;
  const sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    activityPubInterface = new ActivityPubInterface(eventBus, calendarInterface, new AccountsInterface());
    // listEvents reads shared-event links through the AP interface.
    calendarInterface.setActivityPubInterface(activityPubInterface);
    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());

    const accountInfo = await accountService._setupAccount('addressing@pavillion.dev', 'testpassword');
    account = accountInfo.account;
  });

  afterEach(() => {
    sandbox.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  // Pins current inbound handling by addressing: the activity, its embedded
  // Event and the origin document served for the ownership re-fetch carry
  // the same addressing, and only that addressing differs between cases.
  it.each(CASES)('pins current inbound handling by addressing: $name', async ({ key, addressing, expected }) => {
    const remoteCalendar = `source${key}`;
    const remoteActorUri = `https://${REMOTE_DOMAIN}/calendars/${remoteCalendar}`;
    const remoteEventUrl = `https://${REMOTE_DOMAIN}/events/${key}`;
    const activityId = `${remoteEventUrl}/create`;
    const addressed = addressing(`${remoteActorUri}/followers`);

    // A fresh follower calendar per case, following its own sender with
    // auto-repost of originals on, so no row from one case can satisfy
    // another's assertions.
    const follower: Calendar = await calendarInterface.createCalendar(account, `follower${key}`);
    await createFollowingRelationship(follower.id, remoteActorUri, true, false);

    const inboxUrl = await findInboxForCalendar(follower.urlName, env.app);
    const getStub = sandbox.stub(axios, 'get');
    getStub.callsFake(async (url: string) => {
      throw new Error(`unexpected axios.get ${url}`);
    });
    sandbox.stub(httpSignature, 'verifySignature').returns(true);
    env.stubRemoteCalendar(getStub, REMOTE_DOMAIN, remoteCalendar);

    // processCreateEvent verifies ownership by re-fetching the object from
    // its origin and comparing attributedTo with the activity's actor.
    getStub.withArgs(remoteEventUrl).resolves({
      status: 200,
      data: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: remoteEventUrl,
        type: 'Event',
        attributedTo: remoteActorUri,
        ...addressed,
      },
    });

    const response = await env.signedPost(
      inboxUrl,
      env.fakeRemoteAuth(REMOTE_DOMAIN, remoteCalendar),
      {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Create',
        actor: remoteActorUri,
        ...addressed,
        object: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: remoteEventUrl,
          type: 'Event',
          attributedTo: remoteActorUri,
          ...addressed,
          content: { en: { name: `Addressing ${key}`, description: 'x' } },
        },
      });

    expect(response.status, 'inbox accepted the delivery').toBe(200);

    const inboxRow = await waitFor(async () => {
      const row = await ActivityPubInboxMessageEntity.findByPk(activityId);
      return row?.processed_status ? row : null;
    });
    expect(inboxRow.processed_status, 'inbox message admitted and processed').toBe('ok');

    const entity = await EventEntity.findOne({ where: { event_source_url: remoteEventUrl } });
    expect(entity !== null, 'event stored').toBe(expected.stored);
    if (!entity) {
      return;
    }

    const feed = await activityPubInterface.getFeed(follower);
    expect(feed.some(item => item.id === entity.id), 'event in the follower feed').toBe(expected.inFeed);

    const listed = await calendarInterface.listEvents(follower);
    expect(listed.some(e => e.id === entity.id), 'event listed on the follower calendar').toBe(expected.listedOnFollower);

    const share = expected.autoReposted
      ? await waitFor(() => SharedEventEntity.findOne({ where: { event_id: entity.id, calendar_id: follower.id } }))
      : await SharedEventEntity.findOne({ where: { event_id: entity.id, calendar_id: follower.id } });
    expect(share !== null && share.auto_posted === true, 'auto-repost recorded').toBe(expected.autoReposted);
    if (!share) {
      return;
    }

    const announce = await waitFor(() => ActivityPubOutboxMessageEntity.findOne({
      where: { calendar_id: follower.id, type: 'Announce' },
    }));
    const message = announce.message as any;
    expect(message.object, 'Announce carries the canonical event IRI').toBe(remoteEventUrl);
    const recipients = [message.to, message.cc].flat().filter(Boolean);
    expect(recipients.includes(AS_PUBLIC), 'Announce addresses as:Public').toBe(expected.announceAddressesPublic);
  });
});
