import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import type { VEvent, DateWithTimeZone } from 'node-ical';

import { Account } from '@/common/model/account';
import {
  ImportSourceFetchError,
  ImportSourceNotFoundError,
  ImportSourceNotVerifiedError,
  ImportSourceSsrfBlockedError,
  ImportSourceVerifyRateLimitError,
} from '@/common/exceptions/import';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventImportOriginEntity } from '@/server/calendar/entity/event_import_origin';
import { ImportRunEntity } from '@/server/calendar/entity/import_run';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import CalendarService from '@/server/calendar/service/calendar';
import EventService from '@/server/calendar/service/events';
import { Fetcher } from '@/server/calendar/service/import/fetcher';
import SyncService, {
  SYNC_PER_SOURCE_HOURLY_LIMIT,
  SyncRateLimiter,
  buildEventParamsForCreate,
  buildEventParamsForUpdate,
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
 *
 * Post-pv-picz: origin provenance lives on the sibling EventImportOriginEntity
 * table — the orchestrator's dedup bulk-load is now
 * `EventImportOriginEntity.findAll({ include: [{ model: EventEntity }] })`
 * and stampImportOrigin / touchSourceLastSeen write to the sibling row.
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
    // No expiry by default: assertVerifiedForSync treats a verified source with
    // a null expiry as valid regardless of wall-clock time, so the orchestration
    // tests below don't trip ImportSourceNotVerifiedError as real time advances.
    // Verification-expiry/grace-window behavior has dedicated tests that set
    // verification_expires_at explicitly.
    verification_expires_at: null,
    etag: null,
    content_hash: null,
    last_fetched_at: null,
    last_status: null,
    save,
    ...overrides,
  } as unknown as ImportSourceEntity;
}

/**
 * Builds a minimal fake EventImportOriginEntity mirroring the sibling table
 * shape. The orchestrator's dedup bulk-load returns rows of this shape (with
 * `event` eager-joined). Event-side fields live on EventEntity; this factory
 * models the origin row only, since the orchestrator reads external_uid and
 * external_recurrence_id straight off the origin row — not from the joined
 * event — on the dedup path.
 */
function makeOriginEntity(overrides: Partial<EventImportOriginEntity> = {}): EventImportOriginEntity {
  const save = sinon.stub().resolves();
  const defaultEventId = (overrides as Record<string, unknown>).event_id as string | undefined
    ?? 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  return {
    id: 'oooooooo-oooo-oooo-oooo-oooooooooooo',
    event_id: defaultEventId,
    import_source_id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    external_uid: 'event-uid-1@example.test',
    external_recurrence_id: null,
    source_last_modified: null,
    source_last_seen_at: null,
    locally_edited: false,
    x_props: null,
    save,
    ...overrides,
  } as unknown as EventImportOriginEntity;
}

describe('SyncService', () => {
  let sandbox: sinon.SinonSandbox;
  let fetcher: sinon.SinonStubbedInstance<Fetcher>;
  let eventService: sinon.SinonStubbedInstance<EventService>;
  let calendarService: sinon.SinonStubbedInstance<CalendarService>;
  let service: SyncService;
  let rateLimiter: SyncRateLimiter;
  let account: Account;
  let originUpsertStub: sinon.SinonStub;

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

    // Origin-row upsert default: resolve. Individual tests may over-assert
    // the args via firstCall.
    originUpsertStub = sandbox.stub(EventImportOriginEntity, 'upsert').resolves(
      [null as unknown as EventImportOriginEntity, true] as [EventImportOriginEntity, boolean | null],
    );

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

  describe('buildEventParamsForCreate / buildEventParamsForUpdate', () => {
    // Post-pv-picz: origin provenance (importSourceId, externalUid, etc.)
    // MUST NOT leak into the params passed to EventService. It lives on the
    // sibling EventImportOriginEntity row and is written separately by the
    // orchestrator's stampImportOrigin helper.
    function buildFakeMapperOutput(): Parameters<typeof buildEventParamsForCreate>[1] {
      return {
        external_uid: 'uid-x@example.test',
        external_recurrence_id: '20260501T100000Z',
        source_last_modified: undefined,
        external_url: 'https://example.test/page',
        x_props: { 'X-FOO': 'bar' },
        content: {
          language: 'en',
          toObject: () => ({ language: 'en', name: 'n', description: 'd' }),
        },
        schedule: {
          toObject: () => ({ start: '2026-05-01T10:00:00Z', end: '2026-05-01T11:00:00Z' }),
        },
        exclusions: [],
      } as unknown as Parameters<typeof buildEventParamsForCreate>[1];
    }

    it('buildEventParamsForCreate omits origin-provenance fields', () => {
      const src = makeSourceEntity();
      const params = buildEventParamsForCreate(src, buildFakeMapperOutput()) as Record<string, unknown>;

      expect(params).not.toHaveProperty('importSourceId');
      expect(params).not.toHaveProperty('externalUid');
      expect(params).not.toHaveProperty('externalRecurrenceId');
      expect(params).not.toHaveProperty('sourceLastModified');
      expect(params).not.toHaveProperty('xProps');
    });

    it('buildEventParamsForUpdate omits origin-provenance fields', () => {
      const src = makeSourceEntity();
      const params = buildEventParamsForUpdate(src, buildFakeMapperOutput()) as Record<string, unknown>;

      expect(params).not.toHaveProperty('importSourceId');
      expect(params).not.toHaveProperty('externalUid');
      expect(params).not.toHaveProperty('externalRecurrenceId');
      expect(params).not.toHaveProperty('sourceLastModified');
      expect(params).not.toHaveProperty('xProps');
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
        .rejects.toBeInstanceOf(ImportSourceNotVerifiedError);
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
        .rejects.toBeInstanceOf(ImportSourceNotVerifiedError);
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

    it('propagates the real run start time on SyncResult.startedAt', async () => {
      // Item 1 of pv-1qcp.15: SyncResult must preserve the actual run start
      // time (captured at syncSource() entry), not be overwritten by any
      // later clock reading. We simulate time advancing by returning a
      // monotonically increasing clock value on each nowFn() call. The
      // verification-state check reads the clock too, so we use a counter
      // rather than `onFirstCall` semantics to make the assertion robust
      // to internal call order.
      const startTs = new Date('2026-04-22T10:00:00.000Z');
      const finishTs = new Date('2026-04-22T10:00:05.000Z');
      let firstCall = true;
      const now = (): Date => {
        if (firstCall) {
          return startTs;
        }
        return finishTs;
      };

      const src = makeSourceEntity({ etag: 'W/"abc"' });
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(src);
      fetcher.fetch.callsFake(async () => {
        firstCall = false;
        return { outcome: 'not_modified', httpStatus: 304, etag: 'W/"abc"' };
      });

      const scoped = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => ({}) as never,
        now,
      });

      const result = await scoped.syncSource({ account, importSourceId: 'src-1' });

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.startedAt.getTime()).toBe(startTs.getTime());
      // Sanity: startedAt must NOT be clobbered by a later clock read.
      expect(result.startedAt.getTime()).not.toBe(finishTs.getTime());
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
    function setupWith(vevents: VEvent[], existingOrigins: EventImportOriginEntity[] = []) {
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

      // Dedup bulk-load queries the sibling origin table with EventEntity
      // eager-joined. Tests supply origin rows (not event rows); the
      // orchestrator reads external_uid / external_recurrence_id straight
      // off the origin row.
      sandbox.stub(EventImportOriginEntity, 'findAll').resolves(
        existingOrigins as unknown as EventImportOriginEntity[],
      );

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

    it('dedup bulk-load queries EventImportOriginEntity with EventEntity eager-joined', async () => {
      // Use a fresh findAll spy so we can inspect the call args directly.
      const vevent = makeVEvent({ uid: 'new-a@example.test' });
      const src = setupWith([vevent], []);
      void src;

      eventService.createEvent.callsFake(async () => ({ id: 'evt-new-a' } as never));

      // The orchestrator's findAll uses the `importSourceId` input it was
      // given; we pass 'src-input-id' and assert the query carried it.
      await service.syncSource({ account, importSourceId: 'src-input-id' });

      const findAllStub = EventImportOriginEntity.findAll as sinon.SinonStub;
      expect(findAllStub.calledOnce).toBe(true);
      const args = findAllStub.firstCall.args[0] as Record<string, unknown>;
      expect(args.where).toMatchObject({ import_source_id: 'src-input-id' });
      expect(args.include).toBeDefined();
      const include = args.include as Array<Record<string, unknown>>;
      expect(include[0]).toMatchObject({ model: EventEntity });
    });

    it('creates NEW events via EventService.createEvent with source=import context', async () => {
      const veventA = makeVEvent({ uid: 'new-a@example.test' });
      const veventB = makeVEvent({ uid: 'new-b@example.test' });
      setupWith([veventA, veventB]);

      eventService.createEvent.callsFake(async (_acct, params: Record<string, unknown>) => {
        void params;
        return { id: 'evt-create' } as never;
      });

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.outcome).toBe('success');
      expect(result.eventsCreated).toBe(2);
      expect(eventService.createEvent.callCount).toBe(2);
      for (const call of eventService.createEvent.getCalls()) {
        expect(call.args[2]).toEqual({ source: 'import' });
      }
    });

    it('stampImportOrigin omits locally_edited from the upsert values', async () => {
      const vevent = makeVEvent({ uid: 'new-a@example.test' });
      setupWith([vevent]);
      eventService.createEvent.callsFake(async () => ({ id: 'evt-new-a' } as never));

      await service.syncSource({ account, importSourceId: 'src-1' });

      expect(originUpsertStub.called).toBe(true);
      const values = originUpsertStub.firstCall.args[0] as Record<string, unknown>;
      expect(values).not.toHaveProperty('locally_edited');
      // Sanity: the shape is otherwise as expected.
      expect(values).toHaveProperty('event_id');
      expect(values).toHaveProperty('import_source_id');
      expect(values).toHaveProperty('external_uid');
    });

    it('stampImportOrigin receives the transaction handle from the caller', async () => {
      const vevent = makeVEvent({ uid: 'new-a@example.test' });
      setupWith([vevent]);
      eventService.createEvent.callsFake(async () => ({ id: 'evt-new-a' } as never));

      await service.syncSource({ account, importSourceId: 'src-1' });

      expect(originUpsertStub.called).toBe(true);
      const options = originUpsertStub.firstCall.args[1] as Record<string, unknown>;
      // Inside the transaction callback, the orchestrator threads the
      // sentinel tx object through to upsert. Assert the transaction key is
      // present and non-undefined (fake tx sentinel from the db.transaction
      // stub is `{ LEVEL: 'test' }`).
      expect(options.transaction).toBeDefined();
      expect(options.transaction).toMatchObject({ LEVEL: 'test' });
    });

    it('skips events with locally_edited=true — updates source_last_seen_at on the origin row only', async () => {
      const vevent = makeVEvent({ uid: 'held@example.test' });
      const existing = makeOriginEntity({
        event_id: 'evt-held',
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
      // source_last_seen_at refreshed on the origin row, not on EventEntity
      expect(existing.source_last_seen_at).not.toEqual(new Date('2026-04-01T00:00:00Z'));
      expect((existing.save as sinon.SinonStub).called).toBe(true);
    });

    it('updates existing events when source_last_modified is newer', async () => {
      const vevent = makeVEvent({
        uid: 'changing@example.test',
        lastmodified: new Date('2026-04-22T12:00:00Z'),
      });
      const existing = makeOriginEntity({
        event_id: 'evt-changing',
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

    it('leaves unchanged events untouched — only source_last_seen_at is refreshed on the origin row', async () => {
      const vevent = makeVEvent({
        uid: 'stable@example.test',
        lastmodified: new Date('2026-04-22T10:00:00Z'),
      });
      const existing = makeOriginEntity({
        event_id: 'evt-stable',
        external_uid: 'stable@example.test',
        source_last_modified: new Date('2026-04-22T10:00:00Z'),
      });
      setupWith([vevent], [existing]);

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.eventsCreated).toBe(0);
      expect(result.eventsUpdated).toBe(0);
      expect(eventService.createEvent.called).toBe(false);
      expect(eventService.updateEvent.called).toBe(false);
      // The origin row's save() is invoked to stamp a fresh source_last_seen_at.
      expect((existing.save as sinon.SinonStub).called).toBe(true);
    });

    it('touchSourceLastSeen writes source_last_seen_at to the origin row, not the event', async () => {
      const vevent = makeVEvent({
        uid: 'seen@example.test',
        lastmodified: new Date('2026-04-22T10:00:00Z'),
      });
      const existing = makeOriginEntity({
        event_id: 'evt-seen',
        external_uid: 'seen@example.test',
        source_last_modified: new Date('2026-04-22T10:00:00Z'),
        source_last_seen_at: new Date('2026-04-01T00:00:00Z'),
      });
      setupWith([vevent], [existing]);

      await service.syncSource({ account, importSourceId: 'src-1' });

      // source_last_seen_at advanced on the origin row itself.
      expect(existing.source_last_seen_at).toBeInstanceOf(Date);
      expect((existing.source_last_seen_at as Date).getTime()).toBeGreaterThan(
        new Date('2026-04-01T00:00:00Z').getTime(),
      );
      expect((existing.save as sinon.SinonStub).called).toBe(true);
      // The save on the origin row must receive the transaction.
      const saveArgs = (existing.save as sinon.SinonStub).firstCall.args[0];
      expect(saveArgs).toMatchObject({ transaction: { LEVEL: 'test' } });
    });

    it('counts disappeared events without writing to them', async () => {
      const vevent = makeVEvent({ uid: 'present@example.test' });
      const present = makeOriginEntity({
        event_id: 'evt-present',
        external_uid: 'present@example.test',
        source_last_modified: null,
      });
      const gone = makeOriginEntity({
        event_id: 'evt-gone',
        external_uid: 'gone@example.test',
        source_last_seen_at: new Date('2026-04-01T00:00:00Z'),
      });
      setupWith([vevent], [present, gone]);

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.eventsDisappeared).toBe(1);
      // The disappeared origin row is NOT saved.
      expect((gone.save as sinon.SinonStub).called).toBe(false);
    });

    it('records partial parse failure when one VEVENT in a batch throws during mapping', async () => {
      // Three VEVENTs — the middle one is missing DTSTART, which causes the
      // real mapper to throw. The other two should still be created in the
      // same run, and the orchestrator should record an overall 'parse_error'
      // outcome with parseErrorCount > 0 while eventsCreated counts only the
      // successes.
      const veventA = makeVEvent({ uid: 'uid-a@example.test' });
      const veventB = makeVEvent({ uid: 'uid-b@example.test' });
      delete (veventB as Partial<VEvent>).start;
      const veventC = makeVEvent({ uid: 'uid-c@example.test' });

      const src = setupWith([veventA, veventB, veventC]);

      eventService.createEvent.callsFake(async () => ({ id: 'evt-any' } as never));

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.outcome).toBe('parse_error');
      expect(result.eventsCreated).toBe(2);
      expect(eventService.createEvent.callCount).toBe(2);
      expect(src.last_status).toBe('parse_error');
      expect(result.errorMessage).toBe('IMPORT_INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // VCALENDAR-level X-WR-TIMEZONE wiring
  // --------------------------------------------------------------------------

  describe('X-WR-TIMEZONE fallback wiring', () => {
    // The mapper's three-tier timezone resolution (TZID → X-WR-TIMEZONE → UTC)
    // is unit-tested in mapper.test.ts. These tests prove the orchestrator
    // actually extracts X-WR-TIMEZONE from `parsed.vcalendar` and threads it
    // into mapVEvent — without this the middle tier is permanently undefined
    // and an unrecognized TZID always falls through to UTC.

    function setupWithVcalendar(vevent: VEvent, vcalendar: Record<string, unknown> | null) {
      sandbox.stub(ImportSourceEntity, 'findByPk').resolves(makeSourceEntity());
      fetcher.fetch.resolves({
        outcome: 'ok',
        httpStatus: 200,
        body: Buffer.from('BEGIN:VCALENDAR...'),
        contentHash: 'HASH-CHANGED',
        etag: undefined,
        bytesReceived: 1,
      });
      sandbox.stub(EventImportOriginEntity, 'findAll').resolves([] as unknown as EventImportOriginEntity[]);

      service = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => {
          const parsed: Record<string, unknown> = { 'v-0': vevent };
          if (vcalendar) parsed.vcalendar = { type: 'VCALENDAR', ...vcalendar };
          return parsed as never;
        },
      });
    }

    it('threads parsed.vcalendar["WR-TIMEZONE"] into the mapper so unrecognized TZIDs resolve to the calendar fallback', async () => {
      // VEVENT carries a TZID node-ical does not recognize; the mapper would
      // otherwise drop straight to UTC.
      const vevent = makeVEvent({
        uid: 'fallback-needed@example.test',
        start: makeDtz('2026-04-22T10:00:00Z', 'Bogus/UnknownZone'),
        end: makeDtz('2026-04-22T11:00:00Z', 'Bogus/UnknownZone'),
      });
      setupWithVcalendar(vevent, { 'WR-TIMEZONE': 'America/Los_Angeles' });

      eventService.createEvent.callsFake(async () => ({ id: 'evt-x' } as never));

      await service.syncSource({ account, importSourceId: 'src-1' });

      expect(eventService.createEvent.calledOnce).toBe(true);
      const params = eventService.createEvent.firstCall.args[1] as Record<string, unknown>;
      const schedule = (params.schedules as Array<Record<string, unknown>>)[0];
      // 2026-04-22 is PDT — same UTC instant rendered in LA carries -07:00.
      expect(schedule.start).toMatch(/-07:00$|-08:00$/);
    });

    it('falls all the way to UTC when no WR-TIMEZONE is present and TZID is unrecognized', async () => {
      const vevent = makeVEvent({
        uid: 'no-fallback@example.test',
        start: makeDtz('2026-04-22T10:00:00Z', 'Bogus/UnknownZone'),
        end: makeDtz('2026-04-22T11:00:00Z', 'Bogus/UnknownZone'),
      });
      setupWithVcalendar(vevent, null);

      eventService.createEvent.callsFake(async () => ({ id: 'evt-x' } as never));

      await service.syncSource({ account, importSourceId: 'src-1' });

      expect(eventService.createEvent.calledOnce).toBe(true);
      const params = eventService.createEvent.firstCall.args[1] as Record<string, unknown>;
      const schedule = (params.schedules as Array<Record<string, unknown>>)[0];
      expect(schedule.start).toMatch(/Z$|\+00:00$/);
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
      sandbox.stub(EventImportOriginEntity, 'findAll').resolves([] as unknown as EventImportOriginEntity[]);

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
      expect(result.errorMessage).toBe('IMPORT_INTERNAL_ERROR');
      expect((ImportRunEntity.create as sinon.SinonStub).calledOnce).toBe(true);
    });

    it('does not leak raw error message (e.g. DB connection string) to ImportRun.error_message', async () => {
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
      sandbox.stub(EventImportOriginEntity, 'findAll').resolves([] as unknown as EventImportOriginEntity[]);

      service = new SyncService({
        eventService: eventService as unknown as EventService,
        calendarService: calendarService as unknown as CalendarService,
        fetcher: fetcher as unknown as Fetcher,
        rateLimiter,
        parseICS: () => ({ 'v-0': vevent } as never),
      });

      eventService.createEvent.rejects(new Error(leakyMessage));

      const result = await service.syncSource({ account, importSourceId: 'src-1' });

      expect(result.errorMessage).toBe('IMPORT_INTERNAL_ERROR');
      expect(result.errorMessage).not.toContain(leakyDbUrl);
      expect(result.errorMessage).not.toContain('s3cret');

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
      sandbox.stub(EventImportOriginEntity, 'findAll').resolves([] as unknown as EventImportOriginEntity[]);
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
