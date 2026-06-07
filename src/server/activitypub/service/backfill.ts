/**
 * ActivityPub follow-backfill worker service.
 *
 * Pulls a remote calendar's outbox after a confirmed Accept(Follow), runs
 * pre-write trust gates against each Create/Update/Announce/Undo/Delete
 * activity, and persists survivors as real `ap_inbox` rows tagged with
 * `auth_source = 'outbox_pull'` and `auth_origin = <source actor origin>`.
 * After pagination terminates the worker calls
 * `activityPubInterface.processInboxMessages()` exactly once to drain the
 * inbox in chronological order — the same code path the live HTTP inbox
 * runs after a signed POST.
 *
 * Every surviving activity is persisted via the deferred inbox entry point
 * `activityPubInterface.enqueueInboxRow()` — which writes through the same
 * `findOrCreate` (first writer wins, no upgrade on conflict) as the live
 * path but emits no `inboxMessageAdded` event — and the standard inbox drain
 * handles ordering and idempotency. The trust gates that the live HTTP path
 * gets for free from signature middleware are run here pre-write, before any
 * DB insert.
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
 * Rate limiting
 * -------------
 * A shared {@link SyncRateLimiter} (60 acquisitions per minute, keyed by
 * source hostname) gates the outbound requests. The limiter is a
 * module-scope singleton so multiple concurrent backfill jobs against the
 * same host share one budget. A single job needs at most ~53 requests
 * (profile + outbox + first page + {@link MAX_OUTBOX_PAGES}) so it cannot
 * self-exhaust the budget; exhaustion happens under contention, when several
 * jobs target the same host at once. When the budget is exhausted mid-walk,
 * the run drains whatever it persisted and throws {@link BackfillRateLimitError}
 * so pg-boss re-queues the job; the {@link BACKFILL_RETRY_DELAY_SECONDS}
 * retry delay gives the sliding window time to reset before the re-walk, which
 * is idempotent via `findOrCreate`.
 *
 * Why `enqueueInboxRow` and not `addToInbox`
 * ------------------------------------------
 * The two share one writer (`writeInboxRow`) but differ on emission and time
 * policy. `addToInbox` emits an `inboxMessageAdded` event per row, which would
 * cause the live inbox subscription to drain backfill rows one-by-one in
 * arrival order rather than in chronological `message_time` order; it also
 * uses `message.published` verbatim. `enqueueInboxRow` emits nothing — the
 * worker drains once after pagination — and accepts an already-resolved
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
 * {@link FollowBackfillService.runBackfill} *after* the partial-progress inbox
 * drain, so pg-boss re-queues the job and the remaining pages are walked on a
 * later attempt once the rate window has reset. Distinct from a catastrophic
 * failure: the peer is healthy, we simply hit our own throttle.
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
}

/**
 * Walks the remote outbox identified by `payload`, persists surviving
 * activities into `ap_inbox`, and drains the inbox once at end of
 * pagination. Designed to be invoked from `worker.ts`'s
 * `activitypub:follow:backfill` job subscription.
 */
export class FollowBackfillService {
  private readonly activityPubInterface: ActivityPubInterface;
  private readonly calendarInterface: CalendarInterface;
  private readonly rateLimiter: SyncRateLimiter;
  private readonly fetcher: typeof fetchRemoteObject;
  private readonly now: () => Date;

  constructor(deps: BackfillDependencies) {
    this.activityPubInterface = deps.activityPubInterface;
    this.calendarInterface = deps.calendarInterface;
    this.rateLimiter = deps.rateLimiter ?? backfillRateLimiter;
    this.fetcher = deps.fetcher ?? fetchRemoteObject;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Run a single backfill job to completion. Never throws for "done"
   * conditions (follow removed, source unreachable, malformed page, cap
   * reached) — those exit cleanly so pg-boss does not loop on a
   * permanently-broken peer. Two cases DO throw: catastrophic infrastructure
   * failures (DB unavailable while loading the follow row) propagate so the
   * job retries, and rate-limit exhaustion throws {@link BackfillRateLimitError}
   * so the unfinished remainder is walked on a later, delayed retry.
   *
   * Calls `activityPubInterface.processInboxMessages()` exactly once at
   * the end — on the happy path (all pages walked) AND on every early exit
   * (cap reached, unfollow detected, rate-limit pause) — so any rows
   * persisted before the exit still get drained. The rate-limit throw happens
   * only after that drain has run.
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

    // Track whether we persisted at least one row so the end-of-run drain
    // call has a no-op signal in logs. The drain itself is always invoked
    // (single call site, finally block) so callers downstream can rely on
    // it firing exactly once per job.
    let walkResult: WalkResult = { persistedRows: 0, rateLimited: false };
    try {
      walkResult = await this.walkOutbox({
        followingCalendarId,
        calendarActorId,
        sourceActorUri,
        authOrigin,
        calendar,
        localActorUri,
      });
    }
    finally {
      // Always drain — even on early exits, any rows we did persist
      // before the exit should still be processed in chronological order.
      try {
        await this.activityPubInterface.processInboxMessages();
      }
      catch (error) {
        logError(error, '[ActivityPub backfill] inbox drain after backfill failed');
      }
      logger.info(
        { followingCalendarId, sourceActorUri, persistedRows: walkResult.persistedRows, rateLimited: walkResult.rateLimited },
        'backfill run finished; inbox drain invoked',
      );
    }

    // Rate-limit exhaustion is the one non-catastrophic early exit that must
    // NOT be treated as "done": the remaining outbox pages still need walking.
    // Throw *after* the drain above so the rows we persisted before the pause
    // are dispatched now, and pg-boss re-queues the job. The publish-time
    // BACKFILL_RETRY_* options give the sliding window time to reset before the
    // retry; the re-walk is idempotent via findOrCreate.
    if (walkResult.rateLimited) {
      throw new BackfillRateLimitError(authOrigin);
    }
  }

  /**
   * Walks the source outbox page-by-page. Returns a {@link WalkResult}: the
   * number of rows actually persisted plus a `rateLimited` flag.
   *
   * Every early exit returns cleanly so the caller's `finally` block runs the
   * drain. The `rateLimited` flag distinguishes the one exit that the caller
   * must turn into a retryable throw (budget exhausted, work remains) from the
   * "done" exits (cap reached, unfollow detected, source unreachable).
   */
  private async walkOutbox(ctx: WalkContext): Promise<WalkResult> {
    // 2. Fetch the source actor profile so we read the *current* outbox URL
    // rather than whatever URL the federation handshake cached. Validate
    // first because the source URI is attacker-influenced (came in via
    // Accept(Follow)).
    if (!(await this.assertUrlPublic(ctx.sourceActorUri))) {
      return { persistedRows: 0, rateLimited: false };
    }
    if (!(await this.acquireRateBudget(ctx.sourceActorUri))) {
      return { persistedRows: 0, rateLimited: true };
    }
    const actorProfile = await this.fetcher(ctx.sourceActorUri, { calendar: ctx.calendar, calendarInterface: this.calendarInterface }, { maxContentLength: MAX_PAGE_BYTES });
    if (!actorProfile) {
      logger.info({ followingCalendarId: ctx.followingCalendarId }, 'source actor profile fetch returned null; aborting backfill');
      return { persistedRows: 0, rateLimited: false };
    }

    const outboxUrl = typeof actorProfile.outbox === 'string' ? actorProfile.outbox : null;
    if (!outboxUrl) {
      logger.info({ followingCalendarId: ctx.followingCalendarId }, 'source actor profile has no outbox URL; aborting backfill');
      return { persistedRows: 0, rateLimited: false };
    }

    // 3. Walk the outbox. Most servers return an OrderedCollection whose
    // `first` link points at the first page; a few hand back an
    // OrderedCollectionPage directly. Handle both shapes.
    if (!(await this.assertUrlPublic(outboxUrl))) {
      return { persistedRows: 0, rateLimited: false };
    }
    if (!(await this.acquireRateBudget(outboxUrl))) {
      return { persistedRows: 0, rateLimited: true };
    }
    const outbox = await this.fetcher(outboxUrl, { calendar: ctx.calendar, calendarInterface: this.calendarInterface }, { maxContentLength: MAX_PAGE_BYTES });
    if (!outbox) {
      logger.info({ outboxUrl, followingCalendarId: ctx.followingCalendarId }, 'outbox fetch returned null; aborting backfill');
      return { persistedRows: 0, rateLimited: false };
    }

    let currentPage: Record<string, unknown> | null;
    if (outbox.type === 'OrderedCollectionPage') {
      currentPage = outbox;
    }
    else if (typeof outbox.first === 'string') {
      if (!(await this.assertUrlPublic(outbox.first))) {
        return { persistedRows: 0, rateLimited: false };
      }
      if (!(await this.acquireRateBudget(outbox.first))) {
        return { persistedRows: 0, rateLimited: true };
      }
      currentPage = await this.fetcher(outbox.first, { calendar: ctx.calendar, calendarInterface: this.calendarInterface }, { maxContentLength: MAX_PAGE_BYTES });
    }
    else {
      logger.info({ outboxUrl, followingCalendarId: ctx.followingCalendarId }, 'outbox has no first page link; nothing to backfill');
      return { persistedRows: 0, rateLimited: false };
    }

    let pagesWalked = 0;
    let persistedRows = 0;
    while (currentPage && pagesWalked < MAX_OUTBOX_PAGES) {
      pagesWalked++;

      const items = Array.isArray(currentPage.orderedItems) ? currentPage.orderedItems : [];
      persistedRows += await this.processPage(items as unknown[], ctx);

      // Re-verify the follow row at every page boundary. A user unfollowing
      // mid-backfill should stop us from continuing to drag down their
      // event history.
      const stillFollowing = await FollowingCalendarEntity.findOne({
        where: {
          calendar_id: ctx.followingCalendarId,
          calendar_actor_id: ctx.calendarActorId,
        },
      });
      if (!stillFollowing) {
        logger.info({ followingCalendarId: ctx.followingCalendarId, calendarActorId: ctx.calendarActorId }, 'follow row removed during backfill; stopping pagination');
        return { persistedRows, rateLimited: false };
      }

      const nextUrl = typeof currentPage.next === 'string' ? currentPage.next : null;
      if (!nextUrl) {
        return { persistedRows, rateLimited: false };
      }
      if (!(await this.assertUrlPublic(nextUrl))) {
        return { persistedRows, rateLimited: false };
      }
      if (!(await this.acquireRateBudget(nextUrl))) {
        // Budget exhausted with pages still to walk: signal a retryable pause.
        return { persistedRows, rateLimited: true };
      }
      currentPage = await this.fetcher(nextUrl, { calendar: ctx.calendar, calendarInterface: this.calendarInterface }, { maxContentLength: MAX_PAGE_BYTES });
    }

    if (pagesWalked >= MAX_OUTBOX_PAGES) {
      logger.warn(
        { followingCalendarId: ctx.followingCalendarId, sourceActorUri: ctx.sourceActorUri, pagesWalked, cap: MAX_OUTBOX_PAGES },
        'backfill truncated at page cap',
      );
    }
    return { persistedRows, rateLimited: false };
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

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
   * per-type pre-write trust gate, then `findOrCreate` an `ap_inbox` row.
   * Returns the number of rows persisted on this page (i.e. the
   * `findOrCreate` "created=true" count).
   *
   * Cross-page idempotency comes for free from `findOrCreate` on the
   * activity id; in-page idempotency comes from the same primary-key
   * uniqueness — a second occurrence of the same activity id on a single
   * page will land on `created=false`. No two-pass Delete suppression is
   * needed: the inbox handler is idempotent and the drain processes rows
   * in `message_time` order, so a Delete that follows a Create in the
   * same page will run after the Create at drain time.
   */
  private async processPage(items: unknown[], ctx: WalkContext): Promise<number> {
    let created = 0;
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

      const persisted = await this.persistActivity(activity, type, ctx);
      if (persisted) {
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
   * same activity id was already present.
   */
  private async persistActivity(
    activity: Record<string, unknown>,
    type: string,
    ctx: WalkContext,
  ): Promise<boolean> {
    const activityId = typeof activity.id === 'string' ? activity.id : null;
    if (!activityId) {
      // No id, no idempotency key. Skip rather than synthesize one — a
      // synthesized id would forfeit deduplication across reruns and could
      // race with a future live POST of the same activity.
      return false;
    }

    const publishedRaw = activity.published;
    const published =
      typeof publishedRaw === 'string'
        ? publishedRaw
        : publishedRaw instanceof Date
          ? publishedRaw
          : undefined;
    const messageTime = clampMessageTime(published, this.now());

    try {
      const { created } = await this.activityPubInterface.enqueueInboxRow({
        calendarId: ctx.calendar.id,
        id: activityId,
        type,
        messageTime,
        message: activity as object,
        auth: { source: 'outbox_pull', origin: ctx.authOrigin },
      });
      return created;
    }
    catch (error) {
      logError(error, `[ActivityPub backfill] enqueueInboxRow failed for ${type} ${activityId}`);
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
 * Outcome of a single {@link FollowBackfillService.walkOutbox} run.
 */
interface WalkResult {
  /** Number of `ap_inbox` rows actually inserted before the walk ended. */
  persistedRows: number;
  /**
   * True when the walk ended early because the per-host rate budget was
   * exhausted while pages remained. The caller drains, then re-throws as
   * {@link BackfillRateLimitError} so pg-boss retries. Every other exit
   * (done, unreachable, unfollowed, capped) leaves this false.
   */
  rateLimited: boolean;
}

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
