/**
 * ActivityPub follow-backfill worker service.
 *
 * Pulls a remote calendar's outbox after a confirmed Accept(Follow), runs
 * pre-write trust gates against each Create/Update/Announce/Undo/Delete
 * activity, and persists survivors as real `ap_inbox` rows tagged with
 * `auth_source = 'outbox_pull'` and `auth_origin = <source actor origin>`.
 * The service only writes rows; it never drains the inbox. The web process
 * drains it, with the domain handlers installed, on its own schedule.
 *
 * Buffered, oldest-first writes
 * -----------------------------
 * The outbox is walked newest first, but the web-process drain can run at any
 * moment during the walk. Writing each page as it is walked would let a drain
 * dispatch an Undo(Announce) before the older Announce it references is
 * written; the strict Undo cross-check then no-ops and the share sticks when
 * the Announce arrives (DEC-013). So the walk keeps every activity that passes
 * the trust gates in an in-memory buffer, and only when the walk ends normally
 * (no next page, page or buffer cap reached, next URL refused, page
 * unreachable) writes the buffer sorted by clamped `message_time` ascending,
 * one row at a time. Any drain that runs during those writes sees an
 * oldest-first prefix of the walk, in which every Announce precedes any Undo
 * that references it. A walk that ends on rate-limit exhaustion or on an
 * unfollow writes nothing; the follow row is re-checked at every page boundary
 * and once more immediately before the write.
 *
 * Every write goes through the deferred inbox entry point
 * `activityPubInterface.enqueueInboxRow()` — the same `findOrCreate` (first
 * writer wins, no upgrade on conflict) as the live path, but with no
 * `inboxMessageAdded` event — and the standard inbox drain handles dispatch
 * order and idempotency. The trust gates that the live HTTP path gets for
 * free from signature middleware are run here at buffer time, before any DB
 * insert.
 *
 * Trust posture (pre-write, per activity)
 * ---------------------------------------
 *   1. All: `actor` URL exists and shares an origin with the source actor URI.
 *   2. Create/Update: if `object` is embedded, `object.attributedTo === actor`;
 *      if `object` is a bare URI, the URI's hostname matches the actor's.
 *   3. Announce: actor equals the source actor URI OR shares its origin
 *      (allows alias actors on the same instance).
 *   4. Undo: actor-origin check only; the strict cross-check against the
 *      referenced Announce in `ap_inbox` happens at dispatch time, NOT here.
 *   5. Delete: actor-origin check only; the inbox Delete handler is
 *      idempotent so per-page cross-checks are unnecessary.
 *   6. Loop guard (all): drop the activity if an embedded `object.attributedTo`
 *      equals the local follower calendar's actor URI.
 *
 * Hard caps
 * ---------
 * `MAX_OUTBOX_PAGES = 50` and `MAX_PAGE_BYTES = 1_048_576` bound the worst
 * case: a misbehaving peer cannot exhaust the worker by serving an
 * unbounded `next` chain or by returning a multi-megabyte page. Reaching
 * the page cap emits one warn-level log line; pages larger than the byte
 * cap are dropped by the underlying axios client (which returns null).
 *
 * `MAX_BACKFILL_BUFFER_BYTES = 8 MiB` bounds the buffer itself, since the
 * page caps alone would let a peer hold up to 50 MiB of activities in worker
 * memory. Each buffered activity counts as its serialized length (size, not
 * items: one activity can be close to a whole page). That length is
 * `JSON.stringify(...).length`, in UTF-16 code units, so the cap bounds the
 * serialized JSON rather than the heap: the parsed objects held in the buffer
 * can take about an order of magnitude more memory. When the next activity
 * would exceed the cap the walk stops there, emits one warn-level log line,
 * and writes the buffer as a normal end. Like the page cap, truncation keeps
 * a contiguous newest-first run; an Undo whose Announce fell beyond the cap
 * no-ops at dispatch.
 *
 * Rate limiting
 * -------------
 * A shared {@link SyncRateLimiter} (60 acquisitions per minute, keyed by
 * source hostname) gates the outbound requests. The limiter is a
 * module-scope singleton so multiple concurrent backfill jobs against the
 * same host share one budget. A single job needs at most ~53 requests
 * (profile + outbox + first page + {@link MAX_OUTBOX_PAGES}) so it cannot
 * self-exhaust the budget; exhaustion happens under contention, when several
 * jobs target the same host at once. When the budget is exhausted mid-walk,
 * the run discards its buffer, writes nothing, and throws
 * {@link BackfillRateLimitError} so pg-boss re-queues the job; the
 * {@link BACKFILL_RETRY_DELAY_SECONDS} retry delay gives the sliding window
 * time to reset before the re-walk from the start, which is idempotent via
 * `findOrCreate`.
 *
 * Why `enqueueInboxRow` and not `addToInbox`
 * ------------------------------------------
 * The two share one writer (`writeInboxRow`) but differ on emission and time
 * policy. `addToInbox` emits an `inboxMessageAdded` event per row, which would
 * cause the live inbox subscription to drain backfill rows one-by-one in
 * arrival order rather than in chronological `message_time` order; it also
 * uses `message.published` verbatim. `enqueueInboxRow` emits nothing — the
 * web-process drain picks the rows up — and accepts an already-resolved
 * `messageTime`, so backfill applies the {@link clampMessageTime} sanity
 * window (using its injected clock) before calling, preventing a
 * misconfigured peer from injecting far-future or year-2003 rows that
 * re-order the inbox queue. Pre-write trust gates plus the unique-id
 * `findOrCreate` underneath give the same security invariants as the live
 * path without the event emission.
 */

import { ActivityPubFollowAcceptedPayload } from '@/server/activitypub/events/types';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import { ActivityPubActor } from '@/server/activitypub/model/base';
import { clampMessageTime } from '@/server/activitypub/helper/clamp-message-time';
import { ActivityIdOriginMismatchError } from '@/server/activitypub/helper/activity-id-origin';
import { fetchRemoteObject } from '@/server/activitypub/helper/remote-fetch';
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';
import { createLogger } from '@/server/common/helper/logger';
import { logError } from '@/server/common/helper/error-logger';
import { SyncRateLimiter } from '@/server/common/helper/rate-limiter';

const logger = createLogger('activitypub.backfill');

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Hard cap on the number of outbox pages a single backfill will walk. */
export const MAX_OUTBOX_PAGES = 50;

/** Per-page response-body byte cap enforced on every outbound GET. */
export const MAX_PAGE_BYTES = 1_048_576;

/** Cap on the serialized size of the activities one walk buffers in memory. */
export const MAX_BACKFILL_BUFFER_BYTES = 8 * 1024 * 1024;

/** Per-host outbound request budget for outbox pulls. */
const RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * pg-boss retry policy for the `activitypub:follow:backfill` job, applied at
 * publish time (see `ActivityPubEventHandlers.handleFollowAccepted`). The
 * delay must be at least the rate-limit window so a job that paused on an
 * exhausted budget finds the sliding window reset on its next attempt;
 * shorter delays would just burn retries against a still-full budget.
 */
export const BACKFILL_RETRY_LIMIT = 5;
export const BACKFILL_RETRY_DELAY_SECONDS = RATE_LIMIT_WINDOW_MS / 1000;
export const BACKFILL_RETRY_BACKOFF = true;
/**
 * Job-expiry ceiling. Generous relative to the rate window so a legitimately
 * slow multi-page walk is not declared expired and re-run concurrently with
 * itself (the writes are idempotent, but a concurrent re-run wastes budget).
 */
export const BACKFILL_EXPIRE_SECONDS = 600;

/** Activity types this worker accepts from the outbox. Anything else is skipped silently. */
const SUPPORTED_TYPES = new Set(['Create', 'Update', 'Announce', 'Undo', 'Delete']);

// ---------------------------------------------------------------------------
// Module-scope singletons
// ---------------------------------------------------------------------------

/**
 * Shared limiter keyed by source hostname. A module-scope singleton lets
 * multiple concurrent backfill jobs against the same host share one budget,
 * which matches the published "60 req/min per source" contract rather than
 * "60 req/min per job".
 *
 * Exported for test reset only — production code paths must not reach in
 * here directly.
 */
export const backfillRateLimiter = new SyncRateLimiter({
  limit: RATE_LIMIT_PER_MINUTE,
  windowMs: RATE_LIMIT_WINDOW_MS,
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Signals that a backfill run paused because the per-host outbound request
 * budget was exhausted before the outbox was fully walked. Thrown by
 * {@link FollowBackfillService.runBackfill} with nothing written — the partial
 * walk's buffer is discarded — so pg-boss re-queues the job and the whole
 * outbox is re-walked on a later attempt once the rate window has reset.
 * Distinct from a catastrophic failure: the peer is healthy, we simply hit
 * our own throttle.
 */
export class BackfillRateLimitError extends Error {
  constructor(host: string) {
    super(`backfill paused: per-host rate limit exhausted for ${host}`);
    this.name = 'BackfillRateLimitError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Dependencies the backfill service needs from the host process. Defaults are
 * supplied by the production constructor so the worker entry point can hand
 * the service a fresh event bus without wiring every collaborator manually;
 * tests inject mocks here to exercise the trust/pagination/cap logic without
 * standing up a real federation context.
 */
export interface BackfillDependencies {
  activityPubInterface: ActivityPubInterface;
  calendarInterface: CalendarInterface;
  /** Limiter override for tests. Production code uses the module-scope singleton. */
  rateLimiter?: SyncRateLimiter;
  /** Fetcher override for tests. Production code uses fetchRemoteObject. */
  fetcher?: typeof fetchRemoteObject;
  /** Clock override for tests. Production code uses `new Date()`. */
  now?: () => Date;
  /** Buffer cap override for tests. Production code uses {@link MAX_BACKFILL_BUFFER_BYTES}. */
  maxBufferBytes?: number;
}

/**
 * Walks the remote outbox identified by `payload` and, when the walk ends
 * normally, persists the surviving activities into `ap_inbox` oldest first.
 * Designed to be invoked from `worker.ts`'s `activitypub:follow:backfill`
 * job subscription.
 */
export class FollowBackfillService {
  private readonly activityPubInterface: ActivityPubInterface;
  private readonly calendarInterface: CalendarInterface;
  private readonly rateLimiter: SyncRateLimiter;
  private readonly fetcher: typeof fetchRemoteObject;
  private readonly now: () => Date;
  private readonly maxBufferBytes: number;

  constructor(deps: BackfillDependencies) {
    this.activityPubInterface = deps.activityPubInterface;
    this.calendarInterface = deps.calendarInterface;
    this.rateLimiter = deps.rateLimiter ?? backfillRateLimiter;
    this.fetcher = deps.fetcher ?? fetchRemoteObject;
    this.now = deps.now ?? (() => new Date());
    this.maxBufferBytes = deps.maxBufferBytes ?? MAX_BACKFILL_BUFFER_BYTES;
  }

  /**
   * Run a single backfill job to completion. Never throws for "done"
   * conditions (follow removed, source unreachable, malformed page, cap
   * reached) — those exit cleanly so pg-boss does not loop on a
   * permanently-broken peer. Catastrophic infrastructure failures (DB
   * unavailable while loading the follow row) propagate so the job retries.
   * Rate-limit exhaustion throws {@link BackfillRateLimitError} (see the
   * module header).
   *
   * Writes the buffered walk only when it ends normally and the follow row
   * still exists immediately before the write. The run never drains the
   * inbox; the web process does.
   */
  async runBackfill(payload: ActivityPubFollowAcceptedPayload): Promise<void> {
    const { followingCalendarId, calendarActorId, sourceActorUri } = payload;

    // Resolve `auth_origin` once: the source actor URI's origin is the
    // verified-by-signed-GET identity that admitted every row in this run.
    let authOrigin: string;
    try {
      authOrigin = new URL(sourceActorUri).origin;
    }
    catch {
      logger.warn({ followingCalendarId, sourceActorUri }, 'backfill abort: sourceActorUri is not a valid URL');
      return;
    }

    // 1. Verify the follow row still exists at job start. The Accept that
    // triggered this job could be racing an unfollow; if the user is no
    // longer following, dropping their backfill is the right answer.
    // The payload's `followingCalendarId` is the local Calendar's id
    // (FollowingCalendarEntity.calendar_id, not the row PK); combined with
    // calendarActorId it uniquely identifies the follow relationship.
    const followRow = await FollowingCalendarEntity.findOne({
      where: {
        calendar_id: followingCalendarId,
        calendar_actor_id: calendarActorId,
      },
    });
    if (!followRow) {
      logger.info({ followingCalendarId, calendarActorId }, 'follow row missing at job start; skipping backfill');
      return;
    }

    const calendar = await this.calendarInterface.getCalendar(followRow.calendar_id);
    if (!calendar) {
      logger.warn({ followingCalendarId, sourceActorUri, calendarId: followRow.calendar_id }, 'follower calendar missing; skipping backfill');
      return;
    }

    const localActorUri = ActivityPubActor.actorUrl(calendar);
    const ctx: WalkContext = {
      followingCalendarId,
      calendarActorId,
      sourceActorUri,
      authOrigin,
      calendar,
      localActorUri,
    };

    const buffer: WalkBuffer = { entries: [], bytes: 0 };
    let end = await this.walkOutbox(ctx, buffer);

    // The page-boundary re-checks cannot see an unfollow that lands after the
    // last one; check once more so an unfollowed calendar gets nothing written.
    if (end === 'complete' && !(await this.isStillFollowing(ctx))) {
      end = 'unfollowed';
    }

    // A partial walk must not be written; pg-boss re-walks it after the delay.
    if (end === 'rate_limited') {
      logger.info({ followingCalendarId, sourceActorUri, discardedRows: buffer.entries.length }, 'backfill paused on rate limit; buffer discarded');
      throw new BackfillRateLimitError(authOrigin);
    }
    if (end === 'unfollowed') {
      logger.info({ followingCalendarId, calendarActorId, discardedRows: buffer.entries.length }, 'follow row removed during backfill; buffer discarded');
      return;
    }

    const persistedRows = await this.writeBuffer(buffer.entries, ctx);
    logger.info(
      { followingCalendarId, sourceActorUri, bufferedRows: buffer.entries.length, persistedRows },
      'backfill run finished; rows written oldest first',
    );
  }

  /**
   * Walks the source outbox page-by-page, pushing every activity that passes
   * the trust gates onto `buffer` until the buffer cap is reached. Writes
   * nothing. Returns how the walk ended ({@link WalkEnd}): the caller writes
   * the buffer only on `'complete'`.
   */
  private async walkOutbox(ctx: WalkContext, buffer: WalkBuffer): Promise<WalkEnd> {
    // 2. Fetch the source actor profile so we read the *current* outbox URL
    // rather than whatever URL the federation handshake cached. Validate
    // first because the source URI is attacker-influenced (came in via
    // Accept(Follow)).
    if (!(await this.assertUrlPublic(ctx.sourceActorUri))) {
      return 'complete';
    }
    if (!(await this.acquireRateBudget(ctx.sourceActorUri))) {
      return 'rate_limited';
    }
    const actorProfile = await this.fetcher(ctx.sourceActorUri, { calendar: ctx.calendar, calendarInterface: this.calendarInterface }, { maxContentLength: MAX_PAGE_BYTES });
    if (!actorProfile) {
      logger.info({ followingCalendarId: ctx.followingCalendarId }, 'source actor profile fetch returned null; aborting backfill');
      return 'complete';
    }

    const outboxUrl = typeof actorProfile.outbox === 'string' ? actorProfile.outbox : null;
    if (!outboxUrl) {
      logger.info({ followingCalendarId: ctx.followingCalendarId }, 'source actor profile has no outbox URL; aborting backfill');
      return 'complete';
    }

    // 3. Walk the outbox. Most servers return an OrderedCollection whose
    // `first` link points at the first page; a few hand back an
    // OrderedCollectionPage directly. Handle both shapes.
    if (!(await this.assertUrlPublic(outboxUrl))) {
      return 'complete';
    }
    if (!(await this.acquireRateBudget(outboxUrl))) {
      return 'rate_limited';
    }
    const outbox = await this.fetcher(outboxUrl, { calendar: ctx.calendar, calendarInterface: this.calendarInterface }, { maxContentLength: MAX_PAGE_BYTES });
    if (!outbox) {
      logger.info({ outboxUrl, followingCalendarId: ctx.followingCalendarId }, 'outbox fetch returned null; aborting backfill');
      return 'complete';
    }

    let currentPage: Record<string, unknown> | null;
    if (outbox.type === 'OrderedCollectionPage') {
      currentPage = outbox;
    }
    else if (typeof outbox.first === 'string') {
      if (!(await this.assertUrlPublic(outbox.first))) {
        return 'complete';
      }
      if (!(await this.acquireRateBudget(outbox.first))) {
        return 'rate_limited';
      }
      currentPage = await this.fetcher(outbox.first, { calendar: ctx.calendar, calendarInterface: this.calendarInterface }, { maxContentLength: MAX_PAGE_BYTES });
    }
    else {
      logger.info({ outboxUrl, followingCalendarId: ctx.followingCalendarId }, 'outbox has no first page link; nothing to backfill');
      return 'complete';
    }

    let pagesWalked = 0;
    while (currentPage && pagesWalked < MAX_OUTBOX_PAGES) {
      pagesWalked++;

      const items = Array.isArray(currentPage.orderedItems) ? currentPage.orderedItems : [];
      if (!this.processPage(items as unknown[], ctx, buffer)) {
        logger.warn(
          { followingCalendarId: ctx.followingCalendarId, sourceActorUri: ctx.sourceActorUri, bufferedBytes: buffer.bytes, cap: this.maxBufferBytes },
          'backfill truncated at buffer cap',
        );
        return 'complete';
      }

      // Re-verify the follow row at every page boundary. A user unfollowing
      // mid-backfill should stop us from continuing to drag down their
      // event history.
      if (!(await this.isStillFollowing(ctx))) {
        return 'unfollowed';
      }

      const nextUrl = typeof currentPage.next === 'string' ? currentPage.next : null;
      if (!nextUrl) {
        return 'complete';
      }
      if (!(await this.assertUrlPublic(nextUrl))) {
        return 'complete';
      }
      if (!(await this.acquireRateBudget(nextUrl))) {
        // Budget exhausted with pages still to walk: signal a retryable pause.
        return 'rate_limited';
      }
      currentPage = await this.fetcher(nextUrl, { calendar: ctx.calendar, calendarInterface: this.calendarInterface }, { maxContentLength: MAX_PAGE_BYTES });
    }

    if (pagesWalked >= MAX_OUTBOX_PAGES) {
      logger.warn(
        { followingCalendarId: ctx.followingCalendarId, sourceActorUri: ctx.sourceActorUri, pagesWalked, cap: MAX_OUTBOX_PAGES },
        'backfill truncated at page cap',
      );
    }
    return 'complete';
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /** Whether the follow relationship this run backfills still exists. */
  private async isStillFollowing(ctx: WalkContext): Promise<boolean> {
    const followRow = await FollowingCalendarEntity.findOne({
      where: {
        calendar_id: ctx.followingCalendarId,
        calendar_actor_id: ctx.calendarActorId,
      },
    });
    return followRow !== null;
  }

  /**
   * Validates a URL via the shared SSRF helper. Returns false (with a log
   * line) on failure rather than throwing so the caller can short-circuit
   * the pagination loop without surfacing the throw to pg-boss.
   */
  private async assertUrlPublic(url: string): Promise<boolean> {
    try {
      await validateUrlNotPrivate(url);
      return true;
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn({ url, reason }, 'backfill refusing fetch: URL failed SSRF validation');
      return false;
    }
  }

  /**
   * Reserves one slot in the per-host budget. Returns false (with a log
   * line) when the source is over the cap; callers should exit cleanly.
   */
  private async acquireRateBudget(url: string): Promise<boolean> {
    let host: string;
    try {
      host = new URL(url).hostname;
    }
    catch {
      return true;
    }
    if (!this.rateLimiter.tryAcquire(host)) {
      logger.warn({ host }, 'backfill paused: per-host rate limit exhausted');
      return false;
    }
    return true;
  }

  /**
   * Single-pass walk of a page. For each item: type-filter, run the
   * per-type pre-write trust gate, then push it onto `buffer`, counting its
   * serialized length against the buffer cap. Nothing is written here.
   * Returns false, without buffering it, at the first activity that would
   * take the buffer over the cap; the caller then stops the walk.
   *
   * Duplicate activity ids, within a page or across pages, are left in the
   * buffer: the write's `findOrCreate` on the activity id makes the second
   * occurrence a no-op. No two-pass Delete suppression is needed either: the
   * inbox handler is idempotent and the drain dispatches rows in
   * `message_time` order.
   */
  private processPage(items: unknown[], ctx: WalkContext, buffer: WalkBuffer): boolean {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const activity = raw as Record<string, unknown>;

      const type = typeof activity.type === 'string' ? activity.type : '';
      if (!SUPPORTED_TYPES.has(type)) {
        // Unknown / unsupported activity type — skipped silently per spec.
        continue;
      }

      // Outbox activities have no signature envelope: trust gates run here
      // pre-write, before any DB insert.
      if (!passesTrustGates(activity, type, { localActorUri: ctx.localActorUri, sourceActorUri: ctx.sourceActorUri })) {
        continue;
      }

      const entry = this.bufferEntry(activity, type);
      if (!entry) {
        continue;
      }
      const bytes = JSON.stringify(activity).length;
      if (buffer.bytes + bytes > this.maxBufferBytes) {
        return false;
      }
      buffer.entries.push(entry);
      buffer.bytes += bytes;
    }
    return true;
  }

  /**
   * Builds the buffer entry for one activity, resolving its clamped
   * `message_time` now, with the injected clock. Returns null for an activity
   * with no id: no id, no idempotency key. Skip rather than synthesize one — a
   * synthesized id would forfeit deduplication across reruns and could race
   * with a future live POST of the same activity.
   */
  private bufferEntry(activity: Record<string, unknown>, type: string): BufferedActivity | null {
    const activityId = typeof activity.id === 'string' ? activity.id : null;
    if (!activityId) {
      return null;
    }

    const publishedRaw = activity.published;
    const published =
      typeof publishedRaw === 'string'
        ? publishedRaw
        : publishedRaw instanceof Date
          ? publishedRaw
          : undefined;

    return { activityId, type, messageTime: clampMessageTime(published, this.now()), activity };
  }

  /**
   * Writes the buffered walk oldest first, one row at a time, and returns the
   * number of rows newly inserted. The buffer is in walk order (newest first),
   * so it is reversed before the stable sort: activities with equal
   * `message_time` are then written in reverse walk order too, oldest first.
   */
  private async writeBuffer(buffer: BufferedActivity[], ctx: WalkContext): Promise<number> {
    const ordered = [...buffer].reverse().sort((a, b) => a.messageTime.getTime() - b.messageTime.getTime());
    let created = 0;
    for (const entry of ordered) {
      if (await this.persistActivity(entry, ctx)) {
        created++;
      }
    }
    return created;
  }

  /**
   * Writes one inbox row through the deferred entry point
   * `enqueueInboxRow` (which persists via `findOrCreate` — first writer wins,
   * no upgrade on conflict — without emitting `inboxMessageAdded`). Returns
   * true when a new row was inserted, false when an existing row with the
   * same activity id was already present or the write was refused.
   */
  private async persistActivity(entry: BufferedActivity, ctx: WalkContext): Promise<boolean> {
    try {
      const { created } = await this.activityPubInterface.enqueueInboxRow({
        calendarId: ctx.calendar.id,
        id: entry.activityId,
        type: entry.type,
        messageTime: entry.messageTime,
        message: entry.activity as object,
        auth: { source: 'outbox_pull', origin: ctx.authOrigin },
      });
      return created;
    }
    catch (error) {
      // An id not on the source actor's origin is refused by the inbox
      // writer, which has already logged the rejection; skip the item.
      if (error instanceof ActivityIdOriginMismatchError) {
        return false;
      }
      logError(error, `[ActivityPub backfill] enqueueInboxRow failed for ${entry.type} ${entry.activityId}`);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Per-run context threaded through outbox walking, page processing, and
 * persistence. All fields are derived once in `runBackfill` and remain
 * constant for the duration of a single job.
 */
interface WalkContext {
  followingCalendarId: string;
  calendarActorId: string;
  sourceActorUri: string;
  /** Origin of `sourceActorUri`; used verbatim as the `auth_origin` column value. */
  authOrigin: string;
  /** Local follower calendar; used as the fetch signing identity and for the loop guard. */
  calendar: import('@/common/model/calendar').Calendar;
  /** Local calendar's actor URI; used by the loop guard. */
  localActorUri: string;
}

/**
 * One activity that passed the trust gates, held in memory until the walk
 * ends. `messageTime` is already clamped.
 */
interface BufferedActivity {
  activityId: string;
  type: string;
  messageTime: Date;
  activity: Record<string, unknown>;
}

/** The walk's buffer, in walk order, and the serialized bytes it holds. */
interface WalkBuffer {
  entries: BufferedActivity[];
  bytes: number;
}

/**
 * How a {@link FollowBackfillService.walkOutbox} run ended.
 *
 *   - `'complete'`: the walk is done — every page walked, page or buffer cap
 *     reached, next URL refused, or the source unreachable. The buffer is
 *     written unless the follow row is gone by then.
 *   - `'rate_limited'`: the per-host budget ran out with pages remaining. The
 *     buffer is discarded and the caller throws {@link BackfillRateLimitError}
 *     so pg-boss retries.
 *   - `'unfollowed'`: the follow row disappeared mid-walk or before the
 *     write. The buffer is discarded.
 */
type WalkEnd = 'complete' | 'rate_limited' | 'unfollowed';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Extracts the AP object id from a Create/Update/Announce/Undo/Delete
 * `object` field, which may be either a bare IRI string or an embedded
 * object with an `id`.
 */
export function extractObjectId(objectField: unknown): string | null {
  if (typeof objectField === 'string') {
    return objectField;
  }
  if (objectField && typeof objectField === 'object' && typeof (objectField as Record<string, unknown>).id === 'string') {
    return (objectField as Record<string, string>).id;
  }
  return null;
}

/**
 * Trust gate for a single outbox-pulled activity. Returns false (with a
 * debug log) when the activity fails any check that the live HTTP inbox
 * would otherwise get for free from signature middleware.
 *
 * Pure so the unit tests can poke at every branch without mocking the
 * worker. Per-type branches:
 *
 *   - **All:** `actor` exists and shares an origin with `sourceActorUri`.
 *     Embedded `object.attributedTo === localActorUri` trips the loop guard.
 *   - **Create / Update:** if `object` is embedded, `object.attributedTo`
 *     must match `actor`; if `object` is a bare IRI, the IRI's hostname
 *     must match the actor's. A missing `attributedTo` on an embedded
 *     object is accepted (some peers omit it on Updates that only carry a
 *     patch); the actor-origin gate on the wrapping activity still applies.
 *   - **Announce:** actor equals `sourceActorUri` or shares its origin.
 *     The strict cross-check against the referenced original Announce in
 *     `ap_inbox` is a dispatch-time concern.
 *   - **Undo:** actor-origin only (covered by the universal actor-origin
 *     gate). The Undo handler at dispatch time cross-checks against the
 *     stored Announce.
 *   - **Delete:** actor-origin only; the inbox Delete handler is
 *     idempotent so no per-page cross-check is required here.
 *
 * @param activity Raw activity JSON from the outbox page.
 * @param type Pre-validated activity type ('Create' | 'Update' | 'Announce' | 'Undo' | 'Delete').
 * @param ctx Local follower's actor URI (loop guard) and the source actor URI we are pulling from.
 */
export function passesTrustGates(
  activity: Record<string, unknown>,
  type: string,
  ctx: { localActorUri: string; sourceActorUri: string },
): boolean {
  const actor = typeof activity.actor === 'string' ? activity.actor : null;
  if (!actor) {
    logger.debug({ type }, 'backfill drop: activity has no actor');
    return false;
  }

  let actorOrigin: string;
  let sourceOrigin: string;
  let actorHostname: string;
  try {
    const actorUrl = new URL(actor);
    actorOrigin = actorUrl.origin;
    actorHostname = actorUrl.hostname;
    sourceOrigin = new URL(ctx.sourceActorUri).origin;
  }
  catch {
    logger.debug({ type, actor, sourceActorUri: ctx.sourceActorUri }, 'backfill drop: malformed actor or source URI');
    return false;
  }

  // Universal Gate 1: actor origin matches source actor origin. This
  // subsumes the actor-origin check for every type, including Undo and
  // Delete which have no additional pre-write requirements.
  if (actorOrigin !== sourceOrigin) {
    logger.debug({ type, actor, sourceActorUri: ctx.sourceActorUri }, 'backfill drop: actor origin does not match source actor origin');
    return false;
  }

  // Universal Gate 2 (loop guard): an embedded object whose `attributedTo`
  // points back at our own local calendar means the remote outbox is
  // (probably misconfigured) re-announcing our content. Drop it before
  // we re-import our own events.
  const obj = activity.object;
  if (obj && typeof obj === 'object') {
    const objRecord = obj as Record<string, unknown>;
    const attributedTo = typeof objRecord.attributedTo === 'string' ? objRecord.attributedTo : null;
    if (attributedTo && attributedTo === ctx.localActorUri) {
      logger.debug({ type, attributedTo, localActorUri: ctx.localActorUri }, 'backfill drop: loop guard tripped (object attributedTo == local actor)');
      return false;
    }
  }

  // Per-type gates.
  switch (type) {
    case 'Create':
    case 'Update':
      return passesCreateUpdateGates(activity, actor, actorHostname);
    case 'Announce':
      return passesAnnounceGates(actor, actorOrigin, ctx.sourceActorUri, sourceOrigin);
    case 'Undo':
    case 'Delete':
      // Both covered by the universal actor-origin gate above; strict
      // cross-checks happen at dispatch time.
      return true;
    default:
      // Unreachable in practice — the caller filters to SUPPORTED_TYPES
      // before invoking. Keep the guard for defense-in-depth.
      return false;
  }
}

/**
 * Create/Update-specific gate: the activity's `object` field must agree
 * with the activity's `actor`. Two `object` shapes are supported:
 *
 *   - Embedded object: `object.attributedTo` must match `actor` exactly.
 *     A missing `attributedTo` is permitted (some peers omit it on
 *     Update activities that carry only a patch); the actor-origin gate
 *     on the wrapping activity already enforces same-origin authorship.
 *   - Bare IRI: the IRI's hostname must match `actorHostname`. This is
 *     looser than the embedded `attributedTo === actor` check because
 *     the bare-IRI form gives us no `attributedTo` field to verify against.
 *
 * Anything else (object missing, not a string or object) fails closed.
 */
function passesCreateUpdateGates(
  activity: Record<string, unknown>,
  actor: string,
  actorHostname: string,
): boolean {
  const obj = activity.object;
  if (typeof obj === 'string') {
    let objHostname: string;
    try {
      objHostname = new URL(obj).hostname;
    }
    catch {
      logger.debug({ object: obj }, 'backfill drop: Create/Update bare-IRI object is not a valid URL');
      return false;
    }
    if (objHostname !== actorHostname) {
      logger.debug({ actor, object: obj }, 'backfill drop: Create/Update bare-IRI object hostname does not match actor');
      return false;
    }
    return true;
  }

  if (obj && typeof obj === 'object') {
    const objRecord = obj as Record<string, unknown>;
    const attributedTo = typeof objRecord.attributedTo === 'string' ? objRecord.attributedTo : null;
    if (attributedTo !== null && attributedTo !== actor) {
      logger.debug({ actor, attributedTo }, 'backfill drop: Create/Update object.attributedTo does not match actor');
      return false;
    }
    return true;
  }

  logger.debug({}, 'backfill drop: Create/Update object missing or malformed');
  return false;
}

/**
 * Announce-specific gate: the actor must equal `sourceActorUri` (the
 * normal case — the followed calendar is announcing its own activity) or
 * share its origin (allows alias actors on the same instance). Strict
 * equality alone would reject legitimate alternates that share an origin.
 */
function passesAnnounceGates(
  actor: string,
  actorOrigin: string,
  sourceActorUri: string,
  sourceOrigin: string,
): boolean {
  if (actor === sourceActorUri) {
    return true;
  }
  if (actorOrigin === sourceOrigin) {
    return true;
  }
  logger.debug({ actor, sourceActorUri }, 'backfill drop: Announce actor does not match source actor or origin');
  return false;
}
