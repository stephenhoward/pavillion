/**
 * Integration tests for FollowBackfillService.
 *
 * These tests verify the public `runBackfill` contract end-to-end:
 *   - persistence shape (auth_source, auth_origin, clamped message_time)
 *   - trust-gate rejection at the public entry point (no helper mocking)
 *   - the walk is buffered and written oldest first when it ends, so a drain
 *     running mid-walk sees none of it
 *   - no inbox drain: the service only writes rows; the web process drains
 *   - idempotency under re-run
 *   - first-writer-wins race when a live HTTP-signed row already exists
 *   - no `inboxMessageAdded` emission on the backfill path
 *   - private-URL SSRF rejection on the source actor URI
 *   - nothing written when the walk pauses on the rate limit or the follow
 *     row disappears mid-walk or before the write
 *   - a refused or unreachable next page, or the buffer byte cap, ends the
 *     walk normally and the buffer is written
 *
 * The trust-gate logic itself has dedicated unit tests in
 * `../service/backfill.test.ts`. The cases here exercise the public
 * `runBackfill` path so that the integration tier proves trust-gate wiring,
 * not branch coverage.
 *
 * Approach: `TestEnvironment` for the full schema (the worker calls
 * `calendarInterface.getCalendar` which hydrates CalendarEntity with its
 * CalendarContent / Media includes — a partial sync is not enough). An
 * injected `fetcher` stub drives the outbox pagination, a fresh
 * `SyncRateLimiter` per test eliminates cross-test budget interference,
 * and `processInboxMessages` is replaced with a no-op stub on the real
 * `ActivityPubInterface` as a sentinel: the service must never call it. Tests
 * that need a real drain call the inbox service directly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';

// Capture the backfill logger's warn lines (the truncation warnings) while
// every other logger stays real. vi.hoisted keeps the reference valid.
const { backfillWarn } = vi.hoisted(() => ({ backfillWarn: vi.fn() }));
vi.mock('@/server/common/helper/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/common/helper/logger')>();
  return {
    ...actual,
    createLogger: (domain: string) => {
      const child = actual.createLogger(domain);
      if (domain === 'activitypub.backfill') {
        child.warn = backfillWarn as unknown as typeof child.warn;
      }
      return child;
    },
  };
});
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import { FollowBackfillService, BackfillRateLimitError } from '@/server/activitypub/service/backfill';
import { fetchRemoteObject } from '@/server/activitypub/helper/remote-fetch';
import {
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  EventActivityEntity,
  FollowingCalendarEntity,
  RepostDismissalEntity,
  SharedEventEntity,
} from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { SyncRateLimiter } from '@/server/common/helper/rate-limiter';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOURCE_ORIGIN = 'https://source.example';
const SOURCE_ACTOR_URI = `${SOURCE_ORIGIN}/calendars/source`;
const SOURCE_OUTBOX_URI = `${SOURCE_ORIGIN}/calendars/source/outbox`;
const SOURCE_PAGE_1_URI = `${SOURCE_ORIGIN}/calendars/source/outbox?page=1`;
const SOURCE_PAGE_2_URI = `${SOURCE_ORIGIN}/calendars/source/outbox?page=2`;

/**
 * The clock every run reads unless a test injects its own. A fixed reading
 * keeps the clamp window still, so a `published` date written relative to it
 * never drifts past the two-year floor as the real clock moves on.
 */
const NOW = new Date('2026-05-16T12:00:00Z');

/** An ISO timestamp `hours` before {@link NOW}. */
function hoursBeforeNow(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Builds a Create activity for the source calendar to publish.
 *
 * `published` controls the `messageTime` after `clampMessageTime` runs.
 * `id` is the unique inbox key; reusing it across runs exercises
 * `findOrCreate` idempotency.
 */
function buildCreate(
  id: string,
  published: string,
  actor: string = SOURCE_ACTOR_URI,
): Record<string, unknown> {
  return {
    id,
    type: 'Create',
    actor,
    published,
    object: {
      id: `${SOURCE_ORIGIN}/events/${id.split('/').pop()}`,
      type: 'Event',
      attributedTo: actor,
      name: `event ${id}`,
    },
  };
}

/**
 * Builds an OrderedCollectionPage for the stubbed outbox.
 *
 * `next` is optional — omit it on the terminal page so pagination ends.
 */
function buildPage(
  items: Record<string, unknown>[],
  next?: string,
): Record<string, unknown> {
  const page: Record<string, unknown> = {
    type: 'OrderedCollectionPage',
    orderedItems: items,
  };
  if (next) {
    page.next = next;
  }
  return page;
}

/**
 * Builds the stubbed source outbox: the actor profile, the collection, page 1
 * and, when `page2Items` is given, page 2. Page 1 links to page 2 whenever
 * page 2 exists; pass `page1Next` to link it elsewhere, or to a page the stub
 * does not serve.
 */
function buildOutbox(
  page1Items: Record<string, unknown>[],
  page2Items?: Record<string, unknown>[],
  page1Next: string | undefined = page2Items ? SOURCE_PAGE_2_URI : undefined,
): Record<string, Record<string, unknown>> {
  const responses: Record<string, Record<string, unknown>> = {
    [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
    [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
    [SOURCE_PAGE_1_URI]: buildPage(page1Items, page1Next),
  };
  if (page2Items) {
    responses[SOURCE_PAGE_2_URI] = buildPage(page2Items);
  }
  return responses;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FollowBackfillService.runBackfill (integration)', () => {
  let env: TestEnvironment;
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let calendarInterface: CalendarInterface;
  let activityPubInterface: ActivityPubInterface;
  let drainSpy: sinon.SinonStub;
  let rateLimiter: SyncRateLimiter;

  let followerCalendarId: string;
  let sourceCalendarActorId: string;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    backfillWarn.mockClear();

    // Real interfaces — the only thing replaced is `processInboxMessages`,
    // stubbed as a sentinel so a test can assert the service never drains.
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface();
    activityPubInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);

    drainSpy = sandbox.stub(activityPubInterface, 'processInboxMessages').resolves();

    rateLimiter = new SyncRateLimiter({ limit: 1000, windowMs: 60_000 });

    // Follower calendar (local).
    followerCalendarId = uuidv4();
    await CalendarEntity.create({
      id: followerCalendarId,
      url_name: 'follower',
      account_id: uuidv4(),
      languages: 'en',
    });

    // Source remote actor.
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

    // Following relationship: follower follows the source.
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: sourceCalendarActorId,
      calendar_id: followerCalendarId,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });
  });

  afterEach(async () => {
    sandbox.restore();
    // Per-test isolation: scrub the rows this test wrote rather than tearing
    // down the schema (TestEnvironment owns the schema lifecycle for the
    // describe block). Order matters: child rows that reference event/calendar/
    // calendar_actor are scrubbed before their parents to satisfy foreign-key
    // constraints.
    await RepostDismissalEntity.destroy({ where: {}, truncate: true });
    await SharedEventEntity.destroy({ where: {}, truncate: true });
    await EventActivityEntity.destroy({ where: {}, truncate: true });
    await EventObjectEntity.destroy({ where: {}, truncate: true });
    await ActivityPubInboxMessageEntity.destroy({ where: {}, truncate: true });
    await ActivityPubOutboxMessageEntity.destroy({ where: {}, truncate: true });
    await FollowingCalendarEntity.destroy({ where: {}, truncate: true });
    await EventEntity.destroy({ where: {}, truncate: true });
    await CalendarActorEntity.destroy({ where: {}, truncate: true });
    await CalendarEntity.destroy({ where: {}, truncate: true });
  });

  /**
   * Returns a fetcher stub keyed by URI. Any URI not in the map resolves
   * to null (which the worker treats as "drop and exit cleanly").
   */
  function makeFetcher(
    responses: Record<string, Record<string, unknown>>,
  ): sinon.SinonStub & typeof fetchRemoteObject {
    const stub = sandbox.stub<
      Parameters<typeof fetchRemoteObject>,
      ReturnType<typeof fetchRemoteObject>
    >();
    stub.callsFake(async (uri: string) => responses[uri] ?? null);
    return stub as sinon.SinonStub & typeof fetchRemoteObject;
  }

  /**
   * Runs the real inbox drain — the one the web process runs — bypassing the
   * sentinel stub on the interface.
   */
  async function drainInbox(): Promise<void> {
    await (activityPubInterface as unknown as { inboxService: ProcessInboxService })
      .inboxService.processInboxMessages();
  }

  function runService(opts: {
    fetcher: sinon.SinonStub & typeof fetchRemoteObject;
    now?: () => Date;
    maxBufferBytes?: number;
  }): FollowBackfillService {
    return new FollowBackfillService({
      activityPubInterface,
      calendarInterface,
      rateLimiter,
      fetcher: opts.fetcher,
      now: opts.now ?? (() => NOW),
      maxBufferBytes: opts.maxBufferBytes,
    });
  }

  /** The beforeEach follow: the follower calendar following the source actor. */
  function sourcePayload(): Parameters<FollowBackfillService['runBackfill']>[0] {
    return {
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    };
  }

  /**
   * Seeds a local copy of the remote event so the Announce handler finds it
   * without a fetch, and so a dismissal row has an event to reference.
   * Returns the local event id.
   */
  async function seedLocalEvent(eventApId: string): Promise<string> {
    const eventId = uuidv4();
    await EventEntity.create({ id: eventId, calendar_id: null });
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: SOURCE_ACTOR_URI,
    });
    return eventId;
  }

  /**
   * Runs the drain and asserts the Announce and its Undo both dispatched
   * cleanly and left no share behind. processed_time is set on error as well
   * as on success, so the status is what proves a clean dispatch.
   */
  async function expectDrainLeavesNoShare(announceId: string, undoId: string, eventApId: string): Promise<void> {
    await drainInbox();
    expect((await ActivityPubInboxMessageEntity.findByPk(announceId))?.processed_status).toBe('ok');
    expect((await ActivityPubInboxMessageEntity.findByPk(undoId))?.processed_status).toBe('ok');
    expect(await EventActivityEntity.count({
      where: { event_id: eventApId, type: 'share' },
    })).toBe(0);
  }

  // -------------------------------------------------------------------------
  // 1. Persistence shape
  // -------------------------------------------------------------------------

  it('persists each surviving activity with auth_source=outbox_pull, auth_origin=<source origin>, and a clamped message_time', async () => {
    const published1 = hoursBeforeNow(1); // recent — within clamp window
    const published2 = '2020-01-01T00:00:00Z'; // older than 2y — should be floored

    const fetcher = makeFetcher(buildOutbox([
      buildCreate(`${SOURCE_ORIGIN}/activities/a1`, published1),
      buildCreate(`${SOURCE_ORIGIN}/activities/a2`, published2),
    ]));

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    const rows = await ActivityPubInboxMessageEntity.findAll({
      where: { calendar_id: followerCalendarId },
      order: [['id', 'ASC']],
    });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.auth_source).toBe('outbox_pull');
      expect(row.auth_origin).toBe(SOURCE_ORIGIN);
      expect(row.type).toBe('Create');
      expect(row.calendar_id).toBe(followerCalendarId);
    }

    const row1 = rows.find(r => r.id.endsWith('a1'))!;
    expect(row1.message_time.toISOString()).toBe(new Date(published1).toISOString());

    // published2 is older than 2 years from `NOW`; clampMessageTime floors it
    // to `NOW - 2 years`. Exact ms equality is brittle, so assert the row is
    // pinned to the floor (not to the original 2020 timestamp).
    const row2 = rows.find(r => r.id.endsWith('a2'))!;
    const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
    expect(row2.message_time.getTime()).toBe(NOW.getTime() - TWO_YEARS_MS);
    expect(row2.message_time.getTime()).toBeGreaterThan(new Date(published2).getTime());
  });

  // -------------------------------------------------------------------------
  // 2. Trust-gate rejection
  // -------------------------------------------------------------------------

  it('rejects an activity whose object.attributedTo does not match the actor (trust gate)', async () => {
    const forgedActivityId = `${SOURCE_ORIGIN}/activities/forged`;
    const fetcher = makeFetcher(buildOutbox([
      {
        id: forgedActivityId,
        type: 'Create',
        actor: SOURCE_ACTOR_URI,
        published: '2026-05-16T11:00:00Z',
        object: {
          id: `${SOURCE_ORIGIN}/events/forged`,
          type: 'Event',
          // Forged attribution: the wrapping actor is the source, but the
          // object claims to be authored by a different identity. The
          // pre-write trust gate must drop this before any DB insert.
          attributedTo: `${SOURCE_ORIGIN}/users/someone-else`,
          name: 'forged event',
        },
      },
    ]));

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    const forgedRow = await ActivityPubInboxMessageEntity.findByPk(forgedActivityId);
    expect(forgedRow).toBeNull();
  });

  it('rejects an activity whose actor is on a different origin from the source actor (trust gate)', async () => {
    const foreignActivityId = `${SOURCE_ORIGIN}/activities/foreign`;
    const foreignActor = 'https://attacker.example/users/imposter';
    const fetcher = makeFetcher(buildOutbox([
      {
        id: foreignActivityId,
        type: 'Create',
        actor: foreignActor,
        published: '2026-05-16T11:00:00Z',
        object: {
          id: `${SOURCE_ORIGIN}/events/foreign`,
          type: 'Event',
          attributedTo: foreignActor,
          name: 'foreign-origin event',
        },
      },
    ]));

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    expect(await ActivityPubInboxMessageEntity.findByPk(foreignActivityId)).toBeNull();
  });

  it('skips an activity whose id is not on the source actor origin, leaving no row, and keeps writing the rest of the buffer', async () => {
    // A source outbox may not claim another host's activity id: the inbox is
    // first-writer-wins on id, so storing it would shadow that host's genuine
    // activity (e.g. a deterministic `{objectUrl}/delete`). The claimed id is
    // the older activity, so it is refused before the own one is written.
    const claimedId = 'https://other.example/events/elsewhere/delete';
    const ownId = `${SOURCE_ORIGIN}/activities/own`;
    const fetcher = makeFetcher(buildOutbox([
      buildCreate(ownId, '2026-05-16T11:00:00Z'),
      { id: claimedId, type: 'Delete', actor: SOURCE_ACTOR_URI, published: '2026-05-16T10:00:00Z', object: 'https://other.example/events/elsewhere' },
    ]));
    const enqueueSpy = sandbox.spy(activityPubInterface, 'enqueueInboxRow');

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    expect(enqueueSpy.getCalls().map(call => call.args[0].id)).toEqual([claimedId, ownId]);
    expect(await ActivityPubInboxMessageEntity.findByPk(claimedId)).toBeNull();
    expect(await ActivityPubInboxMessageEntity.findByPk(ownId)).not.toBeNull();
  });

  it('stops writing at the first failed write and rejects, so the written rows stay an oldest-first prefix', async () => {
    // A row skipped mid-buffer while later rows are written would let the
    // drain dispatch an Undo whose Announce is missing; the Announce written
    // by the retry would then find the Undo already processed and the share
    // would stick. So a failed write ends the run, and pg-boss re-walks it.
    const oldestId = `${SOURCE_ORIGIN}/activities/oldest-write`;
    const failingId = `${SOURCE_ORIGIN}/activities/failing-write`;
    const newestId = `${SOURCE_ORIGIN}/activities/newest-write`;
    const fetcher = makeFetcher(buildOutbox([
      buildCreate(newestId, '2026-04-03T00:00:00Z'),
      buildCreate(failingId, '2026-04-02T00:00:00Z'),
      buildCreate(oldestId, '2026-04-01T00:00:00Z'),
    ]));
    const writeError = new Error('connection terminated unexpectedly');
    const enqueueStub = sandbox.stub(activityPubInterface, 'enqueueInboxRow').callThrough();
    enqueueStub.onSecondCall().rejects(writeError);

    const service = runService({ fetcher });
    await expect(service.runBackfill(sourcePayload())).rejects.toBe(writeError);

    expect(enqueueStub.getCalls().map(call => call.args[0].id)).toEqual([oldestId, failingId]);
    const persistedIds = (await ActivityPubInboxMessageEntity.findAll({
      where: { calendar_id: followerCalendarId },
    })).map(r => r.id);
    expect(persistedIds).toEqual([oldestId]);
  });

  // -------------------------------------------------------------------------
  // 3. Write ordering, and no drain
  // -------------------------------------------------------------------------

  it('writes the whole walk oldest first, by clamped message_time, once the walk ends, and never drains the inbox itself', async () => {
    // The outbox is newest first across pages, and each page is shuffled
    // within itself, so neither walk order nor page order is chronological.
    const fetcher = makeFetcher(buildOutbox(
      [
        buildCreate(`${SOURCE_ORIGIN}/activities/third`, '2026-04-03T00:00:00Z'),
        buildCreate(`${SOURCE_ORIGIN}/activities/fourth`, '2026-04-05T00:00:00Z'),
      ],
      [
        buildCreate(`${SOURCE_ORIGIN}/activities/second`, '2026-04-02T00:00:00Z'),
        buildCreate(`${SOURCE_ORIGIN}/activities/first`, '2026-04-01T00:00:00Z'),
      ],
    ));
    const enqueueSpy = sandbox.spy(activityPubInterface, 'enqueueInboxRow');

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    expect(drainSpy.callCount).toBe(0);

    // Insertion order is the call order on the writer.
    const writes = enqueueSpy.getCalls().map(call => call.args[0]);
    expect(writes.map(w => w.id)).toEqual([
      `${SOURCE_ORIGIN}/activities/first`,
      `${SOURCE_ORIGIN}/activities/second`,
      `${SOURCE_ORIGIN}/activities/third`,
      `${SOURCE_ORIGIN}/activities/fourth`,
    ]);
    for (let i = 1; i < writes.length; i++) {
      expect(writes[i].messageTime.getTime()).toBeGreaterThan(writes[i - 1].messageTime.getTime());
    }
    expect(await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    })).toBe(4);
  });

  // -------------------------------------------------------------------------
  // 4. A drain that runs mid-walk sees none of the walk, and an Undo is never
  //    written before its Announce
  // -------------------------------------------------------------------------

  it('leaves nothing for a mid-walk drain to dispatch, so an Undo never runs before its Announce', async () => {
    // Page 1 (newer) holds Undo(Announce X); page 2 (older) holds Announce X.
    // A drain that dispatched the Undo before the Announce was written would
    // find no Announce to undo, and the Announce dispatched later would leave
    // a share that sticks.
    const eventApId = `${SOURCE_ORIGIN}/events/mid-walk`;
    const announceId = `${SOURCE_ORIGIN}/activities/announce-mid-walk`;
    const undoId = `${SOURCE_ORIGIN}/activities/undo-mid-walk`;

    // Local copy of X so the Announce handler does not fetch it.
    await seedLocalEvent(eventApId);

    const pages = buildOutbox(
      [{ id: undoId, type: 'Undo', actor: SOURCE_ACTOR_URI, published: hoursBeforeNow(25), object: announceId }],
      [{ id: announceId, type: 'Announce', actor: SOURCE_ACTOR_URI, published: hoursBeforeNow(26), object: eventApId }],
    );

    let rowsSeenByMidWalkDrain: number | null = null;
    const fetcher = makeFetcher({});
    fetcher.callsFake(async (uri: string) => {
      if (uri === SOURCE_PAGE_2_URI) {
        // The web process drains while the worker is still walking.
        rowsSeenByMidWalkDrain = await ActivityPubInboxMessageEntity.count({
          where: { calendar_id: followerCalendarId },
        });
        await drainInbox();
      }
      return pages[uri] ?? null;
    });

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    expect(rowsSeenByMidWalkDrain).toBe(0);

    // The next drain after the walk dispatches the Announce, then its Undo.
    await expectDrainLeavesNoShare(announceId, undoId, eventApId);
  });

  it('clamps every activity against one clock reading per run, so a floored Announce is still written before its floored Undo', async () => {
    // Both activities are older than two years, so both floor to now - 2y.
    // The clock advances on every call: if each activity were clamped against
    // its own reading, the Undo (walked first) would get the earlier floor and
    // be written, and dispatched, before its Announce, leaving a stuck share.
    const eventApId = `${SOURCE_ORIGIN}/events/floored`;
    const announceId = `${SOURCE_ORIGIN}/activities/announce-floored`;
    const undoId = `${SOURCE_ORIGIN}/activities/undo-floored`;

    // Local copy of X so the Announce handler does not fetch it.
    await seedLocalEvent(eventApId);

    const fetcher = makeFetcher(buildOutbox(
      [{ id: undoId, type: 'Undo', actor: SOURCE_ACTOR_URI, published: '2020-01-02T00:00:00Z', object: announceId }],
      [{ id: announceId, type: 'Announce', actor: SOURCE_ACTOR_URI, published: '2020-01-01T00:00:00Z', object: eventApId }],
    ));
    const enqueueSpy = sandbox.spy(activityPubInterface, 'enqueueInboxRow');

    let tick = 0;
    const advancingNow = () => new Date(NOW.getTime() + (tick++) * 1000);

    const service = runService({ fetcher, now: advancingNow });
    await service.runBackfill(sourcePayload());

    const writes = enqueueSpy.getCalls().map(call => call.args[0]);
    expect(writes.map(w => w.id)).toEqual([announceId, undoId]);

    await expectDrainLeavesNoShare(announceId, undoId, eventApId);
  });

  it('writes a floored Announce before its floored Undo when the peer serves its outbox oldest first', async () => {
    // Both activities are older than two years, so both floor to the same
    // clamped message_time. The page lists the Announce first, so reversing
    // the walk order alone would write, and dispatch, the Undo first.
    const eventApId = `${SOURCE_ORIGIN}/events/oldest-first`;
    const announceId = `${SOURCE_ORIGIN}/activities/announce-oldest-first`;
    const undoId = `${SOURCE_ORIGIN}/activities/undo-oldest-first`;

    // Local copy of X so the Announce handler does not fetch it.
    await seedLocalEvent(eventApId);

    const fetcher = makeFetcher(buildOutbox([
      { id: announceId, type: 'Announce', actor: SOURCE_ACTOR_URI, published: '2020-01-01T00:00:00Z', object: eventApId },
      { id: undoId, type: 'Undo', actor: SOURCE_ACTOR_URI, published: '2020-01-02T00:00:00Z', object: announceId },
    ]));
    const enqueueSpy = sandbox.spy(activityPubInterface, 'enqueueInboxRow');

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    const writes = enqueueSpy.getCalls().map(call => call.args[0]);
    expect(writes[0].messageTime.getTime()).toBe(writes[1].messageTime.getTime());
    expect(writes.map(w => w.id)).toEqual([announceId, undoId]);

    await expectDrainLeavesNoShare(announceId, undoId, eventApId);
  });

  // -------------------------------------------------------------------------
  // 5. Idempotency
  // -------------------------------------------------------------------------

  it('produces no duplicate rows when runBackfill is invoked twice over the same source', async () => {
    const fetcher = makeFetcher(buildOutbox([
      buildCreate(`${SOURCE_ORIGIN}/activities/dup1`, '2026-04-01T00:00:00Z'),
      buildCreate(`${SOURCE_ORIGIN}/activities/dup2`, '2026-04-02T00:00:00Z'),
    ]));

    const service = runService({ fetcher });
    const payload = sourcePayload();
    await service.runBackfill(payload);
    await service.runBackfill(payload);

    const total = await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    });
    expect(total).toBe(2);

    // Per-id uniqueness, which is the property `findOrCreate` actually
    // enforces — count() above already proves it, but assert per-id too so
    // a regression that swaps to bulk upsert is caught.
    expect(await ActivityPubInboxMessageEntity.count({
      where: { id: `${SOURCE_ORIGIN}/activities/dup1` },
    })).toBe(1);
    expect(await ActivityPubInboxMessageEntity.count({
      where: { id: `${SOURCE_ORIGIN}/activities/dup2` },
    })).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6. First-writer-wins race against an HTTP-signed copy of the same activity
  // -------------------------------------------------------------------------

  it('preserves the existing row (first writer wins) when a live HTTP-signed copy already exists', async () => {
    const sharedActivityId = `${SOURCE_ORIGIN}/activities/race`;
    const httpSignedTime = new Date('2026-05-15T08:00:00Z');

    // Live HTTP-signed copy lands first.
    await ActivityPubInboxMessageEntity.create({
      id: sharedActivityId,
      calendar_id: followerCalendarId,
      type: 'Create',
      message_time: httpSignedTime,
      message: {
        id: sharedActivityId,
        type: 'Create',
        actor: SOURCE_ACTOR_URI,
        published: httpSignedTime.toISOString(),
        object: {
          id: `${SOURCE_ORIGIN}/events/race`,
          type: 'Event',
          attributedTo: SOURCE_ACTOR_URI,
          name: 'live-signed',
        },
      },
      auth_source: 'http_signature',
      auth_origin: SOURCE_ORIGIN,
    });

    // Backfill then encounters the same activity id with a *different*
    // published timestamp. Backfill uses `findOrCreate` with no upgrade on
    // conflict, so the existing row must remain.
    const backfillPublished = '2026-05-16T11:00:00Z';
    const fetcher = makeFetcher(buildOutbox([buildCreate(sharedActivityId, backfillPublished)]));

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    const rows = await ActivityPubInboxMessageEntity.findAll({
      where: { id: sharedActivityId },
    });
    expect(rows).toHaveLength(1);
    // The original HTTP-signature breadcrumb is preserved — backfill did not
    // overwrite the auth columns.
    expect(rows[0].auth_source).toBe('http_signature');
    expect(rows[0].auth_origin).toBe(SOURCE_ORIGIN);
    expect(rows[0].message_time.toISOString()).toBe(httpSignedTime.toISOString());
  });

  // -------------------------------------------------------------------------
  // 7. No inboxMessageAdded emission on the backfill path
  // -------------------------------------------------------------------------

  it('does not emit `inboxMessageAdded` when persisting backfill rows', async () => {
    const fetcher = makeFetcher(buildOutbox([
      buildCreate(`${SOURCE_ORIGIN}/activities/silent`, '2026-05-15T00:00:00Z'),
    ]));

    const inboxMessageAddedSpy = sandbox.spy();
    eventBus.on('inboxMessageAdded', inboxMessageAddedSpy);

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    // The row landed but no event fired — proving the worker uses the
    // deferred `enqueueInboxRow` entry point rather than the emitting
    // `addToInbox`.
    expect(await ActivityPubInboxMessageEntity.count({
      where: { id: `${SOURCE_ORIGIN}/activities/silent` },
    })).toBe(1);
    expect(inboxMessageAddedSpy.called).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. SSRF rejection on a private source actor URI
  // -------------------------------------------------------------------------

  it('aborts cleanly without persisting any rows when the source actor URI resolves to a private IP literal', async () => {
    const privateSourceActorUri = 'https://10.0.0.1/calendars/source';

    // Re-seed a follow row keyed to the private-source actor. The existing
    // beforeEach actor is keyed to `source.example`, so the worker would
    // never reach the URL-validation step without this row.
    const privateActorId = uuidv4();
    await CalendarActorEntity.create({
      id: privateActorId,
      actor_type: 'remote',
      actor_uri: privateSourceActorUri,
      remote_display_name: null,
      remote_domain: '10.0.0.1',
      calendar_id: null,
      private_key: null,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: privateActorId,
      calendar_id: followerCalendarId,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });

    // Any fetch the worker DOES manage to invoke must fail loudly so the
    // test catches a regression that bypasses the SSRF gate.
    const fetcher = makeFetcher({});

    const service = runService({ fetcher });
    await service.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: privateActorId,
      sourceActorUri: privateSourceActorUri,
    });

    expect(fetcher.callCount).toBe(0);
    expect(await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 9. DEC-008 sticky per-calendar unpost dismissal scoping
  // -------------------------------------------------------------------------
  //
  // Backfill walks an Announce + later Undo(Announce) for the same event.
  // Two followers (F and G) consume identical activity sequences from the
  // same source. F has a pre-existing RepostDismissalEntity for the event;
  // G does not. After the inbox drains, F has no SharedEventEntity
  // (the dismissal suppressed share creation inside checkAndPerformAutoRepost),
  // while G has one (the dismissal is calendar-scoped — it does not leak
  // across to G's share). This is the DEC-008 per-calendar scoping invariant.
  //
  // The Announce inbox row's id is the activity's globally-unique AP id, so
  // F and G cannot share a single backfilled row — each follower receives
  // its own Announce activity id wrapping the same underlying event AP id.
  // The activity-id divergence is plumbing; the dismissal-scoping invariant
  // is independent of it.

  it('respects DEC-008 per-calendar dismissal scoping during backfill (F suppressed; G unaffected)', async () => {
    // The strict Undo cross-check (pv-wy2u.3.1) and the DEC-008 dismissal
    // guard both live in ProcessInboxService. Backfill only writes rows, so
    // this test drives the dispatch pipeline directly via
    // `processInboxMessage` (singular) on each persisted row in
    // `message_time` ASC order, which is the same ordering the production
    // drain uses.

    const eventApId = `${SOURCE_ORIGIN}/events/dismissal-scoping`;
    const announceFId = `${SOURCE_ORIGIN}/activities/announce-f`;
    const undoFId = `${SOURCE_ORIGIN}/activities/undo-f`;
    const announceGId = `${SOURCE_ORIGIN}/activities/announce-g`;
    const undoGId = `${SOURCE_ORIGIN}/activities/undo-g`;

    // Pre-create the underlying local event row so processShareEvent's
    // EventObjectEntity lookup hits and skips the remote fetch path, and
    // so the RepostDismissalEntity FK to event has a valid target.
    const eventId = await seedLocalEvent(eventApId);

    // Second follower (G) — a separate local calendar with its own follow
    // row pointing at the same source actor. The beforeEach already wired
    // F's calendar + follow row; here we add G and override F's follow row
    // to enable auto-repost on originals (the Announce path needs the
    // policy enabled before checkAndPerformAutoRepost reaches the
    // dismissal guard).
    const followerGCalendarId = uuidv4();
    await CalendarEntity.create({
      id: followerGCalendarId,
      url_name: 'follower-g',
      account_id: uuidv4(),
      languages: 'en',
    });
    await FollowingCalendarEntity.update(
      { auto_repost_originals: true },
      { where: { calendar_id: followerCalendarId, calendar_actor_id: sourceCalendarActorId } },
    );
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: sourceCalendarActorId,
      calendar_id: followerGCalendarId,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    // Seed the per-calendar dismissal for F only — this is the DEC-008
    // signal that F has previously unposted this event and must not have
    // it auto-reposted on its calendar. (Sanity-checked locally: removing
    // this seed flips the F-shares assertion from 0 to 1, confirming the
    // dismissal is the load-bearing signal under test.)
    await RepostDismissalEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: followerCalendarId,
    });

    // Build a single shared fetcher whose page yields all four activities;
    // each follower's backfill will type-filter and persist only the
    // activities whose actor/id pass its trust gates. Because Announce
    // activity ids are globally unique, F's and G's inbox rows are
    // distinct — same event, different wrapper activity ids.
    const announceF = {
      id: announceFId,
      type: 'Announce',
      actor: SOURCE_ACTOR_URI,
      published: '2026-05-15T10:00:00Z',
      object: eventApId,
    };
    const undoF = {
      id: undoFId,
      type: 'Undo',
      actor: SOURCE_ACTOR_URI,
      published: '2026-05-15T11:00:00Z',
      object: announceFId,
    };
    const announceG = {
      id: announceGId,
      type: 'Announce',
      actor: SOURCE_ACTOR_URI,
      published: '2026-05-15T10:00:00Z',
      object: eventApId,
    };
    const undoG = {
      id: undoGId,
      type: 'Undo',
      actor: SOURCE_ACTOR_URI,
      published: '2026-05-15T11:00:00Z',
      object: announceGId,
    };

    // Run F's backfill against an outbox that emits only F's
    // Announce/Undo pair. Then run G's backfill against an outbox that
    // emits only G's pair. Each run persists its own pair into ap_inbox
    // (PK is the activity id, which differs); the drain below dispatches
    // them through the real ProcessInboxService.
    const fetcherF = makeFetcher(buildOutbox([announceF, undoF]));
    const serviceF = runService({ fetcher: fetcherF });
    await serviceF.runBackfill(sourcePayload());

    const fetcherG = makeFetcher(buildOutbox([announceG, undoG]));
    const serviceG = runService({ fetcher: fetcherG });
    await serviceG.runBackfill({ ...sourcePayload(), followingCalendarId: followerGCalendarId });

    // Drain the inbox rows in message_time ASC order — same property the
    // production drain query relies on, exercised here per-row through
    // `processInboxMessage` (singular). This goes through the full inbox
    // dispatch pipeline (blocked-instance gate, relationship gate, per-type
    // handlers) so the dismissal guard, strict Undo cross-check, and
    // EventActivityEntity bookkeeping all execute as they would on the
    // production path.
    const pendingRows = await ActivityPubInboxMessageEntity.findAll({
      order: [['message_time', 'ASC']],
    });
    for (const row of pendingRows) {
      await (activityPubInterface as unknown as { inboxService: ProcessInboxService })
        .inboxService.processInboxMessage(row);
    }

    // -------- F: dismissal must have suppressed share creation --------
    const fShares = await SharedEventEntity.findAll({
      where: { event_id: eventId, calendar_id: followerCalendarId },
    });
    expect(fShares).toHaveLength(0);

    // -------- G: identical incoming sequence, no dismissal, share row persists --------
    // checkAndPerformAutoRepost created SharedEventEntity on the Announce.
    // The subsequent Undo runs processUnshareEvent, which destroys the
    // EventActivityEntity row for the source actor but does NOT touch
    // SharedEventEntity (the local reposter's record of its own repost).
    // The SharedEventEntity row is therefore the right invariant to assert.
    const gShares = await SharedEventEntity.findAll({
      where: { event_id: eventId, calendar_id: followerGCalendarId },
    });
    expect(gShares).toHaveLength(1);
    expect(gShares[0].auto_posted).toBe(true);

    // Belt-and-suspenders: the dismissal row is untouched (the suppression
    // path does not consume the row — it stays sticky for future Announces).
    const remainingDismissals = await RepostDismissalEntity.count({
      where: { event_id: eventId, calendar_id: followerCalendarId },
    });
    expect(remainingDismissals).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 10. Rate-limit pause + retryable resume
  // -------------------------------------------------------------------------
  //
  // A single job needs only ~53 requests, so it never self-exhausts the
  // 60/min budget — exhaustion comes from contention with other jobs against
  // the same host. These tests model that by pre-consuming all but three of
  // the host's slots before the walk starts: the walk spends those three on
  // the actor profile, the outbox collection, and the first page, then the
  // page-2 fetch is denied and the run pauses.

  it('writes nothing and throws BackfillRateLimitError when the per-host budget is exhausted mid-walk', async () => {
    const host = new URL(SOURCE_ACTOR_URI).hostname;
    rateLimiter = new SyncRateLimiter({ limit: 60, windowMs: 60_000 });
    for (let i = 0; i < 57; i++) {
      rateLimiter.tryAcquire(host);
    }

    const fetcher = makeFetcher(buildOutbox(
      [buildCreate(`${SOURCE_ORIGIN}/activities/p1`, '2026-04-01T00:00:00Z')],
      [buildCreate(`${SOURCE_ORIGIN}/activities/p2`, '2026-04-02T00:00:00Z')],
    ));

    const service = runService({ fetcher });
    await expect(service.runBackfill(sourcePayload())).rejects.toBeInstanceOf(BackfillRateLimitError);

    // Page 1 was walked but its buffered rows were discarded: a partial,
    // newest-first walk must never reach the inbox. Page 2 was never fetched.
    expect(fetcher.calledWith(SOURCE_PAGE_1_URI)).toBe(true);
    expect(fetcher.calledWith(SOURCE_PAGE_2_URI)).toBe(false);
    expect(await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    })).toBe(0);
    expect(drainSpy.callCount).toBe(0);
  });

  it('re-walks the outbox from the first page on a subsequent run after the rate window resets (pg-boss retry)', async () => {
    const host = new URL(SOURCE_ACTOR_URI).hostname;
    rateLimiter = new SyncRateLimiter({ limit: 60, windowMs: 60_000 });
    for (let i = 0; i < 57; i++) {
      rateLimiter.tryAcquire(host);
    }

    const fetcher = makeFetcher(buildOutbox(
      [buildCreate(`${SOURCE_ORIGIN}/activities/p1`, '2026-04-01T00:00:00Z')],
      [buildCreate(`${SOURCE_ORIGIN}/activities/p2`, '2026-04-02T00:00:00Z')],
    ));

    const payload = sourcePayload();
    const service = runService({ fetcher });

    // First attempt pauses after page 1 and writes nothing.
    await expect(service.runBackfill(payload)).rejects.toBeInstanceOf(BackfillRateLimitError);
    expect(await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    })).toBe(0);

    // The pg-boss retry runs after the sliding window has reset, modelled here
    // by clearing the limiter. The re-walk starts from page 1 again and, with
    // the budget available, walks to the end and writes both pages.
    rateLimiter.reset();
    await service.runBackfill(payload);

    expect(await ActivityPubInboxMessageEntity.count({
      where: { id: `${SOURCE_ORIGIN}/activities/p1` },
    })).toBe(1);
    expect(await ActivityPubInboxMessageEntity.count({
      where: { id: `${SOURCE_ORIGIN}/activities/p2` },
    })).toBe(1);
    expect(await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    })).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 11. Unfollow mid-walk
  // -------------------------------------------------------------------------

  it('writes nothing when the follow row is removed during the walk', async () => {
    const pages = buildOutbox(
      [buildCreate(`${SOURCE_ORIGIN}/activities/p1`, '2026-04-01T00:00:00Z')],
      [buildCreate(`${SOURCE_ORIGIN}/activities/p2`, '2026-04-02T00:00:00Z')],
    );
    const fetcher = makeFetcher({});
    fetcher.callsFake(async (uri: string) => {
      if (uri === SOURCE_PAGE_1_URI) {
        // The user unfollows while page 1 is in flight; the page-boundary
        // re-check after page 1 sees the row gone.
        await FollowingCalendarEntity.destroy({
          where: { calendar_id: followerCalendarId, calendar_actor_id: sourceCalendarActorId },
        });
      }
      return pages[uri] ?? null;
    });

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    expect(fetcher.calledWith(SOURCE_PAGE_2_URI)).toBe(false);
    expect(await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    })).toBe(0);
  });

  it('writes nothing when the follow row is removed after the last page has been walked', async () => {
    // Page 1 passes its page-boundary re-check; the user unfollows while the
    // next page is in flight, and that page turns out to be unreachable. The
    // walk ends normally with page 1 buffered, so only the re-check
    // immediately before the write can see the row is gone.
    const pages = buildOutbox(
      [buildCreate(`${SOURCE_ORIGIN}/activities/p1`, '2026-04-01T00:00:00Z')],
      undefined,
      SOURCE_PAGE_2_URI,
    );
    const fetcher = makeFetcher({});
    fetcher.callsFake(async (uri: string) => {
      if (uri === SOURCE_PAGE_2_URI) {
        await FollowingCalendarEntity.destroy({
          where: { calendar_id: followerCalendarId, calendar_actor_id: sourceCalendarActorId },
        });
      }
      return pages[uri] ?? null;
    });
    const enqueueSpy = sandbox.spy(activityPubInterface, 'enqueueInboxRow');

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    expect(fetcher.calledWith(SOURCE_PAGE_2_URI)).toBe(true);
    expect(enqueueSpy.callCount).toBe(0);
    expect(await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 12. A walk that ends on a refused or unreachable next page is a normal end
  // -------------------------------------------------------------------------

  it.each([
    ['refused by the SSRF check', 'https://10.0.0.1/calendars/source/outbox?page=2', false],
    ['unreachable', SOURCE_PAGE_2_URI, true],
  ])('writes the walked pages when the next page URL is %s', async (_label, nextUrl, expectFetched) => {
    // The stub serves no page 2, so an unreachable next page resolves to null.
    const fetcher = makeFetcher(buildOutbox(
      [
        buildCreate(`${SOURCE_ORIGIN}/activities/p1b`, '2026-04-02T00:00:00Z'),
        buildCreate(`${SOURCE_ORIGIN}/activities/p1a`, '2026-04-01T00:00:00Z'),
      ],
      undefined,
      nextUrl,
    ));

    const service = runService({ fetcher });
    await service.runBackfill(sourcePayload());

    // A refused URL never reaches the fetcher; an unreachable one does.
    expect(fetcher.calledWith(nextUrl)).toBe(expectFetched);

    const persistedIds = (await ActivityPubInboxMessageEntity.findAll({
      where: { calendar_id: followerCalendarId },
      order: [['id', 'ASC']],
    })).map(r => r.id);
    expect(persistedIds).toEqual([
      `${SOURCE_ORIGIN}/activities/p1a`,
      `${SOURCE_ORIGIN}/activities/p1b`,
    ]);
  });

  // -------------------------------------------------------------------------
  // 13. Buffer byte cap
  // -------------------------------------------------------------------------

  it('stops the walk at the buffer byte cap and writes what it buffered, oldest first', async () => {
    // Walk order is newest first. With the cap set to exactly the first two
    // activities' serialized size, the third does not fit: it is not
    // buffered, and page 2 is never fetched.
    const newest = buildCreate(`${SOURCE_ORIGIN}/activities/newest`, '2026-04-03T00:00:00Z');
    const middle = buildCreate(`${SOURCE_ORIGIN}/activities/middle`, '2026-04-02T00:00:00Z');
    const oldest = buildCreate(`${SOURCE_ORIGIN}/activities/oldest`, '2026-04-01T00:00:00Z');
    const cap = JSON.stringify(newest).length + JSON.stringify(middle).length;

    const fetcher = makeFetcher(buildOutbox(
      [newest, middle, oldest],
      [buildCreate(`${SOURCE_ORIGIN}/activities/page-2`, '2026-03-01T00:00:00Z')],
    ));
    const enqueueSpy = sandbox.spy(activityPubInterface, 'enqueueInboxRow');

    const service = runService({ fetcher, maxBufferBytes: cap });
    await service.runBackfill(sourcePayload());

    expect(fetcher.calledWith(SOURCE_PAGE_2_URI)).toBe(false);

    const writes = enqueueSpy.getCalls().map(call => call.args[0]);
    expect(writes.map(w => w.id)).toEqual([
      `${SOURCE_ORIGIN}/activities/middle`,
      `${SOURCE_ORIGIN}/activities/newest`,
    ]);
    expect(writes[1].messageTime.getTime()).toBeGreaterThan(writes[0].messageTime.getTime());
    expect(await ActivityPubInboxMessageEntity.count({
      where: { calendar_id: followerCalendarId },
    })).toBe(2);

    const capWarnings = backfillWarn.mock.calls.filter(([, msg]) => msg === 'backfill truncated at buffer cap');
    expect(capWarnings).toHaveLength(1);
    expect(capWarnings[0][0]).toEqual({
      followingCalendarId: followerCalendarId,
      sourceActorUri: SOURCE_ACTOR_URI,
      bufferedBytes: cap,
      cap,
    });
  });

  it('leaves no share when the cap keeps an Undo but cuts off its Announce', async () => {
    // Newest first: the Undo fits the cap exactly and the older Announce it
    // references does not. The Undo is written alone and changes nothing at
    // dispatch, so no share is created and none can stick.
    const eventApId = `${SOURCE_ORIGIN}/events/cut-off`;
    const announceId = `${SOURCE_ORIGIN}/activities/announce-cut-off`;
    const undoId = `${SOURCE_ORIGIN}/activities/undo-cut-off`;

    // Local copy of X so an Announce that did get written would dispatch
    // without a fetch.
    await seedLocalEvent(eventApId);

    const undo = { id: undoId, type: 'Undo', actor: SOURCE_ACTOR_URI, published: hoursBeforeNow(25), object: announceId };
    const announce = { id: announceId, type: 'Announce', actor: SOURCE_ACTOR_URI, published: hoursBeforeNow(26), object: eventApId };
    const fetcher = makeFetcher(buildOutbox([undo, announce]));

    const service = runService({ fetcher, maxBufferBytes: JSON.stringify(undo).length });
    await service.runBackfill(sourcePayload());
    await drainInbox();

    // The Undo's target is not in the inbox, so dispatch ends it as an error
    // ('Undo target not found') with no state change.
    expect(await ActivityPubInboxMessageEntity.findByPk(announceId)).toBeNull();
    expect((await ActivityPubInboxMessageEntity.findByPk(undoId))?.processed_status).toBe('error');
    expect(await EventActivityEntity.count({
      where: { event_id: eventApId, type: 'share' },
    })).toBe(0);
  });

  it('does not count activities rejected by the trust gates, or with no id, toward the cap', async () => {
    // Walk order puts the gate-rejected and id-less activities first. The cap
    // holds exactly the two valid ones, so if either dropped activity were
    // counted, the older valid activity would not fit.
    const forged = {
      id: `${SOURCE_ORIGIN}/activities/forged-cap`,
      type: 'Create',
      actor: 'https://attacker.example/users/imposter',
      published: '2026-04-05T00:00:00Z',
      object: { id: 'https://attacker.example/events/x', type: 'Event', attributedTo: 'https://attacker.example/users/imposter' },
    };
    const noId = buildCreate(`${SOURCE_ORIGIN}/activities/no-id`, '2026-04-04T00:00:00Z');
    delete noId.id;
    const newer = buildCreate(`${SOURCE_ORIGIN}/activities/valid-newer`, '2026-04-02T00:00:00Z');
    const older = buildCreate(`${SOURCE_ORIGIN}/activities/valid-older`, '2026-04-01T00:00:00Z');
    const cap = JSON.stringify(newer).length + JSON.stringify(older).length;

    const fetcher = makeFetcher(buildOutbox([forged, noId, newer, older]));

    const service = runService({ fetcher, maxBufferBytes: cap });
    await service.runBackfill(sourcePayload());

    const persistedIds = (await ActivityPubInboxMessageEntity.findAll({
      where: { calendar_id: followerCalendarId },
      order: [['id', 'ASC']],
    })).map(r => r.id);
    expect(persistedIds).toEqual([
      `${SOURCE_ORIGIN}/activities/valid-newer`,
      `${SOURCE_ORIGIN}/activities/valid-older`,
    ]);
    expect(backfillWarn.mock.calls.some(([, msg]) => msg === 'backfill truncated at buffer cap')).toBe(false);
  });
});

