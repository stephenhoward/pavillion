/**
 * Integration test: a follow backfill run through the worker's own wiring,
 * then drained by the web process, leaves the backfilled event with
 * `event_instance` rows.
 *
 * The worker (`src/server/worker.ts`) builds a bare EventEmitter with no
 * domain event handlers installed, so it must only write inbox rows: an
 * event it dispatched itself would never get the instances the calendar
 * domain's `eventCreated` handler builds. This test runs the
 * `activitypub:follow:backfill` job handler exactly as `registerJobHandlers`
 * wires it, against a stubbed remote outbox holding one Create(Event), checks
 * that the job left its row undispatched, and then starts the inbox drain on
 * the ActivityPubDomain the web process built (`initPavillionServer`, every
 * domain's handlers on one bus, the real moderation interface).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';
import { JobHandler } from '@/server/housekeeping/service/job-queue';
import { registerJobHandlers } from '@/server/worker';
import ActivityPubDomain from '@/server/activitypub';
import { fetchRemoteObject } from '@/server/activitypub/helper/remote-fetch';
import { backfillRateLimiter } from '@/server/activitypub/service/backfill';
import { ActivityPubInboxMessageEntity, FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';

vi.mock('@/server/activitypub/helper/remote-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/activitypub/helper/remote-fetch')>();
  return { ...actual, fetchRemoteObject: vi.fn() };
});

const SOURCE_ORIGIN = 'https://source.example';
const SOURCE_ACTOR_URI = `${SOURCE_ORIGIN}/calendars/source`;
const SOURCE_OUTBOX_URI = `${SOURCE_ACTOR_URI}/outbox`;
const SOURCE_PAGE_URI = `${SOURCE_OUTBOX_URI}?page=1`;
const EVENT_URI = `${SOURCE_ORIGIN}/events/backfilled`;
const CREATE_ACTIVITY_ID = `${EVENT_URI}/create`;

const EVENT_OBJECT = {
  id: EVENT_URI,
  type: 'Event',
  attributedTo: SOURCE_ACTOR_URI,
  name: 'Backfilled event',
  startTime: '2027-03-15T14:00:00Z',
  endTime: '2027-03-15T16:00:00Z',
};

/** Captures the handlers the worker registers so a job can be run without pg-boss. */
class FakeJobQueueService {
  public handlers: Record<string, JobHandler<any>> = {};

  async subscribe<T>(jobName: string, handler: JobHandler<T>): Promise<void> {
    this.handlers[jobName] = handler;
  }

  async schedule<T>(jobName: string, _cron: string, handler: JobHandler<T>): Promise<void> {
    this.handlers[jobName] = handler;
  }
}

describe('Follow backfill through the worker wiring, drained by the web process', () => {
  let env: TestEnvironment;
  let webDomain: ActivityPubDomain | undefined;
  let queue: FakeJobQueueService;
  let followerCalendarId: string;
  let sourceCalendarActorId: string;
  let stopDrain: (() => void) | undefined;

  beforeAll(async () => {
    // initPavillionServer does not start the drain in test mode, and keeps
    // no handle on the domain it builds; capture that domain as it installs
    // its handlers so the test can start the drain the web process starts.
    const installSpy = sinon.spy(ActivityPubDomain.prototype, 'installEventHandlers');
    try {
      env = new TestEnvironment();
      await env.init();
      webDomain = installSpy.thisValues[0] as ActivityPubDomain | undefined;
    }
    finally {
      installSpy.restore();
    }
  });

  beforeEach(async () => {
    backfillRateLimiter.reset?.();

    const responses: Record<string, Record<string, unknown>> = {
      [SOURCE_ACTOR_URI]: { type: 'Group', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_URI },
      [SOURCE_PAGE_URI]: {
        type: 'OrderedCollectionPage',
        orderedItems: [{
          id: CREATE_ACTIVITY_ID,
          type: 'Create',
          actor: SOURCE_ACTOR_URI,
          published: new Date().toISOString(),
          object: EVENT_OBJECT,
        }],
      },
      // processCreateEvent re-fetches the object to verify attribution.
      [EVENT_URI]: EVENT_OBJECT,
    };
    vi.mocked(fetchRemoteObject).mockImplementation(async (uri: string) => responses[uri] ?? null);

    followerCalendarId = uuidv4();
    await CalendarEntity.create({
      id: followerCalendarId,
      url_name: `follower${followerCalendarId.slice(0, 8)}`,
      account_id: uuidv4(),
      languages: 'en',
    });

    sourceCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: sourceCalendarActorId,
      actor_type: 'remote',
      actor_uri: SOURCE_ACTOR_URI,
      remote_display_name: null,
      remote_domain: new URL(SOURCE_ACTOR_URI).hostname,
      calendar_id: null,
      private_key: null,
    });

    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: sourceCalendarActorId,
      calendar_id: followerCalendarId,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });

    queue = new FakeJobQueueService();
    await registerJobHandlers(queue as any);
  });

  afterEach(() => {
    stopDrain?.();
    stopDrain = undefined;
    vi.mocked(fetchRemoteObject).mockReset();
  });

  it('leaves the backfilled event with event_instance rows once the web process drains', async () => {
    await queue.handlers['activitypub:follow:backfill']({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    }, undefined);

    // The worker only wrote the row: dispatching it there, on a bus with no
    // calendar handlers, would create the event without its instances.
    const row = await ActivityPubInboxMessageEntity.findByPk(CREATE_ACTIVITY_ID);
    expect(row?.processed_time, 'worker left the backfilled row undispatched').toBeNull();
    expect(await EventEntity.count({ where: { event_source_url: EVENT_URI } })).toBe(0);

    expect(webDomain, 'captured the web process ActivityPubDomain').toBeDefined();
    stopDrain = webDomain?.startInboxDrain();

    const event = await waitFor(
      () => EventEntity.findOne({ where: { event_source_url: EVENT_URI } }),
    );

    // The event carries a schedule, so instances are buildable from it.
    expect(await EventScheduleEntity.count({ where: { event_id: event.id } })).toBeGreaterThan(0);

    const instances = await waitFor(async () => {
      const rows = await EventInstanceEntity.findAll({ where: { event_id: event.id } });
      return rows.length > 0 ? rows : null;
    }).catch(() => [] as EventInstanceEntity[]);

    expect(instances.length, 'backfilled event has event_instance rows').toBeGreaterThan(0);

    const processed = await waitFor(async () => {
      const drained = await ActivityPubInboxMessageEntity.findByPk(CREATE_ACTIVITY_ID);
      return drained?.processed_time ? drained : null;
    });
    expect(processed.processed_status, 'the drain dispatched the backfilled row cleanly').toBe('ok');
  });
});
