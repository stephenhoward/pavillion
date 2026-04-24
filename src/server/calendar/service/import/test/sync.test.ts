import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import type { VEvent, DateWithTimeZone } from 'node-ical';

import { Account } from '@/common/model/account';
import {
  ImportSourceFetchError,
  ImportSourceNotFoundError,
  ImportSourceSsrfBlockedError,
  ImportSourceVerifyRateLimitError,
} from '@/common/exceptions/import';
import { EventEntity } from '@/server/calendar/entity/event';
import { ImportRunEntity } from '@/server/calendar/entity/import_run';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import CalendarService from '@/server/calendar/service/calendar';
import EventService from '@/server/calendar/service/events';
import { Fetcher } from '@/server/calendar/service/import/fetcher';
import SyncService, {
  SYNC_PER_SOURCE_HOURLY_LIMIT,
  SyncRateLimiter,
  dedupKey,
} from '@/server/calendar/service/import/sync';
import db from '@/server/common/entity/db';

/**
 * Unit tests for the ICS sync orchestrator (pv-1qcp.2.4).
 *
 * These tests stub every persistence and I/O boundary so the pipeline logic
 * is exercised deterministically without touching a real database. The core
 * integration-tier behavior (real-DB transaction rollback, retention cap)
 * has a dedicated integration spec at ../../../test/integration/.
 */

function makeDtz(iso: string, tz?: string): DateWithTimeZone {
  const d = new Date(iso) as DateWithTimeZone;
  if (tz !== undefined) {
    d.tz = tz;
  }
  return d;
}

function makeVEvent(overrides: Partial<VEvent> = {}): VEvent {
  return {
    type: 'VEVENT',
    uid: 'event-uid-1@example.test',
    dtstamp: makeDtz('2026-04-22T10:00:00Z'),
    start: makeDtz('2026-04-22T10:00:00Z', 'Etc/UTC'),
    end: makeDtz('2026-04-22T11:00:00Z', 'Etc/UTC'),
    datetype: 'date-time',
    summary: 'Sample Event',
    ...overrides,
  } as VEvent;
}

/**
 * Builds a minimal fake ImportSourceEntity. We bypass Sequelize's build()
 * and declare it as a stub with the fields the orchestrator reads.
 */
function makeSourceEntity(overrides: Partial<ImportSourceEntity> = {}): ImportSourceEntity {
  const save = sinon.stub().resolves();
  return {
    id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    calendar_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    url: 'https://events.example.test/feed.ics',
    enabled: true,
    verification_state: 'verified',
    verification_token: null,
    verified_at: new Date('2026-03-01T00:00:00Z'),
    verification_expires_at: new Date('2026-06-01T00:00:00Z'),
    etag: null,
    content_hash: null,
    last_fetched_at: null,
    last_status: null,
    save,
    ...overrides,
  } as unknown as ImportSourceEntity;
}

function makeEventEntity(overrides: Partial<EventEntity> = {}): EventEntity {
  const save = sinon.stub().resolves();
  return {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    calendar_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    import_source_id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    external_uid: 'event-uid-1@example.test',
    external_recurrence_id: null,
    source_last_modified: null,
    source_last_seen_at: null,
    locally_edited: false,
    x_props: null,
    save,
    ...overrides,
  } as unknown as EventEntity;
}

describe('SyncService', () => {
  let sandbox: sinon.SinonSandbox;
  let fetcher: sinon.SinonStubbedInstance<Fetcher>;
  let eventService: sinon.SinonStubbedInstance<EventService>;
  let calendarService: sinon.SinonStubbedInstance<CalendarService>;
  let service: SyncService;
  let rateLimiter: SyncRateLimiter;
  let account: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    fetcher = sandbox.createStubInstance(Fetcher);
    eventService = sandbox.createStubInstance(EventService);

    // The orchestrator resolves the calendar's primary language through
    // the injected CalendarService. A stubbed instance is passed via
    // SyncDependencies.calendarService — no reach-through into private
    // fields required.
    calendarService = sandbox.createStubInstance(CalendarService);
    calendarService.getCalendar.resolves({ languages: ['en'] } as never);

    rateLimiter = new SyncRateLimiter();

    service = new SyncService({
      eventService: eventService as unknown as EventService,
      calendarService: calendarService as unknown as CalendarService,
      fetcher: fetcher as unknown as Fetcher,
      rateLimiter,
      parseICS: () => ({}) as never,
    });

    account = new Account('account-uuid');
    account.email = 'owner@example.test';

    // Auto-succeed save() for sources / runs / entities.
    sandbox.stub(ImportRunEntity, 'create').callsFake(async (values: Record<string, unknown>) => {
      return { id: 'run-' + Math.random().toString(36).slice(2, 8), ...values } as unknown as ImportRunEntity;
    });
    sandbox.stub(ImportRunEntity, 'findAll').resolves([] as unknown as ImportRunEntity[]);
    sandbox.stub(ImportRunEntity, 'destroy').resolves(0);
    sandbox.stub(EventEntity, 'update').resolves([0]);

    // Default transaction passthrough — runs the callback directly with a
    // sentinel and propagates thrown errors.
    sandbox.stub(db, 'transaction').callsFake(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => unknown)({ LEVEL: 'test' });
      }
      throw new Error('unsupported transaction usage in test');
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  // --------------------------------------------------------------------------
  // Pure helper coverage
  // --------------------------------------------------------------------------

  describe('dedupKey', () => {
    it('composes uid::recurrence_id with empty recurrence when absent', () => {
      expect(dedupKey('uid-1', null)).toBe('uid-1::');
      expect(dedupKey('uid-1', undefined)).toBe('uid-1::');
      expect(dedupKey('uid-1', '2026-04-22T10:00:00Z')).toBe('uid-1::2026-04-22T10:00:00Z');
    });
  });

  // --------------------------------------------------------------------------
  // Verification state gating
  // --------------------------------------------------------------------------

  describe('verification state', () => {
    it('throws ImportSourceNotFoundError when the source does not exist', async () => {
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(null);
      await expect(service.syncSource({ account, importSourceId: 'missing' }))
        .rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });

    it('refuses sync when verification is unverified', async () => {
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(
        makeSourceEntity({ verification_state: 'unverified' }),
      );
      await expect(service.syncSource({ account, importSourceId: 'src-1' }))
        .rejects.toMatchObject({ message: 'IMPORT_SOURCE_NOT_VERIFIED' });
    });

    it('refuses sync when verification is expired and beyond the grace window', async () => {
      const longAgo = new Date('2020-01-01T00:00:00Z');
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(
        makeSourceEntity({
          verification_state: 'expired',
          verification_expires_at: longAgo,
        }),
      );
      await expect(service.syncSource({ account, importSourceId: 'src-1' }))
        .rejects.toMatchObject({ message: 'IMPORT_SOURCE_NOT_VERIFIED' });
    });

    it('allows sync when expired but inside the 14-day grace window', async () => {
      const now = new Date('2026-04-22T00:00:00Z');
      const expiresAt = new Date('2026-04-20T00:00:00Z'); // 2 days ago
      const src = makeSourceEntity({
        verification_state: 'expired',
        verification_expires_at: expiresAt,
      });
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({ outcome: 'not_modified', httpStatus: 304 });

      service = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => ({}) as never,
        now: () => now,
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });
      expect(result.outcome).toBe('no_changes');
    });
  });

  // --------------------------------------------------------------------------
  // Rate limiting
  // --------------------------------------------------------------------------

  describe('rate limiter', () => {
    it('tryAcquire allows up to SYNC_PER_SOURCE_HOURLY_LIMIT within the window', () => {
      const rl = new SyncRateLimiter();
      const start = 1_000_000;
      for (let i = 0; i < SYNC_PER_SOURCE_HOURLY_LIMIT; i++) {
        expect(rl.tryAcquire('src-1', start + i)).toBe(true);
      }
      expect(rl.tryAcquire('src-1', start + SYNC_PER_SOURCE_HOURLY_LIMIT)).toBe(false);
    });

    it('tryAcquire releases capacity after the window elapses', () => {
      const rl = new SyncRateLimiter();
      const start = 1_000_000;
      for (let i = 0; i < SYNC_PER_SOURCE_HOURLY_LIMIT; i++) {
        rl.tryAcquire('src-1', start + i);
      }
      // Jump more than 1 hour forward.
      expect(rl.tryAcquire('src-1', start + 60 * 60 * 1000 + 1)).toBe(true);
    });

    it('tracks sources independently', () => {
      const rl = new SyncRateLimiter();
      for (let i = 0; i < SYNC_PER_SOURCE_HOURLY_LIMIT; i++) {
        expect(rl.tryAcquire('src-1', i)).toBe(true);
      }
      // Different source — full budget still available.
      expect(rl.tryAcquire('src-2', 0)).toBe(true);
    });

    it('throws ImportSourceVerifyRateLimitError once the limit is hit', async () => {
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(makeSourceEntity());
      fetcher.fetch.resolves({ outcome: 'not_modified', httpStatus: 304 });

      for (let i = 0; i < SYNC_PER_SOURCE_HOURLY_LIMIT; i++) {
        await service.syncSource({ account, importSourceId: 'src-1' });
      }

      await expect(service.syncSource({ account, importSourceId: 'src-1' }))
        .rejects.toBeInstanceOf(ImportSourceVerifyRateLimitError);
    });
  });

  // --------------------------------------------------------------------------
  // 304 Not Modified / content-hash short-circuits
  // --------------------------------------------------------------------------

  describe('no-change outcomes', () => {
    it('records no_changes on 304 and updates last_fetched_at / last_status=ok', async () => {
      const src = makeSourceEntity({ etag: 'W/"abc"' });
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({ outcome: 'not_modified', httpStatus: 304, etag: 'W/"abc"' });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.outcome).toBe('no_changes');
      expect(result.eventsCreated).toBe(0);
      expect(src.last_status).toBe('ok');
      expect((src.save as sinon.SinonStub).called).toBe(true);
      // conditional GET sent with stored etag
      expect(fetcher.fetch.firstCall.args[0]).toMatchObject({ etag: 'W/"abc"' });
    });

    it('records no_changes when content_hash matches the stored hash', async () => {
      const src = makeSourceEntity({ content_hash: 'HASH-UNCHANGED' });
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
        contentHash: 'HASH-UNCHANGED',
        etag: 'W/"new"',
        bytesReceived: 10,
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });
      expect(result.outcome).toBe('no_changes');
      expect(eventService.createEvent.called).toBe(false);
      expect(eventService.updateEvent.called).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Fetch / parse error paths
  // --------------------------------------------------------------------------

  describe('fetch/parse errors', () => {
    it('records fetch_error when the fetcher throws ImportSourceFetchError', async () => {
      const src = makeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.rejects(new ImportSourceFetchError({ reason: 'network_error' }));

      const result = await service.syncSource({ account, importSourceId: 'src-1' });
      expect(result.outcome).toBe('fetch_error');
      expect(result.errorMessage).toBe('IMPORT_FETCH_ERROR');
      expect(src.last_status).toBe('fetch_error');
    });

    it('records ssrf_blocked when the fetcher throws ImportSourceSsrfBlockedError', async () => {
      const src = makeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.rejects(new ImportSourceSsrfBlockedError({ reason: 'private_ip_resolved' }));

      const result = await service.syncSource({ account, importSourceId: 'src-1' });
      expect(result.outcome).toBe('ssrf_blocked');
      expect(result.errorMessage).toBe('IMPORT_SSRF_BLOCKED');
      expect(src.last_status).toBe('ssrf_blocked');
    });

    it('records parse_error when parseICS throws', async () => {
      const src = makeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('junk'),
        contentHash: 'HASH-1',
        etag: undefined,
        bytesReceived: 4,
      });

      service = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => { throw new Error('malformed calendar'); },
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });
      expect(result.outcome).toBe('parse_error');
      expect(src.last_status).toBe('parse_error');
    });
  });

  // --------------------------------------------------------------------------
  // Four-case dispatch (NEW, locally_edited, newer, unchanged)
  // --------------------------------------------------------------------------

  describe('four-case event dispatch', () => {
    function setupWith(vevents: VEvent[], existingEvents: EventEntity[] = []) {
      const src = makeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR...'),
        contentHash: 'HASH-CHANGED',
        etag: undefined,
        bytesReceived: 1,
      });

      sandbox.stub(EventEntity, 'findAll').resolves(existingEvents as unknown as EventEntity[]);

      service = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => {
          const out: Record<string, VEvent> = {};
          vevents.forEach((v, i) => { out[`v-${i}`] = v; });
          return out as never;
        },
      });

      return src;
    }

    it('creates NEW events via EventService.createEvent with source=import context', async () => {
      const veventA = makeVEvent({ uid: 'new-a@example.test' });
      const veventB = makeVEvent({ uid: 'new-b@example.test' });
      setupWith([veventA, veventB]);

      eventService.createEvent.callsFake(async (_acct, params: Record<string, unknown>) => {
        return { id: 'evt-' + (params.externalUid as string) } as never;
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.outcome).toBe('success');
      expect(result.eventsCreated).toBe(2);
      expect(eventService.createEvent.callCount).toBe(2);
      for (const call of eventService.createEvent.getCalls()) {
        expect(call.args[2]).toEqual({ source: 'import' });
      }
    });

    it('skips events with locally_edited=true — updates source_last_seen_at only', async () => {
      const vevent = makeVEvent({ uid: 'held@example.test' });
      const existing = makeEventEntity({
        id: 'evt-held',
        external_uid: 'held@example.test',
        locally_edited: true,
        source_last_seen_at: new Date('2026-04-01T00:00:00Z'),
      });
      setupWith([vevent], [existing]);

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.eventsSkippedLocallyEdited).toBe(1);
      expect(result.eventsUpdated).toBe(0);
      expect(eventService.updateEvent.called).toBe(false);
      expect(eventService.createEvent.called).toBe(false);
      // source_last_seen_at stamped on entity
      expect(existing.source_last_seen_at).not.toEqual(new Date('2026-04-01T00:00:00Z'));
      expect((existing.save as sinon.SinonStub).called).toBe(true);
    });

    it('updates existing events when source_last_modified is newer', async () => {
      const vevent = makeVEvent({
        uid: 'changing@example.test',
        lastmodified: new Date('2026-04-22T12:00:00Z'),
      });
      const existing = makeEventEntity({
        id: 'evt-changing',
        external_uid: 'changing@example.test',
        source_last_modified: new Date('2026-04-22T10:00:00Z'),
      });
      setupWith([vevent], [existing]);

      eventService.updateEvent.resolves({ id: 'evt-changing' } as never);

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.eventsUpdated).toBe(1);
      expect(eventService.updateEvent.calledOnce).toBe(true);
      expect(eventService.updateEvent.firstCall.args[2]).toEqual(expect.objectContaining({
        calendarId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      }));
      expect(eventService.updateEvent.firstCall.args[3]).toEqual({ source: 'import' });
    });

    it('leaves unchanged events untouched — only source_last_seen_at is refreshed', async () => {
      const vevent = makeVEvent({
        uid: 'stable@example.test',
        lastmodified: new Date('2026-04-22T10:00:00Z'),
      });
      const existing = makeEventEntity({
        id: 'evt-stable',
        external_uid: 'stable@example.test',
        source_last_modified: new Date('2026-04-22T10:00:00Z'),
      });
      setupWith([vevent], [existing]);

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.eventsCreated).toBe(0);
      expect(result.eventsUpdated).toBe(0);
      expect(eventService.createEvent.called).toBe(false);
      expect(eventService.updateEvent.called).toBe(false);
      expect((existing.save as sinon.SinonStub).called).toBe(true);
    });

    it('counts disappeared events without writing to them', async () => {
      const vevent = makeVEvent({ uid: 'present@example.test' });
      const present = makeEventEntity({
        id: 'evt-present',
        external_uid: 'present@example.test',
        source_last_modified: null,
      });
      const gone = makeEventEntity({
        id: 'evt-gone',
        external_uid: 'gone@example.test',
        source_last_seen_at: new Date('2026-04-01T00:00:00Z'),
      });
      setupWith([vevent], [present, gone]);

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.eventsDisappeared).toBe(1);
      // The disappeared event is NOT saved.
      expect((gone.save as sinon.SinonStub).called).toBe(false);
    });

    it('records partial parse failure when one VEVENT in a batch throws during mapping', async () => {
      // Three VEVENTs — the middle one is missing DTSTART, which causes the
      // real mapper to throw (`'VEVENT is missing DTSTART; cannot map.'`).
      // The other two should still be created in the same run, and the
      // orchestrator should record an overall 'parse_error' outcome with
      // parseErrorCount > 0 while eventsCreated counts only the successes.
      const veventA = makeVEvent({ uid: 'uid-a@example.test' });
      const veventB = makeVEvent({ uid: 'uid-b@example.test' });
      // Force mapper to throw on this one by dropping DTSTART (mapper.ts:341).
      delete (veventB as Partial<VEvent>).start;
      const veventC = makeVEvent({ uid: 'uid-c@example.test' });

      const src = setupWith([veventA, veventB, veventC]);

      eventService.createEvent.callsFake(async (_acct, params: Record<string, unknown>) => {
        return { id: 'evt-' + (params.externalUid as string) } as never;
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      // Transaction completes (per-event mapper errors are caught + continue)
      // so outcome reflects parseErrorCount > 0.
      expect(result.outcome).toBe('parse_error');
      expect(result.eventsCreated).toBe(2);
      // Two successful creates, one mapper failure.
      expect(eventService.createEvent.callCount).toBe(2);
      // Source bookkeeping stamped inside the successful transaction.
      expect(src.last_status).toBe('parse_error');
      // Non-typed Error from the real mapper is sanitized to the internal
      // sentinel (ImportSourceParseError is never thrown by mapVEvent — the
      // wrapper in sync.ts maps plain Error to IMPORT_INTERNAL_ERROR).
      expect(result.errorMessage).toBe('IMPORT_INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // Transaction rollback
  // --------------------------------------------------------------------------

  describe('transaction rollback', () => {
    it('rolls back event writes on mid-run failure and records a separate-tx ImportRun', async () => {
      const vevents: VEvent[] = [];
      for (let i = 0; i < 5; i++) {
        vevents.push(makeVEvent({ uid: `uid-${i}@example.test` }));
      }

      const src = makeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR...'),
        contentHash: 'HASH-CHANGED',
        etag: undefined,
        bytesReceived: 1,
      });
      sandbox.stub(EventEntity, 'findAll').resolves([] as unknown as EventEntity[]);

      service = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => {
          const out: Record<string, VEvent> = {};
          vevents.forEach((v, i) => { out[`v-${i}`] = v; });
          return out as never;
        },
      });

      eventService.createEvent
        .onCall(0).resolves({ id: 'evt-0' } as never)
        .onCall(1).resolves({ id: 'evt-1' } as never)
        .onCall(2).resolves({ id: 'evt-2' } as never)
        .onCall(3).resolves({ id: 'evt-3' } as never)
        .onCall(4).rejects(new Error('write failure on fifth'));

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.outcome).toBe('parse_error');
      expect(result.eventsCreated).toBe(0);
      // Non-typed Error should not leak its message to the caller. Instead the
      // opaque IMPORT_INTERNAL_ERROR sentinel is surfaced and the raw error is
      // logged at error level for operator diagnostics.
      expect(result.errorMessage).toBe('IMPORT_INTERNAL_ERROR');
      // ImportRun was still recorded (separate transaction from the rolled-back one).
      expect((ImportRunEntity.create as sinon.SinonStub).calledOnce).toBe(true);
    });

    it('does not leak raw error message (e.g. DB connection string) to ImportRun.error_message', async () => {
      // Fake "leaky" internal error: a Sequelize-style message that might
      // embed a DB connection string, a stack fragment, or other internal
      // detail. Any such text MUST be scrubbed before it lands in the DB or
      // in the API response.
      const leakyDbUrl = 'postgresql://admin:s3cret@db.internal:5432/pavillion_prod';
      const leakyMessage = `connection failed: could not connect to ${leakyDbUrl}`;

      const vevent = makeVEvent({ uid: 'leaky@example.test' });

      const src = makeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR...'),
        contentHash: 'HASH-CHANGED',
        etag: undefined,
        bytesReceived: 1,
      });
      sandbox.stub(EventEntity, 'findAll').resolves([] as unknown as EventEntity[]);

      service = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => ({ 'v-0': vevent } as never),
      });

      eventService.createEvent.rejects(new Error(leakyMessage));

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      // Result returned to caller is sanitized.
      expect(result.errorMessage).toBe('IMPORT_INTERNAL_ERROR');
      expect(result.errorMessage).not.toContain(leakyDbUrl);
      expect(result.errorMessage).not.toContain('s3cret');

      // ImportRun row persisted to the DB is sanitized.
      const createStub = ImportRunEntity.create as sinon.SinonStub;
      expect(createStub.calledOnce).toBe(true);
      const persistedArgs = createStub.firstCall.args[0] as { error_message: string | null };
      expect(persistedArgs.error_message).toBe('IMPORT_INTERNAL_ERROR');
      expect(persistedArgs.error_message).not.toContain(leakyDbUrl);
      expect(persistedArgs.error_message).not.toContain('s3cret');
    });
  });

  // --------------------------------------------------------------------------
  // Idempotency
  // --------------------------------------------------------------------------

  describe('idempotency', () => {
    it('second run with the same content hash is a no-op', async () => {
      // First run: fresh fetch, content hash recorded.
      const src = makeSourceEntity({ content_hash: 'HASH-1' });
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR'),
        contentHash: 'HASH-1', // same as stored
        etag: undefined,
        bytesReceived: 1,
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });
      expect(result.outcome).toBe('no_changes');
      expect(eventService.createEvent.called).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Calendar-language resolution DI surface (pv-1qcp.7)
  // --------------------------------------------------------------------------

  describe('calendar-language resolution DI', () => {
    function setupParseableFeed(): ImportSourceEntity {
      const src = makeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR...'),
        contentHash: 'HASH-LANG-1',
        etag: undefined,
        bytesReceived: 1,
      });
      sandbox.stub(EventEntity, 'findAll').resolves([] as unknown as EventEntity[]);
      return src;
    }

    it('uses the injected CalendarService to resolve the primary language', async () => {
      setupParseableFeed();
      calendarService.getCalendar.resolves({ languages: ['fr', 'en'] } as never);

      const vevent = makeVEvent({ uid: 'lang-a@example.test' });
      service = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => ({ 'v-0': vevent } as never),
      });

      eventService.createEvent.callsFake(async (_acct, params: Record<string, unknown>) => {
        // The mapper stamps the primary language onto the content map key.
        const content = params.content as Record<string, unknown>;
        expect(Object.keys(content)).toContain('fr');
        return { id: 'evt-lang-a' } as never;
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });
      expect(result.outcome).toBe('success');
      expect(calendarService.getCalendar.calledOnce).toBe(true);
    });

    it('falls back to CalendarEntity.findByPk when no CalendarService is injected', async () => {
      setupParseableFeed();
      const findByPkStub = sandbox.stub()
        .withArgs('cccccccc-cccc-cccc-cccc-cccccccccccc')
        .resolves({ languages: 'de,en' } as never);
      // Stub CalendarEntity.findByPk via the dynamic import used inside sync.ts.
      const { CalendarEntity } = await import('@/server/calendar/entity/calendar');
      sandbox.stub(CalendarEntity, 'findByPk').callsFake(findByPkStub);

      const vevent = makeVEvent({ uid: 'lang-b@example.test' });
      service = new SyncService({
        // NOTE: no calendarService — fallback path exercised.
        eventService: eventService as unknown as EventService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => ({ 'v-0': vevent } as never),
      });

      eventService.createEvent.callsFake(async (_acct, params: Record<string, unknown>) => {
        const content = params.content as Record<string, unknown>;
        // First non-empty entry from the comma-separated string is picked.
        expect(Object.keys(content)).toContain('de');
        return { id: 'evt-lang-b' } as never;
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });
      expect(result.outcome).toBe('success');
      expect(findByPkStub.calledOnce).toBe(true);
    });
  });
});
