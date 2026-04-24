import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import type { VEvent, DateWithTimeZone } from 'node-ical';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventImportOriginEntity } from '@/server/calendar/entity/event_import_origin';
import { ImportRunEntity } from '@/server/calendar/entity/import_run';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import CalendarInterface from '@/server/calendar/interface';
import { Fetcher } from '@/server/calendar/service/import/fetcher';
import SyncService, {
  IMPORT_RUN_RETENTION,
  SYNC_PER_SOURCE_HOURLY_LIMIT,
  SyncRateLimiter,
} from '@/server/calendar/service/import/sync';
import {
  ImportSourceNotFoundError,
  ImportSourceVerifyRateLimitError,
} from '@/common/exceptions/import';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/test/lib/test_environment';

/**
 * Integration tests for the ICS sync orchestrator (pv-1qcp.2.4).
 *
 * Exercises the sync pipeline against a real SQLite in-memory database so
 * that transactions, dedup queries, ImportRun writes, and source bookkeeping
 * are verified end-to-end. Fetcher + parseICS are injected so the tests stay
 * hermetic (no real HTTP / ICS parsing).
 */
describe('SyncService integration', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;
  let syncService: SyncService;
  let fetcherStub: sinon.SinonStubbedInstance<Fetcher>;
  let rateLimiter: SyncRateLimiter;
  let parseICSFake: (body: string) => Record<string, VEvent>;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);

    calendarInterface.setActivityPubInterface({
      getSharedEventIds: async () => [],
      getSharedEventStatusMap: async () => new Map(),
    } as never);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const accountInfo = await accountService._setupAccount('synctest@pavillion.dev', 'testpassword');
    testAccount = accountInfo.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'synctestcal');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  beforeEach(() => {
    // Fresh fetcher stub + rate limiter per test so state does not leak.
    fetcherStub = sinon.createStubInstance(Fetcher);
    rateLimiter = new SyncRateLimiter();
    parseICSFake = () => ({});

    // Use the interface's public createSyncService factory so the sync
    // pipeline is wired with the same EventService and CalendarService
    // instances the HTTP path uses — no piercing into private fields.
    syncService = calendarInterface.createSyncService({
      fetcher: fetcherStub as unknown as Fetcher,
      rateLimiter,
      parseICS: (body: string) => parseICSFake(body) as never,
    });
  });

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function makeDtz(iso: string, tz?: string): DateWithTimeZone {
    const d = new Date(iso) as DateWithTimeZone;
    if (tz !== undefined) d.tz = tz;
    return d;
  }

  function makeVEvent(overrides: Partial<VEvent> = {}): VEvent {
    return {
      type: 'VEVENT',
      uid: 'event-1@example.test',
      dtstamp: makeDtz('2026-04-22T10:00:00Z'),
      start: makeDtz('2026-04-22T10:00:00Z', 'Etc/UTC'),
      end: makeDtz('2026-04-22T11:00:00Z', 'Etc/UTC'),
      datetype: 'date-time',
      summary: 'Sample',
      ...overrides,
    } as VEvent;
  }

  async function createVerifiedSource(opts: {
    url?: string;
    contentHash?: string | null;
    etag?: string | null;
    verificationExpiresAt?: Date;
  } = {}): Promise<ImportSourceEntity> {
    const now = new Date();
    const source = ImportSourceEntity.build({
      calendar_id: testCalendar.id,
      url: opts.url ?? 'https://feeds.example.test/events.ics',
      enabled: true,
      verification_state: 'verified',
      verified_at: now,
      verification_expires_at: opts.verificationExpiresAt
        ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      content_hash: opts.contentHash ?? null,
      etag: opts.etag ?? null,
    });
    await source.save();
    return source;
  }

  async function countEventsForSource(sourceId: string): Promise<number> {
    // After pv-picz, origin-provenance lives on the EventImportOriginEntity
    // sibling table rather than as columns on EventEntity. Count rows there
    // to measure events attributable to the given source.
    return EventImportOriginEntity.count({ where: { import_source_id: sourceId } });
  }

  // --------------------------------------------------------------------------
  // Happy path: N new events created, ImportRun written
  // --------------------------------------------------------------------------

  describe('happy path', () => {
    it('creates 3 new events and writes an ImportRun with the correct counts', async () => {
      const source = await createVerifiedSource();
      fetcherStub.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-HAPPY-1',
        etag: 'W/"new"',
        bytesReceived: 1,
      });
      parseICSFake = () => ({
        a: makeVEvent({ uid: 'happy-a@example.test', summary: 'Event A' }),
        b: makeVEvent({ uid: 'happy-b@example.test', summary: 'Event B' }),
        c: makeVEvent({ uid: 'happy-c@example.test', summary: 'Event C' }),
      });

      const result = await syncService.syncSource({ account: testAccount, importSourceId: source.id });

      expect(result.outcome).toBe('success');
      expect(result.eventsCreated).toBe(3);
      expect(result.eventsUpdated).toBe(0);

      const eventCount = await countEventsForSource(source.id);
      expect(eventCount).toBe(3);

      // ImportRun persisted with correct counts.
      const runs = await ImportRunEntity.findAll({ where: { import_source_id: source.id } });
      expect(runs).toHaveLength(1);
      expect(runs[0].events_created).toBe(3);
      expect(runs[0].outcome).toBe('success');

      // Source bookkeeping updated.
      const refreshed = await ImportSourceEntity.findByPk(source.id);
      expect(refreshed?.content_hash).toBe('HASH-HAPPY-1');
      expect(refreshed?.etag).toBe('W/"new"');
      expect(refreshed?.last_status).toBe('ok');
      expect(refreshed?.last_fetched_at).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 304 / content-hash no-change paths
  // --------------------------------------------------------------------------

  describe('no-change outcomes', () => {
    it('304 response records no_changes without writing events', async () => {
      const source = await createVerifiedSource({ etag: 'W/"abc"' });
      fetcherStub.fetch.resolves({ outcome: 'not_modified', httpStatus: 304, etag: 'W/"abc"' });

      const result = await syncService.syncSource({ account: testAccount, importSourceId: source.id });

      expect(result.outcome).toBe('no_changes');
      expect(result.eventsCreated).toBe(0);
      const runs = await ImportRunEntity.findAll({ where: { import_source_id: source.id } });
      expect(runs[0].outcome).toBe('no_changes');
      expect(await countEventsForSource(source.id)).toBe(0);
    });

    it('unchanged content_hash is treated as no_changes', async () => {
      const source = await createVerifiedSource({ contentHash: 'HASH-SAME' });
      fetcherStub.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-SAME',
        etag: undefined,
        bytesReceived: 1,
      });

      const result = await syncService.syncSource({ account: testAccount, importSourceId: source.id });
      expect(result.outcome).toBe('no_changes');
    });
  });

  // --------------------------------------------------------------------------
  // Idempotency: running the same body twice
  // --------------------------------------------------------------------------

  describe('idempotency', () => {
    it('second run with same body → no_changes; total events unchanged', async () => {
      const source = await createVerifiedSource();
      fetcherStub.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-IDEM',
        etag: undefined,
        bytesReceived: 1,
      });
      parseICSFake = () => ({
        a: makeVEvent({ uid: 'idem-a@example.test' }),
        b: makeVEvent({ uid: 'idem-b@example.test' }),
      });

      const first = await syncService.syncSource({ account: testAccount, importSourceId: source.id });
      expect(first.eventsCreated).toBe(2);

      // Second run — same hash → no_changes short-circuit, no event writes.
      const second = await syncService.syncSource({ account: testAccount, importSourceId: source.id });
      expect(second.outcome).toBe('no_changes');
      expect(second.eventsCreated).toBe(0);

      expect(await countEventsForSource(source.id)).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Rate limiting
  // --------------------------------------------------------------------------

  describe('rate limiting', () => {
    it('blocks the 5th Sync-Now within an hour for the same source', async () => {
      const source = await createVerifiedSource();
      fetcherStub.fetch.resolves({ outcome: 'not_modified', httpStatus: 304 });

      for (let i = 0; i < SYNC_PER_SOURCE_HOURLY_LIMIT; i++) {
        await syncService.syncSource({ account: testAccount, importSourceId: source.id });
      }

      await expect(syncService.syncSource({ account: testAccount, importSourceId: source.id }))
        .rejects.toBeInstanceOf(ImportSourceVerifyRateLimitError);
    });
  });

  // --------------------------------------------------------------------------
  // Transaction rollback: sibling-table origin rows participate in the sync
  // transaction (pv-picz — provenance now lives on EventImportOriginEntity)
  // --------------------------------------------------------------------------

  describe('atomicity: transaction rollback covers sibling origin rows (pv-picz)', () => {
    it('leaves no EventImportOriginEntity rows for the source when a mid-run createEvent fails', async () => {
      // Source is fresh — no pre-existing events or origin rows on it, so
      // every findAll for { import_source_id: source.id } must return empty
      // when the test ends if-and-only-if the sibling-row writes
      // (stampImportOrigin) properly roll back with the transaction.
      const source = await createVerifiedSource();

      fetcherStub.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-ROLLBACK-1',
        etag: undefined,
        bytesReceived: 1,
      });

      parseICSFake = () => ({
        a: makeVEvent({ uid: 'rollback-a@example.test', summary: 'A' }),
        b: makeVEvent({ uid: 'rollback-b@example.test', summary: 'B' }),
        c: makeVEvent({ uid: 'rollback-c@example.test', summary: 'C' }),
        d: makeVEvent({ uid: 'rollback-d@example.test', summary: 'D' }),
        e: makeVEvent({ uid: 'rollback-e@example.test', summary: 'E' }),
      });

      // Stub EventService.createEvent to reject on the third call. The first
      // two calls must invoke the real implementation so their stampImportOrigin
      // writes are actually issued (and expected to roll back).
      const eventService = (calendarInterface as unknown as {
        eventService: import('@/server/calendar/service/events').default;
      }).eventService;

      const realCreateEvent = eventService.createEvent.bind(eventService);
      const stub = sinon.stub(eventService, 'createEvent');
      stub.onCall(0).callsFake((...args: unknown[]) => realCreateEvent(...(args as Parameters<typeof realCreateEvent>)));
      stub.onCall(1).callsFake((...args: unknown[]) => realCreateEvent(...(args as Parameters<typeof realCreateEvent>)));
      stub.onCall(2).rejects(new Error('simulated mid-run write failure'));
      // Calls 3 and 4 never fire because the transaction callback throws on
      // call 2's rejection, but guard them anyway.
      stub.onCall(3).rejects(new Error('should not reach 4th'));
      stub.onCall(4).rejects(new Error('should not reach 5th'));

      try {
        const result = await syncService.syncSource({
          account: testAccount,
          importSourceId: source.id,
        });

        // The run was recorded as a parse_error (generic write-failure bucket)
        // in a separate transaction, and no events are reported as created.
        expect(result.outcome).toBe('parse_error');
        expect(result.eventsCreated).toBe(0);

        // Key assertion: no origin rows exist for this source after rollback.
        // Without the tx threading fix, stampImportOrigin would have committed
        // the sibling rows for events a and b before the transaction rolled
        // back, and those rows would still show import_source_id = source.id.
        const leakedOriginRows = await EventImportOriginEntity.findAll({
          where: { import_source_id: source.id },
        });
        expect(leakedOriginRows).toHaveLength(0);
      }
      finally {
        stub.restore();
      }
    });

    it('leaves no orphaned EventEntity rows on the calendar when a mid-run createEvent fails', async () => {
      const source = await createVerifiedSource({ url: 'https://feeds.example.test/rollback-orphan.ics' });

      fetcherStub.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-ROLLBACK-ORPHAN',
        etag: undefined,
        bytesReceived: 1,
      });

      parseICSFake = () => ({
        a: makeVEvent({ uid: 'orphan-a@example.test', summary: 'A' }),
        b: makeVEvent({ uid: 'orphan-b@example.test', summary: 'B' }),
        c: makeVEvent({ uid: 'orphan-c@example.test', summary: 'C' }),
      });

      const eventService = (calendarInterface as unknown as {
        eventService: import('@/server/calendar/service/events').default;
      }).eventService;

      // Snapshot the event count before the sync run so the assertion is
      // resilient to whatever events earlier tests in this describe block
      // left on testCalendar. The key invariant is: a failed sync run must
      // not add any rows.
      const rowsBefore = await EventEntity.count({ where: { calendar_id: testCalendar.id } });

      const realCreateEvent = eventService.createEvent.bind(eventService);
      const stub = sinon.stub(eventService, 'createEvent');
      stub.onCall(0).callsFake((...args: unknown[]) => realCreateEvent(...(args as Parameters<typeof realCreateEvent>)));
      stub.onCall(1).callsFake((...args: unknown[]) => realCreateEvent(...(args as Parameters<typeof realCreateEvent>)));
      stub.onCall(2).rejects(new Error('simulated mid-run write failure'));

      try {
        await syncService.syncSource({
          account: testAccount,
          importSourceId: source.id,
        });

        // With EventService tx plumbing (pv-1qcp.14), all entity writes
        // performed by the 2 successful createEvent calls participate in the
        // sync orchestrator's db.transaction and roll back when the 3rd call
        // rejects. No new EventEntity rows should survive on the test calendar.
        const rowsAfter = await EventEntity.count({ where: { calendar_id: testCalendar.id } });
        expect(rowsAfter).toBe(rowsBefore);
      }
      finally {
        stub.restore();
      }
    });
  });

  // --------------------------------------------------------------------------
  // FK cascade: EventImportOriginEntity row lifecycle tied to both parents
  // (pv-picz — origin sibling table has ON DELETE CASCADE on event_id and
  // import_source_id). The cascade on import_source_id is a user-observable
  // semantic change from the previous 0028 schema, which used ON DELETE
  // SET NULL on the inline event.import_source_id column.
  // --------------------------------------------------------------------------

  describe('FK cascade on event_import_origin', () => {
    it('cascades delete of EventEntity → its EventImportOriginEntity row is removed', async () => {
      const source = await createVerifiedSource({ url: 'https://feeds.example.test/cascade-event.ics' });

      fetcherStub.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-CASCADE-EVENT',
        etag: undefined,
        bytesReceived: 1,
      });
      parseICSFake = () => ({
        a: makeVEvent({ uid: 'cascade-event-a@example.test', summary: 'Cascade A' }),
      });

      await syncService.syncSource({ account: testAccount, importSourceId: source.id });

      const originBefore = await EventImportOriginEntity.findOne({
        where: { import_source_id: source.id },
      });
      expect(originBefore).not.toBeNull();
      const eventId = originBefore!.event_id;

      const event = await EventEntity.findByPk(eventId);
      expect(event).not.toBeNull();
      await event!.destroy();

      const originAfter = await EventImportOriginEntity.findOne({
        where: { event_id: eventId },
      });
      expect(originAfter).toBeNull();
    });

    it('cascades delete of ImportSourceEntity → origin rows are removed but events are preserved', async () => {
      // User-observable semantic change vs. the previous 0028 SET NULL design:
      // the sibling-table approach drops provenance when the source is deleted
      // rather than preserving events with nulled-out origin columns. The
      // event rows remain, now represented as locally-owned events with no
      // origin row.
      const source = await createVerifiedSource({ url: 'https://feeds.example.test/cascade-source.ics' });

      fetcherStub.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-CASCADE-SOURCE',
        etag: undefined,
        bytesReceived: 1,
      });
      parseICSFake = () => ({
        a: makeVEvent({ uid: 'cascade-source-a@example.test', summary: 'Source Cascade A' }),
        b: makeVEvent({ uid: 'cascade-source-b@example.test', summary: 'Source Cascade B' }),
      });

      await syncService.syncSource({ account: testAccount, importSourceId: source.id });

      const originRowsBefore = await EventImportOriginEntity.findAll({
        where: { import_source_id: source.id },
      });
      expect(originRowsBefore).toHaveLength(2);
      const eventIds = originRowsBefore.map((r) => r.event_id);

      await source.destroy();

      // Origin rows are gone (CASCADE on import_source_id).
      const originRowsAfter = await EventImportOriginEntity.findAll({
        where: { import_source_id: source.id },
      });
      expect(originRowsAfter).toHaveLength(0);

      // But the EventEntity rows are preserved — no cascade from source to
      // event via the sibling table, so events become locally-owned.
      for (const eventId of eventIds) {
        const event = await EventEntity.findByPk(eventId);
        expect(event).not.toBeNull();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Interface-level wiring (verify/sync exposed via CalendarInterface)
  // --------------------------------------------------------------------------

  describe('CalendarInterface wiring (pv-uffj)', () => {
    it('issueImportSourceChallenge returns a deterministic HMAC token', async () => {
      const source = await createVerifiedSource({ url: 'https://wire-issue.example.test/a.ics' });

      const token1 = await calendarInterface.issueImportSourceChallenge(
        testAccount,
        testCalendar.id,
        source.id,
      );
      const token2 = await calendarInterface.issueImportSourceChallenge(
        testAccount,
        testCalendar.id,
        source.id,
      );

      expect(typeof token1).toBe('string');
      expect(token1.length).toBeGreaterThan(0);
      expect(token1).toBe(token2);

      // Token is persisted on the entity.
      const refreshed = await ImportSourceEntity.findByPk(source.id);
      expect(refreshed?.verification_token).toBe(token1);
    });

    it('syncImportSource throws ImportSourceNotFoundError when the source is missing', async () => {
      const missingId = '00000000-0000-4000-8000-000000000000';
      await expect(
        calendarInterface.syncImportSource(testAccount, testCalendar.id, missingId),
      ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });
  });

  // --------------------------------------------------------------------------
  // ImportRun retention cap
  // --------------------------------------------------------------------------

  describe('ImportRun retention', () => {
    it('purges older rows so at most 50 newest survive per source', async () => {
      const source = await createVerifiedSource();

      // Pre-seed 55 runs spaced in time. The orchestrator's purge step runs
      // after the 56th insert and should leave exactly 50.
      for (let i = 0; i < 55; i++) {
        await ImportRunEntity.create({
          import_source_id: source.id,
          started_at: new Date(Date.now() - (60 - i) * 1000),
          finished_at: new Date(Date.now() - (60 - i) * 1000),
          outcome: 'success',
          events_created: 0,
          events_updated: 0,
          events_skipped_locally_edited: 0,
          events_disappeared: 0,
          error_message: null,
        });
      }

      // Drive one sync (304 → records run → triggers purge of oldest beyond cap).
      fetcherStub.fetch.resolves({ outcome: 'not_modified', httpStatus: 304 });
      // 304 short-circuit does NOT purge (purge only runs on the main path).
      // So we drive a content-changed run instead.
      parseICSFake = () => ({ a: makeVEvent({ uid: 'ret-a@example.test' }) });
      fetcherStub.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-RET',
        etag: undefined,
        bytesReceived: 1,
      });

      await syncService.syncSource({ account: testAccount, importSourceId: source.id });

      const rows = await ImportRunEntity.findAll({
        where: { import_source_id: source.id },
        order: [['started_at', 'DESC']],
      });
      expect(rows.length).toBeLessThanOrEqual(IMPORT_RUN_RETENTION);
    });
  });
});
