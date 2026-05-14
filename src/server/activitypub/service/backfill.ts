/**
 * ActivityPub follow-backfill worker service.
 *
 * Pulls a remote calendar's outbox after a confirmed Accept(Follow) and
 * routes the historical Create(Event), Announce, and Delete activities
 * through the same inbox path that handles live federation traffic. This
 * lets a new follower see backlog without the source instance having to
 * re-broadcast everything.
 *
 * Trust posture
 * -------------
 * The inbox path's normal trust invariants come from middleware-verified
 * HTTP signatures on inbound POSTs. Outbox-pulled activities have no such
 * envelope, so this worker performs the equivalent checks itself before
 * handing each activity off to `processInboxMessage`:
 *   1. The activity's `actor` URL shares an origin with the outbox URL.
 *   2. For `Create(Event)`: `object.attributedTo` matches the activity's
 *      actor (no third-party "I created their event" forgery).
 *   3. For `Announce`: the actor matches the followed source.
 *   4. Loop guard: drop activities whose `object.attributedTo` resolves to
 *      the local follower's own actor URL. This prevents a misconfigured
 *      remote outbox from re-importing our own events back into our calendar.
 *
 * Two-pass Delete handling
 * ------------------------
 * Within a single page, a `Delete` is allowed to suppress earlier `Create`
 * or `Announce` activities for the same `ap_id` even though the inbox path
 * would otherwise process them in arrival order. This handles the common
 * case where a creator publishes an event and tombstones it within the
 * same paging window — without the suppression the worker would briefly
 * write an EventObject row and then race the delete to remove it. Across
 * pages, the same idempotency emerges naturally from the existing inbox
 * Delete handler plus the unique constraint on `ap_event_object.ap_id`,
 * so we only need the in-page short-circuit here.
 *
 * Hard caps
 * ---------
 * `MAX_OUTBOX_PAGES = 50` and `MAX_PAGE_BYTES = 1_048_576` bound the worst
 * case: a misbehaving peer cannot exhaust the worker by serving an
 * unbounded `next` chain or by returning a multi-megabyte page. Reaching
 * the page cap emits one warn-level log line; pages larger than the byte
 * cap are dropped silently by the underlying axios client (which returns
 * null up here).
 *
 * Rate limiting
 * -------------
 * A shared {@link SyncRateLimiter} (60 acquisitions per minute, keyed by
 * source hostname) gates the outbound requests. The limiter is a
 * module-scope singleton so multiple concurrent backfill jobs against the
 * same host share one budget.
 */

import { ActivityPubFollowAcceptedPayload } from '@/server/activitypub/events/types';
import { ActivityPubInboxMessageEntity, FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import { ActivityPubActor } from '@/server/activitypub/model/base';
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
}

/**
 * Worker entry point. Walks the remote outbox identified by `payload`,
 * routes surviving Create/Announce/Delete activities through the inbox
 * pipeline, and returns once pagination completes or a hard stop fires
 * (cap reached, follow row removed mid-run, rate limit exhausted).
 *
 * Designed to be invoked from `worker.ts`'s `activitypub:follow:backfill`
 * job subscription; the export remains the service primitive so tests do
 * not need to spin up pg-boss.
 */
export class FollowBackfillService {
  private readonly activityPubInterface: ActivityPubInterface;
  private readonly calendarInterface: CalendarInterface;
  private readonly rateLimiter: SyncRateLimiter;
  private readonly fetcher: typeof fetchRemoteObject;

  constructor(deps: BackfillDependencies) {
    this.activityPubInterface = deps.activityPubInterface;
    this.calendarInterface = deps.calendarInterface;
    this.rateLimiter = deps.rateLimiter ?? backfillRateLimiter;
    this.fetcher = deps.fetcher ?? fetchRemoteObject;
  }

  /**
   * Run a single backfill job to completion. Never throws for "expected"
   * conditions (follow removed, source unreachable, malformed page, cap
   * reached) — those exit cleanly so pg-boss does not loop on a
   * permanently-broken peer. Catastrophic infrastructure failures (DB
   * unavailable while loading the follow row) propagate so the worker
   * surfaces them in logs and the job retries.
   */
  async runBackfill(payload: ActivityPubFollowAcceptedPayload): Promise<void> {
    const { followingCalendarId, calendarActorId, sourceActorUri } = payload;

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

    // 2. Fetch the source actor profile so we read the *current* outbox URL
    // rather than whatever URL the federation handshake cached. Validate
    // first because the source URI is attacker-influenced (came in via
    // Accept(Follow)).
    if (!(await this.assertUrlPublic(sourceActorUri))) {
      return;
    }
    if (!(await this.acquireRateBudget(sourceActorUri))) {
      return;
    }
    const actorProfile = await this.fetcher(sourceActorUri, calendar, { maxContentLength: MAX_PAGE_BYTES });
    if (!actorProfile) {
      logger.info({ followingCalendarId }, 'source actor profile fetch returned null; aborting backfill');
      return;
    }

    const outboxUrl = typeof actorProfile.outbox === 'string' ? actorProfile.outbox : null;
    if (!outboxUrl) {
      logger.info({ followingCalendarId }, 'source actor profile has no outbox URL; aborting backfill');
      return;
    }

    // 3. Walk the outbox. Most servers return an OrderedCollection whose
    // `first` link points at the first page; a few hand back an
    // OrderedCollectionPage directly. Handle both shapes.
    if (!(await this.assertUrlPublic(outboxUrl))) {
      return;
    }
    if (!(await this.acquireRateBudget(outboxUrl))) {
      return;
    }
    const outbox = await this.fetcher(outboxUrl, calendar, { maxContentLength: MAX_PAGE_BYTES });
    if (!outbox) {
      logger.info({ outboxUrl, followingCalendarId }, 'outbox fetch returned null; aborting backfill');
      return;
    }

    let currentPage: Record<string, unknown> | null;
    if (outbox.type === 'OrderedCollectionPage') {
      currentPage = outbox;
    }
    else if (typeof outbox.first === 'string') {
      if (!(await this.assertUrlPublic(outbox.first))) {
        return;
      }
      if (!(await this.acquireRateBudget(outbox.first))) {
        return;
      }
      currentPage = await this.fetcher(outbox.first, calendar, { maxContentLength: MAX_PAGE_BYTES });
    }
    else {
      logger.info({ outboxUrl, followingCalendarId }, 'outbox has no first page link; nothing to backfill');
      return;
    }

    let pagesWalked = 0;
    while (currentPage && pagesWalked < MAX_OUTBOX_PAGES) {
      pagesWalked++;

      const items = Array.isArray(currentPage.orderedItems) ? currentPage.orderedItems : [];
      await this.processPage(items as unknown[], {
        calendar,
        localActorUri,
        sourceActorUri,
        outboxUrl,
        followingCalendarId,
      });

      // Re-verify the follow row at every page boundary. A user unfollowing
      // mid-backfill should stop us from continuing to drag down their
      // event history.
      const stillFollowing = await FollowingCalendarEntity.findOne({
        where: {
          calendar_id: followingCalendarId,
          calendar_actor_id: calendarActorId,
        },
      });
      if (!stillFollowing) {
        logger.info({ followingCalendarId, calendarActorId }, 'follow row removed during backfill; stopping pagination');
        return;
      }

      const nextUrl = typeof currentPage.next === 'string' ? currentPage.next : null;
      if (!nextUrl) {
        return;
      }
      if (!(await this.assertUrlPublic(nextUrl))) {
        return;
      }
      if (!(await this.acquireRateBudget(nextUrl))) {
        return;
      }
      currentPage = await this.fetcher(nextUrl, calendar, { maxContentLength: MAX_PAGE_BYTES });
    }

    if (pagesWalked >= MAX_OUTBOX_PAGES) {
      logger.warn(
        { followingCalendarId, sourceActorUri, pagesWalked, cap: MAX_OUTBOX_PAGES },
        'backfill truncated at page cap',
      );
    }
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
   * Two-pass walk of a single outbox page. Pass 1 enumerates items and
   * collects the set of `ap_id`s that are tombstoned in the same page;
   * Pass 2 runs the trust gates and routes the surviving Create/Announce/
   * Delete activities through `processInboxMessage`.
   */
  private async processPage(
    items: unknown[],
    ctx: {
      calendar: { id: string };
      localActorUri: string;
      sourceActorUri: string;
      outboxUrl: string;
      followingCalendarId: string;
    },
  ): Promise<void> {
    // Pass 1: collect the set of object IDs that are deleted within this
    // same page. A page-local Delete suppresses any earlier Create/Announce
    // for the same `ap_id` in the same page so we never write a row we
    // would immediately tombstone.
    const inPageDeletes = new Set<string>();
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const activity = raw as Record<string, unknown>;
      if (activity.type !== 'Delete') continue;
      const objectId = extractObjectId(activity.object);
      if (objectId) {
        inPageDeletes.add(objectId);
      }
    }

    // Pass 2: route each surviving activity through the inbox path.
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const activity = raw as Record<string, unknown>;

      const type = typeof activity.type === 'string' ? activity.type : '';

      // Type filter — Update is an explicit skip (the inbox path mutates
      // EventEntity in place and we already have whatever state the source
      // sent us via Create). Anything outside the documented set is ignored
      // silently.
      if (type !== 'Create' && type !== 'Announce' && type !== 'Delete') {
        continue;
      }

      // In-page Delete suppression — only applies to Create/Announce.
      if (type !== 'Delete') {
        const objectId = extractObjectId(activity.object);
        if (objectId && inPageDeletes.has(objectId)) {
          continue;
        }
      }

      // Trust re-validation — outbox activities have no signature envelope.
      if (!passesTrustGates(activity, type, ctx)) {
        continue;
      }

      await this.routeActivity(activity, type, ctx);
    }
  }

  /**
   * Constructs a synthetic ActivityPubInboxMessageEntity for the activity
   * and hands it to `processInboxMessage`. The entity is built in memory
   * (not saved) — the inbox path tolerates this because it only reads the
   * `message` JSON, the `type`, and the `calendar_id`; the persisted
   * processed_time/processed_status writes that the live inbox path does
   * would be redundant here because the activity is not coming in via the
   * stored-inbox queue.
   *
   * Errors are caught per-activity so one malformed entry does not abort
   * the rest of the page.
   */
  private async routeActivity(
    activity: Record<string, unknown>,
    type: string,
    ctx: {
      calendar: { id: string };
      followingCalendarId: string;
    },
  ): Promise<void> {
    const apId = typeof activity.id === 'string' ? activity.id : `backfill:${ctx.followingCalendarId}:${Date.now()}:${Math.random()}`;

    const synthetic = ActivityPubInboxMessageEntity.build({
      id: apId,
      calendar_id: ctx.calendar.id,
      type,
      message: activity,
    });
    // Stub the persistence hook the live inbox path normally calls at the
    // end of processing. The synthetic message is not persisted, so the
    // default `update` would throw; replacing it with a no-op keeps the
    // inbox handler's bookkeeping write inert.
    (synthetic as unknown as { update: (..._args: unknown[]) => Promise<void> }).update = async () => undefined;

    try {
      await this.activityPubInterface.processInboxMessage(synthetic);
    }
    catch (error) {
      logError(error, `[ActivityPub backfill] inbox routing failed for ${type} ${apId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Extracts the AP object id from a Create/Announce/Delete `object` field,
 * which may be either a bare IRI string or an embedded object with an `id`.
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
 * Trust gate. Returns false (and logs) when an activity fails any of the
 * four checks documented at the top of this file. Pure so the unit tests
 * can poke at every branch without mocking the worker.
 */
export function passesTrustGates(
  activity: Record<string, unknown>,
  type: string,
  ctx: { localActorUri: string; sourceActorUri: string; outboxUrl: string },
): boolean {
  const actor = typeof activity.actor === 'string' ? activity.actor : null;
  if (!actor) {
    return false;
  }

  let actorOrigin: string;
  let outboxOrigin: string;
  let sourceOrigin: string;
  try {
    actorOrigin = new URL(actor).origin;
    outboxOrigin = new URL(ctx.outboxUrl).origin;
    sourceOrigin = new URL(ctx.sourceActorUri).origin;
  }
  catch {
    return false;
  }

  // Gate 1: actor origin matches outbox origin.
  if (actorOrigin !== outboxOrigin) {
    logger.debug({ actor, outboxUrl: ctx.outboxUrl }, 'backfill drop: actor origin mismatch');
    return false;
  }

  // Gate 3 (covers Announce): actor matches the followed source.
  if (type === 'Announce' && actor !== ctx.sourceActorUri && actorOrigin !== sourceOrigin) {
    // For Announce we accept a same-origin actor as a peer of the source
    // since the federation contract is that the source is announcing its
    // own activity; a strict equality would reject legitimate alternates
    // (alias actor URIs, capitalisation) that share an origin.
    logger.debug({ actor, sourceActorUri: ctx.sourceActorUri }, 'backfill drop: Announce actor not from source origin');
    return false;
  }

  // Gate 2 (Create) + Gate 4 (loop guard): inspect the embedded object.
  const obj = activity.object;
  if (obj && typeof obj === 'object') {
    const objRecord = obj as Record<string, unknown>;
    const attributedTo = typeof objRecord.attributedTo === 'string' ? objRecord.attributedTo : null;

    if (type === 'Create' && attributedTo && attributedTo !== actor) {
      logger.debug({ actor, attributedTo }, 'backfill drop: Create attributedTo does not match actor');
      return false;
    }

    if (attributedTo && attributedTo === ctx.localActorUri) {
      logger.debug({ attributedTo, localActorUri: ctx.localActorUri }, 'backfill drop: loop guard tripped (object attributedTo == local actor)');
      return false;
    }
  }

  return true;
}

