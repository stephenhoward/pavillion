/**
 * Integration test for the follow-backfill worker.
 *
 * Pins the end-to-end path: a synthetic remote outbox served across two
 * pages -> the worker's pagination + trust + routing logic -> the real
 * inbox `processCreateEvent` -> `EventObjectEntity` + `EventEntity` rows ->
 * `getEventsFromFollowedSources` returning the new events on the follower
 * calendar's feed.
 *
 * The HTTP boundary (`fetchRemoteObject`) is mocked at the module level
 * because real federation requires DNS, TLS, and a peer running an outbox;
 * everything from the worker downward runs against real services and real
 * SQLite-backed entities. This matches the bead's "exercising real HTTP-
 * shape parsing" requirement: the worker parses real AP collection /
 * collection-page payloads and threads them through the real inbox
 * pipeline.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';

// Mock the remote-fetch helper so both the backfill worker and the inbox
// `actorOwnsObject` check observe the same scripted federation peer.
vi.mock('@/server/activitypub/helper/remote-fetch', () => ({
  fetchRemoteObject: vi.fn(),
}));

import { fetchRemoteObject } from '@/server/activitypub/helper/remote-fetch';
import { FollowBackfillService } from '@/server/activitypub/service/backfill';
import { SyncRateLimiter } from '@/server/common/helper/rate-limiter';

const REMOTE_HOST = 'remote.federation.test';
const REMOTE_ACTOR_URI = `https://${REMOTE_HOST}/calendars/sourcecal`;
const REMOTE_OUTBOX_URI = `https://${REMOTE_HOST}/calendars/sourcecal/outbox`;
const REMOTE_OUTBOX_PAGE_1 = `${REMOTE_OUTBOX_URI}?page=true`;
const REMOTE_OUTBOX_PAGE_2 = `${REMOTE_OUTBOX_URI}?page=true&p=2`;

function eventApId(slug: string): string {
  return `https://${REMOTE_HOST}/events/${slug}`;
}

function createActivity(slug: string, name: string): Record<string, unknown> {
  const eventId = eventApId(slug);
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${REMOTE_ACTOR_URI}/activities/${slug}`,
    type: 'Create',
    actor: REMOTE_ACTOR_URI,
    object: {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Event',
      id: eventId,
      attributedTo: REMOTE_ACTOR_URI,
      content: {
        en: {
          name,
          description: `Synthetic event ${slug} from backfill source`,
        },
      },
      schedules: [
        {
          startDate: '2026-06-01',
          endDate: '2026-06-01',
          startTime: '10:00',
          endTime: '11:00',
        },
      ],
    },
  };
}

describe('Follow backfill integration', () => {
  let env: TestEnvironment;
  let eventBus: EventEmitter;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let activityPubInterface: ActivityPubInterface;
  let backfillService: FollowBackfillService;

  let followerAccount: Account;
  let followerCalendar: Calendar;
  let followingId: string;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    activityPubInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const accountInfo = await accountService._setupAccount('backfillfollower@pavillion.dev', 'testpassword');
    followerAccount = accountInfo.account;
    followerCalendar = await calendarInterface.createCalendar(followerAccount, 'backfillfollower');

    backfillService = new FollowBackfillService({
      activityPubInterface,
      calendarInterface,
      // Tight per-test budget for test determinism; far above what we need.
      rateLimiter: new SyncRateLimiter({ limit: 100, windowMs: 60_000 }),
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    // Reset the mock; each test scripts its own peer.
    vi.mocked(fetchRemoteObject).mockReset();

    // Drop any prior follow rows / event objects / remote actor rows so the
    // unique constraint on calendar_actor.actor_uri does not trip on the
    // second test in the file.
    await FollowingCalendarEntity.destroy({ where: {} });
    await EventObjectEntity.destroy({ where: {} });
    await CalendarActorEntity.destroy({ where: { actor_type: 'remote' } });

    // Seed a remote CalendarActor + Following row so the worker can resolve
    // the source from the payload it receives off the job queue.
    const calendarActor = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'remote',
      calendar_id: null,
      actor_uri: REMOTE_ACTOR_URI,
      remote_domain: REMOTE_HOST,
      private_key: null,
    });
    followingId = uuidv4();
    await FollowingCalendarEntity.create({
      id: followingId,
      calendar_actor_id: calendarActor.id,
      calendar_id: followerCalendar.id,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('walks a two-page outbox and lands events on the follower feed', async () => {
    const ev1 = createActivity('one', 'Backfill Event One');
    const ev2 = createActivity('two', 'Backfill Event Two');
    const ev3 = createActivity('three', 'Backfill Event Three');

    vi.mocked(fetchRemoteObject).mockImplementation(async (uri: string) => {
      switch (uri) {
        case REMOTE_ACTOR_URI:
          return { id: REMOTE_ACTOR_URI, type: 'Group', outbox: REMOTE_OUTBOX_URI };
        case REMOTE_OUTBOX_URI:
          return {
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollection',
            id: REMOTE_OUTBOX_URI,
            first: REMOTE_OUTBOX_PAGE_1,
          };
        case REMOTE_OUTBOX_PAGE_1:
          return {
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollectionPage',
            id: REMOTE_OUTBOX_PAGE_1,
            partOf: REMOTE_OUTBOX_URI,
            orderedItems: [ev1, ev2],
            next: REMOTE_OUTBOX_PAGE_2,
          };
        case REMOTE_OUTBOX_PAGE_2:
          return {
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollectionPage',
            id: REMOTE_OUTBOX_PAGE_2,
            partOf: REMOTE_OUTBOX_URI,
            orderedItems: [ev3],
          };
        case eventApId('one'):
          return { id: eventApId('one'), type: 'Event', attributedTo: REMOTE_ACTOR_URI };
        case eventApId('two'):
          return { id: eventApId('two'), type: 'Event', attributedTo: REMOTE_ACTOR_URI };
        case eventApId('three'):
          return { id: eventApId('three'), type: 'Event', attributedTo: REMOTE_ACTOR_URI };
        default:
          return null;
      }
    });

    await backfillService.runBackfill({
      followingCalendarId: followingId,
      calendarActorId: 'irrelevant-for-worker',
      sourceActorUri: REMOTE_ACTOR_URI,
    });

    // EventObject rows landed for all three events. The unique constraint
    // on `ap_event_object.ap_id` is the inbox handler's idempotency anchor
    // (DEC-008 dismissals + auto-repost suppression run through the same
    // entity), so this is the load-bearing assertion for "backfill landed
    // the events".
    const objects = await EventObjectEntity.findAll({
      where: { attributed_to: REMOTE_ACTOR_URI },
    });
    const apIds = objects.map(o => o.ap_id).sort();
    expect(apIds).toEqual([
      eventApId('one'),
      eventApId('three'),
      eventApId('two'),
    ]);

    // The events are reachable via the same feed query the API renders.
    // We assert presence by event-id linkage (EventObjectEntity -> EventEntity)
    // rather than by content-name lookup because the test calendar uses
    // SQLite literal joins and the simplest stable surface is the row link.
    const feed = await calendarInterface.getEventsFromFollowedSources(followerCalendar);
    const feedEventIds = new Set(feed.map((e: { id: string }) => e.id));
    for (const obj of objects) {
      expect(feedEventIds.has(obj.event_id)).toBe(true);
    }
  });

  it('respects in-page Delete: a Create + Delete for the same ap_id in one page yields no event row', async () => {
    const apId = eventApId('ephemeral');
    const create = createActivity('ephemeral', 'Ephemeral Event');
    const del = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${REMOTE_ACTOR_URI}/activities/ephemeral-delete`,
      type: 'Delete',
      actor: REMOTE_ACTOR_URI,
      object: apId,
    };

    vi.mocked(fetchRemoteObject).mockImplementation(async (uri: string) => {
      switch (uri) {
        case REMOTE_ACTOR_URI:
          return { id: REMOTE_ACTOR_URI, type: 'Group', outbox: REMOTE_OUTBOX_URI };
        case REMOTE_OUTBOX_URI:
          return {
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollectionPage',
            id: REMOTE_OUTBOX_URI,
            orderedItems: [create, del],
          };
        default:
          return null;
      }
    });

    await backfillService.runBackfill({
      followingCalendarId: followingId,
      calendarActorId: 'irrelevant',
      sourceActorUri: REMOTE_ACTOR_URI,
    });

    const objects = await EventObjectEntity.findAll({ where: { ap_id: apId } });
    expect(objects.length).toBe(0);
  });
});
