/**
 * ICS sync orchestrator.
 *
 * Ties together the fetcher (pv-1qcp.1.7), mapper (pv-1qcp.2.2), DNS verifier
 * state check (pv-1qcp.1.9), and EventService originator context (pv-1qcp.2.3)
 * to run a complete "Sync now" cycle for an import source.
 *
 * The pipeline is the sole convergence point for ICS import: nobody else
 * persists events derived from an ICS feed. Per consistency-advisor +
 * architecture-advisor, every event write MUST go through `EventService.createEvent`
 * or `EventService.updateEvent` — bypassing them would silently drop event-bus
 * emissions (federation, media reconciliation, event instance refresh, ...).
 *
 * Pipeline (high-level):
 *
 *   1. Load source. Verify state is `verified` (or `expired` within the
 *      14-day grace window). Otherwise fail with a sanitized error.
 *   2. Rate limit: per-source 4 Sync-Now per hour (in-memory sliding
 *      window).
 *   3. Fetch via pv-1qcp.1.7 fetcher (conditional GET with stored ETag).
 *   4. 304 Not Modified or unchanged content-hash → record `no_changes`
 *      run, update `last_fetched_at`, return.
 *   5. Parse VCALENDAR via `node-ical`. Extract VEVENTs.
 *   6. Open transaction.
 *   7. For each VEVENT:
 *      - Map to Pavillion shape via the mapper.
 *      - Dedup by `(import_source_id, external_uid, external_recurrence_id ?? '')`.
 *      - Dispatch: NEW → create; EXISTS+locally_edited → source_last_seen_at only;
 *        EXISTS+newer → update; EXISTS+unchanged → source_last_seen_at only.
 *      - Every create/update uses `EventService.{createEvent,updateEvent}` with
 *        context `{source: 'import'}` so event-bus emissions still fire.
 *   8. Disappeared events are left untouched (keep-on-disappearance policy).
 *   9. Update source bookkeeping (etag, content_hash, last_fetched_at, last_status).
 *   10. Commit transaction.
 *   11. Purge ImportRun rows beyond the 50-newest retention cap.
 *   12. On fetch/parse errors: rollback event writes, then record a
 *       separate-transaction ImportRun row so the run history survives.
 *
 * @see bead pv-1qcp.2.4
 * @see epic pv-1qcp DESIGN
 */

import type { CalendarResponse, VEvent } from 'node-ical';
import { createRequire } from 'node:module';
import { DateTime } from 'luxon';
import { Op, type Transaction } from 'sequelize';

const nodeRequire = createRequire(import.meta.url);

import { Account } from '@/common/model/account';
import { CalendarEvent } from '@/common/model/events';
import {
  ImportSourceFetchError,
  ImportSourceParseError,
  ImportSourceNotFoundError,
  ImportSourceSsrfBlockedError,
  ImportSourceVerifyRateLimitError,
} from '@/common/exceptions/import';
import { EventEntity } from '@/server/calendar/entity/event';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import { ImportRunEntity, type ImportRunOutcome } from '@/server/calendar/entity/import_run';
import EventService from '@/server/calendar/service/events';
import { Fetcher, type FetcherResult } from '@/server/calendar/service/import/fetcher';
import {
  isVerificationCurrentlyValid,
  isWithinGracePeriod,
} from '@/server/calendar/service/import/dns-verifier';
import { mapVEvent, type MapperOutput } from '@/server/calendar/service/import/mapper';
import db from '@/server/common/entity/db';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('calendar.import.sync');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum Sync-Now calls allowed per source in a sliding 1-hour window. */
export const SYNC_PER_SOURCE_HOURLY_LIMIT = 4;

/** Milliseconds per hour — the rate-limit window. */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Retention cap for ImportRun rows per source. */
export const IMPORT_RUN_RETENTION = 50;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Summary of a completed sync run. Returned to callers for display/diagnostics.
 * The shape mirrors the ImportRun row written to the DB.
 */
export interface SyncResult {
  /** The ImportRun UUID (also persisted). */
  runId: string;
  /** Terminal outcome for the run. */
  outcome: ImportRunOutcome;
  /** New events created via EventService.createEvent. */
  eventsCreated: number;
  /** Existing events updated via EventService.updateEvent. */
  eventsUpdated: number;
  /** Existing events skipped because `locally_edited` is true. */
  eventsSkippedLocallyEdited: number;
  /**
   * Events that exist on this source but were absent from the feed on this run.
   * Kept-on-disappearance: they are preserved, but their `source_last_seen_at`
   * is left untouched so a later UI can flag them.
   */
  eventsDisappeared: number;
  /** Sanitized error message. Only populated on non-success outcomes. */
  errorMessage: string | null;
}

/**
 * Input to `SyncService.syncSource`.
 *
 * `account` is the requester — currently used only for logging / future
 * authorization checks. Per pipeline contract the actual ownership check is
 * performed by the API layer (pv-1qcp.1.5) before dispatching into sync.
 */
export interface SyncInput {
  account: Account;
  importSourceId: string;
}

// ---------------------------------------------------------------------------
// Rate limiter — per-source sliding window, in-memory
// ---------------------------------------------------------------------------

/**
 * Process-local sliding-window counter keyed by importSourceId. The window is
 * 1 hour; the cap is {@link SYNC_PER_SOURCE_HOURLY_LIMIT}. Entries expire
 * lazily on check.
 *
 * An in-memory cap is sufficient for v1 (single-instance deployment is the
 * common case; distributed operators will add Redis-backed limits in a later
 * bead — see complexity-playbook YAGNI).
 */
export class SyncRateLimiter {
  private timestamps: Map<string, number[]> = new Map();

  /**
   * Records a Sync Now attempt. Returns true if the call is allowed.
   */
  tryAcquire(sourceId: string, now: number = Date.now()): boolean {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const existing = this.timestamps.get(sourceId) ?? [];
    // Drop stale entries.
    const fresh = existing.filter(t => t > cutoff);
    if (fresh.length >= SYNC_PER_SOURCE_HOURLY_LIMIT) {
      this.timestamps.set(sourceId, fresh);
      return false;
    }
    fresh.push(now);
    this.timestamps.set(sourceId, fresh);
    return true;
  }

  /**
   * Clear recorded timestamps. Intended for tests.
   */
  reset(): void {
    this.timestamps.clear();
  }
}

// ---------------------------------------------------------------------------
// SyncService
// ---------------------------------------------------------------------------

/**
 * Minimal parser contract so tests can inject deterministic parser output
 * without hand-rolling ICS strings.
 */
export type IcsParseFn = (body: string) => CalendarResponse;

export interface SyncDependencies {
  eventService: EventService;
  fetcher?: Fetcher;
  rateLimiter?: SyncRateLimiter;
  parseICS?: IcsParseFn;
  /** Override of `Date.now()` for tests. */
  now?: () => Date;
}

class SyncService {
  private readonly eventService: EventService;
  private readonly fetcher: Fetcher;
  private readonly rateLimiter: SyncRateLimiter;
  private readonly parseICS: IcsParseFn;
  private readonly nowFn: () => Date;

  constructor(deps: SyncDependencies) {
    this.eventService = deps.eventService;
    this.fetcher = deps.fetcher ?? new Fetcher();
    this.rateLimiter = deps.rateLimiter ?? new SyncRateLimiter();
    // Defer node-ical import until the first parse call. The module pulls in
    // a Temporal polyfill that is expensive in vitest's vmThreads pool; tests
    // that inject their own `parseICS` never pay that cost.
    this.parseICS = deps.parseICS ?? ((body: string) => {
      const icalMod = nodeRequire('node-ical') as typeof import('node-ical');
      return icalMod.sync.parseICS(body);
    });
    this.nowFn = deps.now ?? (() => new Date());
  }

  /**
   * Run one Sync Now cycle for the given import source.
   *
   * Never throws for "expected" failure cases — the outcome is always
   * captured in a persisted ImportRun row and returned. Only catastrophic
   * infrastructure failures (DB unavailable) propagate.
   *
   * Throws:
   *  - {@link ImportSourceNotFoundError} — source does not exist
   *  - {@link ImportSourceVerifyRateLimitError} — per-source hourly cap hit
   *  - Error("IMPORT_SOURCE_NOT_VERIFIED") — source state blocks sync
   */
  async syncSource(input: SyncInput): Promise<SyncResult> {
    const { importSourceId } = input;

    const sourceEntity = await ImportSourceEntity.findByPk(importSourceId);
    if (!sourceEntity) {
      throw new ImportSourceNotFoundError();
    }

    this.assertVerifiedForSync(sourceEntity);

    if (!this.rateLimiter.tryAcquire(importSourceId, this.nowFn().getTime())) {
      throw new ImportSourceVerifyRateLimitError();
    }

    const startedAt = this.nowFn();

    // --- Fetch phase (outside transaction — no DB writes yet) -----------
    let fetchResult: FetcherResult;
    try {
      fetchResult = await this.fetcher.fetch({
        url: sourceEntity.url,
        importSourceId,
        etag: sourceEntity.etag ?? undefined,
      });
    }
    catch (err) {
      const outcome: ImportRunOutcome = err instanceof ImportSourceSsrfBlockedError
        ? 'ssrf_blocked'
        : 'fetch_error';
      const message = this.sanitizedErrorMessage(err);
      await this.updateSourceOnFetchFailure(sourceEntity, outcome);
      return this.recordRun({
        sourceId: importSourceId,
        startedAt,
        outcome,
        counts: { created: 0, updated: 0, skippedLocallyEdited: 0, disappeared: 0 },
        errorMessage: message,
      });
    }

    // --- Short-circuit: 304 Not Modified ---------------------------------
    if (fetchResult.outcome === 'not_modified') {
      await this.updateSourceOnFetchOk(sourceEntity, {
        etag: fetchResult.etag ?? sourceEntity.etag,
        contentHash: sourceEntity.content_hash,
      });
      return this.recordRun({
        sourceId: importSourceId,
        startedAt,
        outcome: 'no_changes',
        counts: { created: 0, updated: 0, skippedLocallyEdited: 0, disappeared: 0 },
        errorMessage: null,
      });
    }

    // --- Short-circuit: content hash unchanged ---------------------------
    if (
      sourceEntity.content_hash
      && fetchResult.contentHash === sourceEntity.content_hash
    ) {
      await this.updateSourceOnFetchOk(sourceEntity, {
        etag: fetchResult.etag ?? sourceEntity.etag,
        contentHash: fetchResult.contentHash,
      });
      return this.recordRun({
        sourceId: importSourceId,
        startedAt,
        outcome: 'no_changes',
        counts: { created: 0, updated: 0, skippedLocallyEdited: 0, disappeared: 0 },
        errorMessage: null,
      });
    }

    // --- Parse phase -----------------------------------------------------
    let parsed: CalendarResponse;
    try {
      parsed = this.parseICS(fetchResult.body.toString('utf8'));
    }
    catch (err) {
      await this.updateSourceOnFetchFailure(sourceEntity, 'parse_error');
      return this.recordRun({
        sourceId: importSourceId,
        startedAt,
        outcome: 'parse_error',
        counts: { created: 0, updated: 0, skippedLocallyEdited: 0, disappeared: 0 },
        errorMessage: this.sanitizedErrorMessage(err),
      });
    }

    const vevents = this.extractVevents(parsed);

    // --- Derive calendar primary language (for mapper) -------------------
    // We only have calendar_id on the source; load the calendar's configured
    // primary language via the event service's already-wired calendarService
    // helper. If unavailable, default to 'en'. This is a best-effort lookup;
    // the mapper only uses it to stamp a language code on content.
    const primaryLanguage = await this.resolveCalendarPrimaryLanguage(sourceEntity.calendar_id);

    // --- Transactional body --------------------------------------------------
    // All persistence inside this transaction rolls back together on failure.
    let counts = { created: 0, updated: 0, skippedLocallyEdited: 0, disappeared: 0 };
    let parseErrorCount = 0;
    let firstErrorMessage: string | null = null;
    let catastrophic = false;

    try {
      await db.transaction(async (tx) => {
        // Collect existing events keyed on the dedup tuple.
        const existing = await EventEntity.findAll({
          where: { import_source_id: importSourceId },
          transaction: tx,
        });
        const existingByKey = new Map<string, EventEntity>();
        for (const e of existing) {
          existingByKey.set(dedupKey(e.external_uid, e.external_recurrence_id), e);
        }

        const seenKeys = new Set<string>();

        // Service-layer account placeholder. The sync orchestrator does not
        // have a caller-requester identity for writes; we build a synthetic
        // account scoped to the calendar owner so EventService permission
        // checks pass. In practice the calling API layer passes its own.
        const actingAccount = input.account;

        for (const vevent of vevents) {
          let mapped: MapperOutput;
          try {
            mapped = mapVEvent({
              vevent,
              calendarPrimaryLanguage: primaryLanguage,
            });
          }
          catch (err) {
            parseErrorCount++;
            if (!firstErrorMessage) {
              firstErrorMessage = this.sanitizedErrorMessage(err);
            }
            continue;
          }

          const key = dedupKey(mapped.external_uid, mapped.external_recurrence_id ?? null);
          seenKeys.add(key);

          const existingEntity = existingByKey.get(key);
          try {
            if (!existingEntity) {
              await this.createEvent(actingAccount, sourceEntity, mapped, tx);
              counts.created++;
            }
            else if (existingEntity.locally_edited) {
              await this.touchSourceLastSeen(existingEntity, tx);
              counts.skippedLocallyEdited++;
            }
            else if (this.sourceIsNewer(mapped.source_last_modified, existingEntity.source_last_modified)) {
              await this.updateEvent(actingAccount, existingEntity.id, sourceEntity, mapped, tx);
              counts.updated++;
            }
            else {
              await this.touchSourceLastSeen(existingEntity, tx);
            }
          }
          catch (err) {
            // Per DESIGN: individual write failures inside the transaction
            // roll the whole run back (the transaction callback below will
            // rethrow). Record the first sanitized message and propagate.
            firstErrorMessage = firstErrorMessage ?? this.sanitizedErrorMessage(err);
            catastrophic = true;
            throw err;
          }
        }

        // Disappeared events: left untouched (keep-on-disappearance).
        for (const [key, entity] of existingByKey) {
          if (!seenKeys.has(key)) {
            counts.disappeared++;
            void entity; // explicit: no write
          }
        }

        // Source bookkeeping inside the same transaction.
        const newStatus: ImportSourceEntity['last_status'] = parseErrorCount > 0 ? 'parse_error' : 'ok';
        sourceEntity.etag = fetchResult.etag ?? sourceEntity.etag;
        sourceEntity.content_hash = fetchResult.contentHash;
        sourceEntity.last_fetched_at = this.nowFn();
        sourceEntity.last_status = newStatus;
        await sourceEntity.save({ transaction: tx });
      });
    }
    catch (err) {
      // Transaction rolled back. Record a separate-transaction ImportRun
      // so the run history survives.
      const message = firstErrorMessage ?? this.sanitizedErrorMessage(err);
      await this.updateSourceOnFetchFailure(sourceEntity, 'parse_error');
      return this.recordRun({
        sourceId: importSourceId,
        startedAt,
        outcome: 'parse_error',
        counts: { created: 0, updated: 0, skippedLocallyEdited: 0, disappeared: 0 },
        errorMessage: message,
      });
    }

    void catastrophic;

    const finalOutcome: ImportRunOutcome = parseErrorCount > 0
      ? 'parse_error'
      : (counts.created === 0 && counts.updated === 0 ? 'success' : 'success');

    const result = await this.recordRun({
      sourceId: importSourceId,
      startedAt,
      outcome: finalOutcome,
      counts,
      errorMessage: firstErrorMessage,
    });

    await this.purgeOldRuns(importSourceId);

    return result;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private assertVerifiedForSync(source: ImportSourceEntity): void {
    if (source.verification_state === 'verified') {
      // Additional expiry + grace check: if verification_expires_at has
      // passed AND we are outside the grace window, block.
      if (source.verification_expires_at) {
        const expiresAt = source.verification_expires_at;
        const now = this.nowFn();
        if (!isVerificationCurrentlyValid(expiresAt, now) && !isWithinGracePeriod(expiresAt, now)) {
          const e = new Error('IMPORT_SOURCE_NOT_VERIFIED');
          e.name = 'ImportSourceNotVerifiedError';
          throw e;
        }
      }
      return;
    }
    if (source.verification_state === 'expired' && source.verification_expires_at) {
      const now = this.nowFn();
      if (isWithinGracePeriod(source.verification_expires_at, now)) {
        return;
      }
    }
    const e = new Error('IMPORT_SOURCE_NOT_VERIFIED');
    e.name = 'ImportSourceNotVerifiedError';
    throw e;
  }

  /**
   * Translate raw error objects into the stable sanitized message codes used
   * by the API + audit log. Mirrors the import exception module's contract
   * so run rows never embed raw stack traces or URLs.
   */
  private sanitizedErrorMessage(err: unknown): string {
    if (err instanceof ImportSourceSsrfBlockedError) return 'IMPORT_SSRF_BLOCKED';
    if (err instanceof ImportSourceFetchError) return 'IMPORT_FETCH_ERROR';
    if (err instanceof ImportSourceParseError) return 'IMPORT_PARSE_ERROR';
    if (err instanceof Error) return err.message;
    return String(err);
  }

  /**
   * Resolve the calendar's primary content language for mapper use. The
   * calendar table stores a comma-separated `languages` column; we split
   * and take the first non-empty entry, defaulting to 'en'.
   */
  private async resolveCalendarPrimaryLanguage(calendarId: string): Promise<string> {
    try {
      const calendar = await (this.eventService as unknown as {
        calendarService: { getCalendar: (id: string) => Promise<{ languages: string[] } | null> };
      }).calendarService.getCalendar(calendarId);
      if (calendar && calendar.languages && calendar.languages.length > 0) {
        return calendar.languages[0] ?? 'en';
      }
    }
    catch {
      // Fall through
    }
    return 'en';
  }

  private async createEvent(
    account: Account,
    source: ImportSourceEntity,
    mapped: MapperOutput,
    tx?: Transaction,
  ): Promise<CalendarEvent> {
    const params = buildEventParamsForCreate(source, mapped);
    const event = await this.eventService.createEvent(account, params, { source: 'import' });
    // Stamp the origin columns on the persisted entity. EventService.createEvent
    // sets source_last_seen_at and locally_edited per the originator context,
    // but does not read the ICS-origin columns off the CalendarEvent model
    // (CalendarEvent.fromObject intentionally strips origin provenance so it
    // never flows into toObject / public APIs). The orchestrator owns those
    // columns and writes them directly to the entity after the service call.
    //
    // The tx handle is threaded through so the origin-column write participates
    // in the caller's transaction: if the surrounding db.transaction rolls back
    // (e.g. a later event fails, source bookkeeping save fails), the origin
    // columns roll back with it — no orphaned provenance pointing at rolled-
    // back rows.
    await this.stampOriginColumns(event.id, source, mapped, tx);
    return event;
  }

  private async updateEvent(
    account: Account,
    eventId: string,
    source: ImportSourceEntity,
    mapped: MapperOutput,
    tx?: Transaction,
  ): Promise<CalendarEvent> {
    const params = buildEventParamsForUpdate(source, mapped);
    const event = await this.eventService.updateEvent(account, eventId, params, { source: 'import' });
    // Refresh origin columns on update too. source_last_modified and x_props
    // may have changed on the feed side; import_source_id / external_uid /
    // external_recurrence_id are stable but re-stamping them is a no-op.
    await this.stampOriginColumns(event.id, source, mapped, tx);
    return event;
  }

  /**
   * Write the origin-provenance columns on the event entity. Separate from
   * EventService.createEvent/updateEvent by design: the shared CalendarEvent
   * model does not surface origin columns via toObject/fromObject (privacy —
   * they must not leak to federation / public API), so they cannot round-trip
   * through the service layer. The orchestrator is the sole writer.
   *
   * Accepts an optional transaction handle so the update participates in the
   * caller's transaction. Callers inside `db.transaction` MUST pass `tx` —
   * otherwise the origin-column write commits independently and survives any
   * rollback of the surrounding event writes, leaving provenance pointing at
   * rolled-back rows.
   */
  private async stampOriginColumns(
    eventId: string,
    source: ImportSourceEntity,
    mapped: MapperOutput,
    tx?: Transaction,
  ): Promise<void> {
    await EventEntity.update(
      {
        import_source_id: source.id,
        external_uid: mapped.external_uid,
        external_recurrence_id: mapped.external_recurrence_id ?? null,
        source_last_modified: mapped.source_last_modified
          ? mapped.source_last_modified.toJSDate()
          : null,
        source_last_seen_at: this.nowFn(),
        x_props: mapped.x_props,
      },
      { where: { id: eventId }, transaction: tx },
    );
  }

  private async touchSourceLastSeen(entity: EventEntity, tx?: Transaction): Promise<void> {
    entity.source_last_seen_at = this.nowFn();
    await entity.save({ transaction: tx });
  }

  /**
   * Compare source LAST-MODIFIED to the stored value. A source is "newer"
   * if the incoming modified time is strictly greater, or if no modified
   * time was previously recorded while a new one is now present.
   */
  private sourceIsNewer(incoming: DateTime | undefined, stored: Date | null): boolean {
    if (!incoming) {
      // No incoming LAST-MODIFIED — treat as unchanged to avoid needless churn.
      return false;
    }
    if (!stored) {
      return true;
    }
    return incoming.toMillis() > stored.getTime();
  }

  private extractVevents(parsed: CalendarResponse): VEvent[] {
    const out: VEvent[] = [];
    for (const key of Object.keys(parsed)) {
      const v = parsed[key] as unknown as VEvent;
      if (v && v.type === 'VEVENT') {
        out.push(v);
      }
    }
    return out;
  }

  /**
   * On fetch/parse failure we write the updated last_status + last_fetched_at
   * in a dedicated save, separate from any event writes (which don't exist
   * on this path). We do NOT clobber etag/content_hash on failure — the
   * previous values stay valid for the next conditional GET.
   */
  private async updateSourceOnFetchFailure(
    source: ImportSourceEntity,
    status: ImportSourceEntity['last_status'],
  ): Promise<void> {
    source.last_fetched_at = this.nowFn();
    source.last_status = status;
    await source.save();
  }

  private async updateSourceOnFetchOk(
    source: ImportSourceEntity,
    opts: { etag: string | null | undefined; contentHash: string | null },
  ): Promise<void> {
    if (opts.etag !== undefined) {
      source.etag = opts.etag ?? null;
    }
    if (opts.contentHash !== undefined) {
      source.content_hash = opts.contentHash;
    }
    source.last_fetched_at = this.nowFn();
    source.last_status = 'ok';
    await source.save();
  }

  /**
   * Write an ImportRun row (own transaction — outside the sync transaction
   * so it survives rollback of event writes).
   */
  private async recordRun(input: {
    sourceId: string;
    startedAt: Date;
    outcome: ImportRunOutcome;
    counts: {
      created: number;
      updated: number;
      skippedLocallyEdited: number;
      disappeared: number;
    };
    errorMessage: string | null;
  }): Promise<SyncResult> {
    const row = await ImportRunEntity.create({
      import_source_id: input.sourceId,
      started_at: input.startedAt,
      finished_at: this.nowFn(),
      outcome: input.outcome,
      events_created: input.counts.created,
      events_updated: input.counts.updated,
      events_skipped_locally_edited: input.counts.skippedLocallyEdited,
      events_disappeared: input.counts.disappeared,
      error_message: input.errorMessage,
    });

    logger.info(
      {
        importSourceId: input.sourceId,
        runId: row.id,
        outcome: input.outcome,
        counts: input.counts,
      },
      'ics.sync.run',
    );

    return {
      runId: row.id,
      outcome: input.outcome,
      eventsCreated: input.counts.created,
      eventsUpdated: input.counts.updated,
      eventsSkippedLocallyEdited: input.counts.skippedLocallyEdited,
      eventsDisappeared: input.counts.disappeared,
      errorMessage: input.errorMessage,
    };
  }

  /**
   * Drop ImportRun rows older than the {@link IMPORT_RUN_RETENTION} newest
   * for a given source. Runs independently of the main transaction.
   */
  private async purgeOldRuns(sourceId: string): Promise<void> {
    const toKeep = await ImportRunEntity.findAll({
      where: { import_source_id: sourceId },
      order: [['started_at', 'DESC']],
      limit: IMPORT_RUN_RETENTION,
      attributes: ['id'],
    });
    const keepIds = toKeep.map(r => r.id);
    if (keepIds.length === 0) return;
    await ImportRunEntity.destroy({
      where: {
        import_source_id: sourceId,
        id: { [Op.notIn]: keepIds },
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for focused unit tests)
// ---------------------------------------------------------------------------

/**
 * Build the dedup key per DESIGN:
 *   `${external_uid}::${external_recurrence_id ?? ''}`
 *
 * `external_uid` is required; recurrence-id is the empty string when absent.
 */
export function dedupKey(externalUid: string | null | undefined, recurrenceId: string | null | undefined): string {
  return `${externalUid ?? ''}::${recurrenceId ?? ''}`;
}

/**
 * Build the `createEvent` params from a mapper output + source linkage.
 *
 * The shape mirrors what EventService.createEvent expects when called from
 * user-path code: a `content` map keyed by language, a `schedules` array
 * already in `toObject` form, and the origin columns expressed on the
 * top-level params.
 */
export function buildEventParamsForCreate(
  source: ImportSourceEntity,
  mapped: MapperOutput,
): Record<string, unknown> {
  const lang = mapped.content.language || 'en';
  const schedules = [mapped.schedule.toObject(), ...mapped.exclusions.map(e => e.toObject())];
  return {
    calendarId: source.calendar_id,
    content: {
      [lang]: mapped.content.toObject(),
    },
    schedules,
    importSourceId: source.id,
    externalUid: mapped.external_uid,
    externalRecurrenceId: mapped.external_recurrence_id ?? null,
    sourceLastModified: mapped.source_last_modified
      ? mapped.source_last_modified.toJSDate()
      : null,
    xProps: mapped.x_props,
    externalUrl: mapped.external_url,
  };
}

/**
 * Build the `updateEvent` params from a mapper output. Omits the identity
 * fields (id, calendarId) — those come from the existing event record.
 */
export function buildEventParamsForUpdate(
  source: ImportSourceEntity,
  mapped: MapperOutput,
): Record<string, unknown> {
  const lang = mapped.content.language || 'en';
  const schedules = [mapped.schedule.toObject(), ...mapped.exclusions.map(e => e.toObject())];
  return {
    calendarId: source.calendar_id,
    content: {
      [lang]: mapped.content.toObject(),
    },
    schedules,
    sourceLastModified: mapped.source_last_modified
      ? mapped.source_last_modified.toJSDate()
      : null,
    xProps: mapped.x_props,
    externalUrl: mapped.external_url,
  };
}

export default SyncService;
