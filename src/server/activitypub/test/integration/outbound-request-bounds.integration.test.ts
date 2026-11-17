/**
 * Outbound federation requests are bounded in size and in total time.
 *
 * Each case runs the real code path against a real HTTP stub peer: the outbox
 * drain resolving a recipient's inbox, the drain's delivery POST, and the
 * signed-in remote-calendar lookup route. The peer either sends a body larger
 * than the cap or sends headers and then trickles the body slower than the
 * idle timeout, which only the overall deadline can stop.
 *
 * Federation hostnames are https and public, so the stub is reached by
 * rewriting `https://<peer>/path` to the stub's loopback port at the axios
 * boundary — the request config (caps, signal) still goes to real axios
 * untouched. The private-address check is mocked out for the same reason.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import config from 'config';
import http from 'http';
import { AddressInfo } from 'net';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import ProcessOutboxService from '@/server/activitypub/service/outbox';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import { addToOutbox } from '@/server/activitypub/helper/outbox';
import CreateActivity from '@/server/activitypub/model/action/create';
import { ActivityPubOutboxMessageEntity, FollowerCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { ACTOR_PROFILE_MAX_BYTES, DELIVERY_RESPONSE_MAX_BYTES, SIGNED_DELIVERY_RESPONSE_MAX_BYTES } from '@/server/activitypub/helper/fetch-limits';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

// A short deadline keeps the trickle cases fast. The idle timeout stays at its
// real 15s, so a request that ends in well under that was ended by the deadline.
vi.mock('@/server/common/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/common/constants')>()),
  FEDERATION_HTTP_DEADLINE_MS: 500,
}));

// The stub peer is on loopback; the real check would refuse it.
vi.mock('@/server/common/helper/ip-validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/common/helper/ip-validation')>()),
  validateUrlNotPrivate: vi.fn(async () => {}),
}));

const DOMAIN = config.get<string>('domain');
const PEER = 'https://peer.example';
const PEER_HOST = 'peer.example';
const TRICKLE_INTERVAL_MS = 20;
/** Well under the 15s idle timeout: only the deadline can end a request this fast. */
const ENDED_BY_DEADLINE_WITHIN_MS = 5_000;

/** What the stub peer saw. */
interface PeerLog {
  /** Paths whose response was cut off before the peer finished sending. */
  cutOff: string[];
  /** Paths requested, in order. */
  requested: string[];
}

interface StubPeer {
  port: number;
  log: PeerLog;
  close: () => Promise<void>;
}

/**
 * A stub ActivityPub peer.
 *
 *   /actor?inbox=/x   an actor document whose inbox is https://peer.example/x
 *   /actor-big        an actor document larger than ACTOR_PROFILE_MAX_BYTES
 *   /actor-trickle    headers, then the body a byte at a time, never finishing
 *   /inbox-ok         202, empty
 *   /inbox-big        200 with a body larger than DELIVERY_RESPONSE_MAX_BYTES
 *   /inbox-event      200 with an event document of 128 KiB, over DELIVERY_RESPONSE_MAX_BYTES
 *   /inbox-huge       200 with a body larger than SIGNED_DELIVERY_RESPONSE_MAX_BYTES
 *   /inbox-trickle    headers, then the body a byte at a time, never finishing
 *   /.well-known/webfinger[-big]   WebFinger pointing at /actor-big or /actor-trickle
 */
async function startStubPeer(): Promise<StubPeer> {
  const log: PeerLog = { cutOff: [], requested: [] };
  const sockets = new Set<import('net').Socket>();

  const trickle = (res: http.ServerResponse, path: string, contentType: string) => {
    res.writeHead(200, { 'content-type': contentType });
    res.write('{"inbox":"');
    const timer = setInterval(() => res.write('x'), TRICKLE_INTERVAL_MS);
    res.on('close', () => {
      clearInterval(timer);
      if (!res.writableFinished) {
        log.cutOff.push(path);
      }
    });
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    log.requested.push(url.pathname);
    req.resume();
    const actorType = 'application/activity+json';

    switch (url.pathname) {
      case '/actor': {
        res.writeHead(200, { 'content-type': actorType });
        res.end(JSON.stringify({ id: `${PEER}/actor`, inbox: `${PEER}${url.searchParams.get('inbox') ?? '/inbox-ok'}` }));
        return;
      }
      case '/actor-big': {
        res.writeHead(200, { 'content-type': actorType });
        res.end(JSON.stringify({ inbox: `${PEER}/inbox-ok`, summary: 'x'.repeat(ACTOR_PROFILE_MAX_BYTES * 2) }));
        return;
      }
      case '/actor-trickle':
        trickle(res, url.pathname, actorType);
        return;
      case '/inbox-ok':
        res.writeHead(202).end();
        return;
      case '/inbox-big':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(DELIVERY_RESPONSE_MAX_BYTES * 2));
        return;
      case '/inbox-event':
        res.writeHead(200, { 'content-type': actorType });
        res.end(JSON.stringify({ id: `${PEER}/event`, summary: 'x'.repeat(DELIVERY_RESPONSE_MAX_BYTES * 2) }));
        return;
      case '/inbox-huge':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(SIGNED_DELIVERY_RESPONSE_MAX_BYTES * 2));
        return;
      case '/inbox-trickle':
        trickle(res, url.pathname, 'text/plain');
        return;
      case '/.well-known/webfinger': {
        const target = url.searchParams.get('target') ?? 'actor-big';
        res.writeHead(200, { 'content-type': 'application/jrd+json' });
        res.end(JSON.stringify({ links: [{ rel: 'self', type: actorType, href: `${PEER}/${target}` }] }));
        return;
      }
      case '/.well-known/webfinger-big':
        res.writeHead(200, { 'content-type': 'application/jrd+json' });
        res.end(JSON.stringify({ links: [], pad: 'x'.repeat(ACTOR_PROFILE_MAX_BYTES * 2) }));
        return;
      default:
        res.writeHead(404).end();
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

  return {
    port: (server.address() as AddressInfo).port,
    log,
    close: () => new Promise<void>((resolve) => {
      sockets.forEach(socket => socket.destroy());
      server.close(() => resolve());
    }),
  };
}

/** The stub-bound form of a URL on one of the stub's hostnames, else the URL unchanged. */
function toStub(url: string, port: number): string {
  const parsed = new URL(url);
  if (parsed.hostname !== PEER_HOST && parsed.hostname !== 'lookup.example') {
    return url;
  }
  return `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
}

/** A local calendar with one remote follower, whose actor document is at `followerUri`. */
async function createFollowedCalendar(urlName: string, followerUri: string): Promise<Calendar> {
  const calendar = new Calendar(uuidv4(), urlName);
  await CalendarEntity.create({ id: calendar.id, url_name: urlName, account_id: uuidv4(), languages: 'en' });
  await CalendarActorEntity.create({
    id: uuidv4(),
    actor_type: 'local',
    calendar_id: calendar.id,
    actor_uri: `https://${DOMAIN}/calendars/${urlName}`,
  });
  // The remote actor outlives a test (actor_uri is unique), so reuse it.
  const follower = await CalendarActorEntity.findOne({ where: { actor_uri: followerUri } })
    ?? await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'remote',
      calendar_id: null,
      actor_uri: followerUri,
      inbox_url: `${PEER}/unused`,
      remote_domain: PEER_HOST,
    });
  await FollowerCalendarEntity.create({ id: uuidv4(), calendar_actor_id: follower.id, calendar_id: calendar.id });
  return calendar;
}

/** Writes a public Create by the calendar to its outbox; `ageMs` old so rows drain oldest first. */
async function writeOutboxRow(calendar: Calendar, ageMs = 0): Promise<ActivityPubOutboxMessageEntity> {
  const actor = `https://${DOMAIN}/calendars/${calendar.urlName}`;
  const activity = CreateActivity.fromObject({
    actor,
    object: { id: `${actor}/events/${uuidv4()}`, type: 'Event', attributedTo: actor },
  })!.addressPublic(`${actor}/followers`);
  await addToOutbox(new EventEmitter(), calendar, activity);
  await ActivityPubOutboxMessageEntity.update(
    { message_time: new Date(Date.now() - ageMs) },
    { where: { id: activity.id } },
  );
  return (await ActivityPubOutboxMessageEntity.findByPk(activity.id))!;
}

async function storedStatus(id: string): Promise<string | null> {
  return (await ActivityPubOutboxMessageEntity.findByPk(id))!.processed_status;
}

function outboxService(): ProcessOutboxService {
  const eventBus = new EventEmitter();
  return new ProcessOutboxService(eventBus, new ProcessInboxService(eventBus, new CalendarInterface(eventBus)));
}

describe('Outbound federation request bounds', () => {
  let env: TestEnvironment;
  let peer: StubPeer;
  let sandbox: sinon.SinonSandbox;
  let getSpy: sinon.SinonStub;
  let postSpy: sinon.SinonStub;
  let realGet: typeof axios.get;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
    peer = await startStubPeer();
  });

  afterAll(async () => {
    await peer?.close();
    await env?.cleanup();
  });

  beforeEach(async () => {
    await ActivityPubOutboxMessageEntity.destroy({ where: {} });
    peer.log.cutOff.length = 0;
    peer.log.requested.length = 0;
    sandbox = sinon.createSandbox();
    sandbox.stub(CalendarActorService.prototype, 'signActivity').callsFake(async (actorUri: string) => ({
      keyId: `${actorUri}#main-key`,
      signature: 'mock-signature-base64',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest',
      date: new Date().toUTCString(),
    }));
    // Real axios, aimed at the stub peer. The config is passed through as-is.
    realGet = axios.get.bind(axios);
    const realPost = axios.post.bind(axios);
    getSpy = sandbox.stub(axios, 'get').callsFake((url: string, cfg?: any) => realGet(toStub(url, peer.port), cfg));
    postSpy = sandbox.stub(axios, 'post').callsFake((url: string, data?: any, cfg?: any) => realPost(toStub(url, peer.port), data, cfg));
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('outbox drain: resolving the recipient inbox', () => {
    it('fails the delivery, and moves on, when the actor document is larger than the cap', async () => {
      const bigCalendar = await createFollowedCalendar('boundbigactor', `${PEER}/actor-big`);
      const okCalendar = await createFollowedCalendar('boundokactor1', `${PEER}/actor?inbox=/inbox-ok`);
      const big = await writeOutboxRow(bigCalendar, 60_000);
      const next = await writeOutboxRow(okCalendar);

      await outboxService().processOutboxMessages();

      expect(await storedStatus(big.id)).toMatch(/^(error|partial):/);
      expect((await ActivityPubOutboxMessageEntity.findByPk(big.id))!.processed_time).not.toBeNull();
      expect(await storedStatus(next.id)).toBe('ok');
    });

    it('aborts at the overall deadline, and moves on, when the actor document trickles', async () => {
      const slowCalendar = await createFollowedCalendar('boundslowactor', `${PEER}/actor-trickle`);
      const okCalendar = await createFollowedCalendar('boundokactor2', `${PEER}/actor?inbox=/inbox-ok`);
      const slow = await writeOutboxRow(slowCalendar, 60_000);
      const next = await writeOutboxRow(okCalendar);

      const startedAt = Date.now();
      await outboxService().processOutboxMessages();

      expect(Date.now() - startedAt).toBeLessThan(ENDED_BY_DEADLINE_WITHIN_MS);
      expect(await storedStatus(slow.id)).toMatch(/^(error|partial):/);
      expect(await storedStatus(next.id)).toBe('ok');
      await vi.waitFor(() => expect(peer.log.cutOff).toContain('/actor-trickle'));
    });
  });

  describe('outbox drain: the delivery POST response', () => {
    it('fails the delivery, and moves on, when the response body is larger than the cap', async () => {
      const bigCalendar = await createFollowedCalendar('boundbigreply', `${PEER}/actor?inbox=/inbox-big`);
      const okCalendar = await createFollowedCalendar('boundokreply1', `${PEER}/actor?inbox=/inbox-ok`);
      const big = await writeOutboxRow(bigCalendar, 60_000);
      const next = await writeOutboxRow(okCalendar);

      await outboxService().processOutboxMessages();

      expect(await storedStatus(big.id)).toMatch(/^partial:/);
      expect(peer.log.requested).toContain('/inbox-big');
      expect(await storedStatus(next.id)).toBe('ok');
    });

    it('aborts at the overall deadline, and moves on, when the response trickles', async () => {
      const slowCalendar = await createFollowedCalendar('boundslowreply', `${PEER}/actor?inbox=/inbox-trickle`);
      const okCalendar = await createFollowedCalendar('boundokreply2', `${PEER}/actor?inbox=/inbox-ok`);
      const slow = await writeOutboxRow(slowCalendar, 60_000);
      const next = await writeOutboxRow(okCalendar);

      const startedAt = Date.now();
      await outboxService().processOutboxMessages();

      expect(Date.now() - startedAt).toBeLessThan(ENDED_BY_DEADLINE_WITHIN_MS);
      expect(await storedStatus(slow.id)).toMatch(/^partial:/);
      expect(await storedStatus(next.id)).toBe('ok');
      await vi.waitFor(() => expect(peer.log.cutOff).toContain('/inbox-trickle'));
    });

    it('still delivers to a peer that answers within the bounds', async () => {
      const calendar = await createFollowedCalendar('boundokreply3', `${PEER}/actor?inbox=/inbox-ok`);
      const row = await writeOutboxRow(calendar);

      await outboxService().processOutboxMessages();

      expect(await storedStatus(row.id)).toBe('ok');
      expect(postSpy.callCount).toBe(1);
      expect(postSpy.firstCall.args[2].maxContentLength).toBe(DELIVERY_RESPONSE_MAX_BYTES);
    });
  });

  describe('GET /api/v1/social/lookup', () => {
    let authKey: string;

    beforeAll(async () => {
      const eventBus = new EventEmitter();
      const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());
      await accountService._setupAccount('bounds-lookup@pavillion.dev', 'testpassword');
      authKey = await env.login('bounds-lookup@pavillion.dev', 'testpassword');
    });

    /** Looks up calendar@lookup.example, whose WebFinger answer names `target`. */
    async function lookup(target: string, webfinger = 'webfinger') {
      // The WebFinger URL is fixed by the code under test, so choose the route
      // the stub serves for it by rewriting the path here.
      getSpy.callsFake((url: string, cfg?: any) => {
        const rewritten = url.includes('/.well-known/webfinger')
          ? `https://lookup.example/.well-known/${webfinger}?target=${target}`
          : url;
        return realGet(toStub(rewritten, peer.port), cfg);
      });
      return env.authGet(authKey, '/api/v1/social/lookup?identifier=calendar@lookup.example');
    }

    it('fails the lookup when the actor document is larger than the cap', async () => {
      const response = await lookup('actor-big');

      expect(response.status).toBe(500);
      expect(response.body.errorName).toBe('RemoteProfileFetchError');
      expect(peer.log.requested).toContain('/actor-big');
    });

    it('aborts at the overall deadline when the actor document trickles', async () => {
      const startedAt = Date.now();
      const response = await lookup('actor-trickle');

      expect(Date.now() - startedAt).toBeLessThan(ENDED_BY_DEADLINE_WITHIN_MS);
      expect(response.status).toBe(500);
      expect(response.body.errorName).toBe('RemoteProfileFetchError');
      await vi.waitFor(() => expect(peer.log.cutOff).toContain('/actor-trickle'));
    });

    it('fails the lookup when the WebFinger response is larger than the cap', async () => {
      const response = await lookup('actor-big', 'webfinger-big');

      expect(response.status).toBe(500);
      expect(response.body.errorName).toBe('RemoteProfileFetchError');
      expect(peer.log.requested).not.toContain('/actor-big');
    });
  });

  describe('signed delivery whose reply the caller reads', () => {
    const actor = `https://${DOMAIN}/calendars/signedbounds`;
    const activity = { type: 'Create', actor, object: { type: 'Event' } };
    const deliver = (path: string) => outboxService().deliverActivitySigned(actor, activity, `${PEER}${path}`);

    it('returns an event-sized reply that exceeds the ignored-reply cap', async () => {
      const result = await deliver('/inbox-event');

      expect(result.status).toBe(200);
      expect(result.data.id).toBe(`${PEER}/event`);
    });

    it('rejects with a delivery error when the reply is larger than the cap', async () => {
      await expect(deliver('/inbox-huge')).rejects.toMatchObject({ name: 'FederationDeliveryError' });
      expect(peer.log.requested).toContain('/inbox-huge');
    });

    it('aborts at the overall deadline when the reply trickles', async () => {
      const startedAt = Date.now();

      await expect(deliver('/inbox-trickle')).rejects.toMatchObject({ name: 'FederationDeliveryError' });

      expect(Date.now() - startedAt).toBeLessThan(ENDED_BY_DEADLINE_WITHIN_MS);
      await vi.waitFor(() => expect(peer.log.cutOff).toContain('/inbox-trickle'));
    });
  });
});
