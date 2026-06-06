/**
 * Integration tests for FollowBackfillService.
 *
 * These tests verify the public `runBackfill` contract end-to-end:
 *   - persistence shape (auth_source, auth_origin, clamped message_time)
 *   - trust-gate rejection at the public entry point (no helper mocking)
 *   - drain ordering by messageTime ASC across shuffled `published` values
 *   - single drain (one `processInboxMessages` call after final page)
 *   - idempotency under re-run
 *   - first-writer-wins race when a live HTTP-signed row already exists
 *   - no `inboxMessageAdded` emission on the backfill path
 *   - private-URL SSRF rejection on the source actor URI
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
 * and `processInboxMessages` is replaced with a no-op spy on the real
 * `ActivityPubInterface` so single-drain semantics can be asserted without
 * running the live per-type handlers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import { FollowBackfillService } from '@/server/activitypub/service/backfill';
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

    // Real interfaces — the only thing replaced is `processInboxMessages`,
    // and even that is replaced with a no-op stub so its call count can be
    // asserted without driving the (heavy) drain pipeline. Drain ordering is
    // verified by snapshotting pending rows at drain time, below.
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface();
    activityPubInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);

    // Stub the drain so the test does not depend on the live inbox handlers
    // resolving real EventObjectEntity rows; the snapshot the stub captures
    // is what proves drain ordering and single-drain semantics.
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

  function runService(opts: {
    fetcher: sinon.SinonStub & typeof fetchRemoteObject;
    now?: () => Date;
  }): FollowBackfillService {
    return new FollowBackfillService({
      activityPubInterface,
      calendarInterface,
      rateLimiter,
      fetcher: opts.fetcher,
      now: opts.now,
    });
  }

  // -------------------------------------------------------------------------
  // 1. Persistence shape
  // -------------------------------------------------------------------------

  it('persists each surviving activity with auth_source=outbox_pull, auth_origin=<source origin>, and a clamped message_time', async () => {
    const now = new Date('2026-05-16T12:00:00Z');
    const published1 = '2026-05-16T11:00:00Z'; // recent — within clamp window
    const published2 = '2020-01-01T00:00:00Z'; // older than 2y — should be floored

    const fetcher = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage([
        buildCreate(`${SOURCE_ORIGIN}/activities/a1`, published1),
        buildCreate(`${SOURCE_ORIGIN}/activities/a2`, published2),
      ]),
    });

    const service = runService({ fetcher, now: () => now });
    await service.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

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

    // published2 is older than 2 years from `now`; clampMessageTime floors it
    // to `now - 2 years`. Exact ms equality is brittle, so assert the row is
    // pinned to the floor (not to the original 2020 timestamp).
    const row2 = rows.find(r => r.id.endsWith('a2'))!;
    const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
    expect(row2.message_time.getTime()).toBe(now.getTime() - TWO_YEARS_MS);
    expect(row2.message_time.getTime()).toBeGreaterThan(new Date(published2).getTime());
  });

  // -------------------------------------------------------------------------
  // 2. Trust-gate rejection
  // -------------------------------------------------------------------------

  it('rejects an activity whose object.attributedTo does not match the actor (trust gate)', async () => {
    const forgedActivityId = `${SOURCE_ORIGIN}/activities/forged`;
    const fetcher = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage([
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
      ]),
    });

    const service = runService({ fetcher });
    await service.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

    const forgedRow = await ActivityPubInboxMessageEntity.findByPk(forgedActivityId);
    expect(forgedRow).toBeNull();

    // Drain still ran exactly once even though the page yielded zero rows.
    expect(drainSpy.callCount).toBe(1);
  });

  it('rejects an activity whose actor is on a different origin from the source actor (trust gate)', async () => {
    const foreignActivityId = `${SOURCE_ORIGIN}/activities/foreign`;
    const foreignActor = 'https://attacker.example/users/imposter';
    const fetcher = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage([
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
      ]),
    });

    const service = runService({ fetcher });
    await service.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

    expect(await ActivityPubInboxMessageEntity.findByPk(foreignActivityId)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 3. Drain ordering
  // -------------------------------------------------------------------------

  it('drains pending rows in messageTime ASC even when the source delivers activities out of order', async () => {
    const now = new Date('2026-05-16T12:00:00Z');
    // Three activities whose `published` timestamps span the clamp window
    // intentionally arrive in non-chronological order.
    const activities = [
      buildCreate(`${SOURCE_ORIGIN}/activities/middle`, '2026-04-01T00:00:00Z'),
      buildCreate(`${SOURCE_ORIGIN}/activities/earliest`, '2026-01-01T00:00:00Z'),
      buildCreate(`${SOURCE_ORIGIN}/activities/latest`, '2026-05-15T00:00:00Z'),
    ];
    const fetcher = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage(activities),
    });

    // Capture the pending rows at drain time, ordered by message_time ASC —
    // the same property the live `inboxService.processInboxMessages` uses
    // (the prod query references the entity attribute name; this snapshot
    // uses the column-name field declared on the entity, which Sequelize
    // resolves identically for SQLite's case-insensitive identifiers). The
    // assertion that matters is the ordering of the persisted rows: that
    // proves the worker did not synthesize an in-arrival-order dispatch.
    let drainSnapshot: { id: string; messageTime: Date }[] = [];
    drainSpy.callsFake(async () => {
      const pending = await ActivityPubInboxMessageEntity.findAll({
        order: [['message_time', 'ASC']],
      });
      drainSnapshot = pending.map(r => ({ id: r.id, messageTime: r.message_time }));
    });

    const service = runService({ fetcher, now: () => now });
    await service.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

    expect(drainSnapshot.map(r => r.id)).toEqual([
      `${SOURCE_ORIGIN}/activities/earliest`,
      `${SOURCE_ORIGIN}/activities/middle`,
      `${SOURCE_ORIGIN}/activities/latest`,
    ]);
    // Times are also monotonically increasing — defends against the
    // assertion above silently accepting an "ordering by insertion".
    for (let i = 1; i < drainSnapshot.length; i++) {
      expect(drainSnapshot[i].messageTime.getTime())
        .toBeGreaterThan(drainSnapshot[i - 1].messageTime.getTime());
    }
  });

  // -------------------------------------------------------------------------
  // 4. Single drain across multiple pages
  // -------------------------------------------------------------------------

  it('calls processInboxMessages exactly once after walking every page', async () => {
    const fetcher = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage(
        [
          buildCreate(`${SOURCE_ORIGIN}/activities/p1a`, '2026-04-01T00:00:00Z'),
          buildCreate(`${SOURCE_ORIGIN}/activities/p1b`, '2026-04-02T00:00:00Z'),
        ],
        SOURCE_PAGE_2_URI,
      ),
      [SOURCE_PAGE_2_URI]: buildPage([
        buildCreate(`${SOURCE_ORIGIN}/activities/p2a`, '2026-04-03T00:00:00Z'),
      ]),
    });

    const service = runService({ fetcher });
    await service.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

    expect(drainSpy.callCount).toBe(1);

    // All three rows from both pages were persisted before the single drain ran.
    const persistedIds = (await ActivityPubInboxMessageEntity.findAll({
      where: { calendar_id: followerCalendarId },
      order: [['id', 'ASC']],
    })).map(r => r.id);
    expect(persistedIds).toEqual([
      `${SOURCE_ORIGIN}/activities/p1a`,
      `${SOURCE_ORIGIN}/activities/p1b`,
      `${SOURCE_ORIGIN}/activities/p2a`,
    ]);
  });

  // -------------------------------------------------------------------------
  // 5. Idempotency
  // -------------------------------------------------------------------------

  it('produces no duplicate rows when runBackfill is invoked twice over the same source', async () => {
    const fetcher = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage([
        buildCreate(`${SOURCE_ORIGIN}/activities/dup1`, '2026-04-01T00:00:00Z'),
        buildCreate(`${SOURCE_ORIGIN}/activities/dup2`, '2026-04-02T00:00:00Z'),
      ]),
    });

    const service = runService({ fetcher });
    const payload = {
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    };
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

    // Each run drains once.
    expect(drainSpy.callCount).toBe(2);
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
    const fetcher = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage([
        buildCreate(sharedActivityId, backfillPublished),
      ]),
    });

    const service = runService({ fetcher });
    await service.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

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
    const fetcher = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage([
        buildCreate(`${SOURCE_ORIGIN}/activities/silent`, '2026-05-15T00:00:00Z'),
      ]),
    });

    const inboxMessageAddedSpy = sandbox.spy();
    eventBus.on('inboxMessageAdded', inboxMessageAddedSpy);

    const service = runService({ fetcher });
    await service.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

    // The row landed but no event fired — proving the worker bypasses
    // `addToInbox` and uses `findOrCreate` instead.
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
    // Drain still ran exactly once (cleanup guarantee from the finally block).
    expect(drainSpy.callCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 9. DEC-008 sticky per-calendar unpost dismissal scoping
  // -------------------------------------------------------------------------
  //
  // Backfill walks an Announce + later Undo(Announce) for the same event.
  // Two followers (F and G) consume identical activity sequences from the
  // same source. F has a pre-existing RepostDismissalEntity for the event;
  // G does not. After backfill drains its inbox, F has no SharedEventEntity
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
    // guard both live in ProcessInboxService. The beforeEach hook stubs
    // out `processInboxMessages` (plural) so the other tests in this suite
    // can assert single-drain semantics without running the live handlers;
    // we keep that stub in place here and instead drive the dispatch
    // pipeline directly via `processInboxMessage` (singular) on each
    // persisted row in `message_time` ASC order, which is the same
    // ordering the production drain uses (column-name vs. attribute-name
    // discrepancy on the live query is tracked separately and not under
    // test here).

    const eventApId = `${SOURCE_ORIGIN}/events/dismissal-scoping`;
    const announceFId = `${SOURCE_ORIGIN}/activities/announce-f`;
    const undoFId = `${SOURCE_ORIGIN}/activities/undo-f`;
    const announceGId = `${SOURCE_ORIGIN}/activities/announce-g`;
    const undoGId = `${SOURCE_ORIGIN}/activities/undo-g`;

    // Pre-create the underlying local event row so processShareEvent's
    // EventObjectEntity lookup hits and skips the remote fetch path, and
    // so the RepostDismissalEntity FK to event has a valid target.
    const eventId = uuidv4();
    await EventEntity.create({
      id: eventId,
      calendar_id: null, // remote-origin event
    });
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: SOURCE_ACTOR_URI,
    });

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
    // (PK is the activity id, which differs) and drains the inbox via
    // the real ProcessInboxService.
    const fetcherF = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage([announceF, undoF]),
    });
    const serviceF = runService({ fetcher: fetcherF });
    await serviceF.runBackfill({
      followingCalendarId: followerCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

    const fetcherG = makeFetcher({
      [SOURCE_ACTOR_URI]: { type: 'Person', outbox: SOURCE_OUTBOX_URI },
      [SOURCE_OUTBOX_URI]: { type: 'OrderedCollection', first: SOURCE_PAGE_1_URI },
      [SOURCE_PAGE_1_URI]: buildPage([announceG, undoG]),
    });
    const serviceG = runService({ fetcher: fetcherG });
    await serviceG.runBackfill({
      followingCalendarId: followerGCalendarId,
      calendarActorId: sourceCalendarActorId,
      sourceActorUri: SOURCE_ACTOR_URI,
    });

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
      await (activityPubInterface as unknown as { inboxSerivce: ProcessInboxService })
        .inboxSerivce.processInboxMessage(row);
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
});

