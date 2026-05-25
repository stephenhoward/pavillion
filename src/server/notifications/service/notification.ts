import { Op, Transaction, UniqueConstraintError, literal } from 'sequelize';

import { type NotificationResponse } from '@/common/model/notification';
import { NotificationRecipientNotFoundError } from '@/common/exceptions/notifications';
import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import {
  NotificationActivityEntity,
  NotificationRecipientEntity,
} from '@/server/notifications/entity/notification_activity';
import {
  NotificationActorKind,
  NotificationObjectType,
  NotificationOrigin,
  NotificationVerb,
} from '@/server/notifications/types';
import { anonymizeFlagActor, type FlagActorInput } from '@/server/notifications/service/anonymize-flag-actor';
import { sanitize } from '@/server/notifications/service/sanitize';
import {
  resolveRoleAudience as defaultResolveRoleAudience,
  type NotificationRole,
  type RoleObjectRef,
  type RoleResolverDeps,
} from '@/server/notifications/service/role-resolver';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('notifications');

/**
 * Dedup window. Any prior matching
 * activity row inside this window collapses the new request into a no-op.
 */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Maximum entries permitted in an `audience.kind='explicit'` list * . The supported single-recipient use cases
 * (EditorInvited, EditorRevoked, ReportResolved in-app side) cannot legitimately
 * exceed this — any larger list is treated as caller misuse and throws.
 */
const EXPLICIT_AUDIENCE_MAX = 50;

/**
 * Snapshot length caps. The actor name maps
 * to a display-name slot (256 chars matches the legacy notification field
 * limit); object labels are slightly longer because event titles tend to be
 * longer than account display names.
 */
const ACTOR_DISPLAY_NAME_MAX_LEN = 256;
const OBJECT_LABEL_MAX_LEN = 512;

/**
 * Prefix reserved for server-generated i18n display tokens (see
 * `anonymize-flag-actor.ts`). The client-side resolver
 * (`useNotificationDisplay.resolveActorDisplayName`) treats any string
 * starting with this prefix as a token to localize.
 *
 * The prefix must never appear on a caller-supplied `actorDisplayName` for
 * a non-Flag verb: a federated peer could otherwise set their AP actor
 * display name to e.g. `i18n:flag_actor_remote{host:victim.example}` and
 * follow a local calendar, causing the recipient to see the Flag
 * attribution string applied to a Follow notification. `scrubReservedI18nPrefix`
 * blanks any such value before it reaches the row.
 */
const I18N_TOKEN_PREFIX = 'i18n:';

/**
 * Returns an empty string if the caller-supplied display name uses the
 * reserved `i18n:` prefix (which is for server-generated Flag tokens only);
 * otherwise returns the value unchanged (or `''` if nullish). The empty
 * fallback keeps `actor_display_name` non-null and falls through to the
 * downstream sanitize step.
 */
function scrubReservedI18nPrefix(displayName: string | undefined): string {
  if (displayName == null) return '';
  if (displayName.startsWith(I18N_TOKEN_PREFIX)) return '';
  return displayName;
}

/**
 * Discriminated actor input for `recordActivity`. The notifications domain
 * never inspects an account row or remote actor URI beyond these fields —
 * the emitting domain supplies the actor's identity in the shape that
 * matches its origin path.
 */
export type RecordActivityActor =
  | { kind: 'account'; accountId: string }
  | { kind: 'remote_actor'; uri: string }
  | { kind: 'anonymous' }
  | { kind: 'system' };

/**
 * Object reference carried on the activity row. `label` is sanitized at insert
 * time and stored as the snapshot display string; the resolver lives in the
 * type-specific service at render time ().
 *
 * Click-through URLs are computed at render time by the API layer
 * (pv-89mw.7.1) from `(type, id)` rather than stored on the row — there is no
 * `displayUrl` field on this shape by design.
 */
export interface RecordActivityObject {
  type: NotificationObjectType;
  id: string;
  label: string;
}

/**
 * Audience addressing. `explicit` is for the
 * emitter-knows-recipient cases (EditorInvited/Revoked, ReportResolved);
 * `role` runs through the role resolver (calendar-editors / calendar-owners
 * / instance-admins).
 */
export type RecordActivityAudience =
  | { kind: 'explicit'; accountIds: string[] }
  | { kind: 'role'; role: NotificationRole; objectRef?: RoleObjectRef };

/**
 * Caller-supplied payload for `recordActivity`. Per
 * the emitter pre-resolves any object indirection (e.g. event→calendar) and
 * passes the resolved object reference; notifications does no traversal.
 *
 * `actorDisplayName` and `actorDisplayUrl` are the emitter's view of the
 * actor at the time of the activity (snapshot-on-write). For `verb='Flag'`,
 * the supplied fields are *discarded* before insert — the anonymization
 * policy in pv-89mw.3.2 computes the stored values from the `actor`
 * discriminator alone.
 */
export interface RecordActivityInput {
  verb: NotificationVerb;
  actor: RecordActivityActor;
  object: RecordActivityObject;
  audience: RecordActivityAudience;
  origin?: NotificationOrigin;
  actorDisplayName?: string;
  actorDisplayUrl?: string;
}

/**
 * Type guard for the entity attached as the `activity` BelongsTo association
 * on a `NotificationRecipientEntity`. Sequelize's TypeScript types treat
 * eager-loaded associations as `any` from `findAll` — we narrow here.
 */
interface RecipientWithActivity extends NotificationRecipientEntity {
  activity: NotificationActivityEntity;
}

/**
 * Caller-supplied payload for `dismissForObject`. Per
 * superseded notifications, this single API serves two use cases:
 *
 *   1. Object-state transitions (no actor filter) — e.g.
 *      `moderation:report:resolved` dismisses every recipient of every
 *      prior Flag/Escalated for that report.
 *   2. Actor-scoped reversals (actor filter set) — e.g. `Undo(Announce)`
 *      from a remote actor dismisses only that actor's Announce row;
 *      other actors who shared the same event keep their notifications.
 *
 * At most one of `actorAccountId` / `actorUri` may be set per call. Both
 * set throws synchronously (programming error, never round-trips to DB).
 *
 * Actor filters are a no-op against Flag rows by design — Flag activities
 * store NULL identity columns, so no actor filter can match. Flag dismissal
 * is intentionally only addressable through the object-scoped form (Flag
 * is not a reversible action).
 */
export interface DismissForObjectInput {
  objectType: NotificationObjectType;
  objectId: string;
  verbs?: NotificationVerb[];
  actorAccountId?: string;
  actorUri?: string;
}

/**
 * Caller-supplied payload for `updateRecipientState`. At least one of
 * `seen` / `dismissed` must be defined; passing neither is a programming
 * error and throws synchronously.
 *
 * Flag semantics — flipping `false → true` stamps the corresponding
 * timestamp (`seen_at` / `dismissed_at`) with `new Date()`; flipping
 * `true → false` clears it back to `null`. Idempotent: applying the same
 * boolean a second time is a no-op (the comparison runs against the
 * derived boolean, not the stored timestamp).
 */
export interface UpdateRecipientStateInput {
  seen?: boolean;
  dismissed?: boolean;
}

/**
 * Internal staging shape for the actor fields that land on the
 * `notification_activity` row. Mirrors the entity column names so the
 * insert step is a direct splat.
 */
interface ActorRow {
  actor_kind: NotificationActorKind;
  actor_account_id: string | null;
  actor_uri: string | null;
  actor_display_name: string;
  actor_display_url: string | null;
}

/**
 * Notifications domain write-path service.
 *
 * Owns the central `recordActivity` insert path:
 *
 *   dedup-check → (Flag) anonymize → sanitize → insert activity →
 *   resolve audience → insert recipient rows
 *
 * All steps run inside a single DB transaction so the inbox is always
 * consistent. The cross-recipient dedup invariant is enforced by running the
 * transaction at SERIALIZABLE isolation; the in-transaction dedup check
 * then sees any prior committed
 * matching row and short-circuits to the no-op return. Under SERIALIZABLE
 * one of two concurrent transactions for the same dedup tuple aborts with
 * a serialization failure (Postgres SQLSTATE 40001, SQLite SQLITE_BUSY/
 * LOCKED); the surrounding retry loop restarts the call and the retried
 * attempt finds the winner in its dedup check. A `UniqueConstraintError`
 * recovery remains inside the transaction as secondary defense for any
 * future deployment that gains a unique partial index on the dedup tuple.
 *
 * This service is
 * called only by `NotificationEventHandlers` (subscribing to the event
 * bus). Emitting domains never reach in directly.
 */
/**
 * Type alias for the role resolver function. Exposed so unit tests can
 * inject a stub (the real resolver depends on calendar/accounts service
 * traversal that integration tests cover).
 */
export type ResolveRoleAudienceFn = typeof defaultResolveRoleAudience;

/**
 * Maximum number of attempts a single `recordActivity` call will make when
 * the underlying transaction is aborted with a serialization failure under
 * SERIALIZABLE isolation. Capped to bound contention storms.
 */
const SERIALIZATION_RETRY_LIMIT = 3;

/**
 * Tests whether an error surfaced by Sequelize represents a serialization
 * failure that warrants retry under SERIALIZABLE isolation:
 *   - Postgres returns SQLSTATE 40001 ("could not serialize access").
 *   - SQLite surfaces concurrent write contention as SQLITE_BUSY /
 *     SQLITE_LOCKED. These are not strictly serialization failures but the
 *     remediation is identical: drop the current attempt and retry.
 *
 * Anything else propagates — programming bugs and constraint violations
 * must not be silently swallowed by the retry loop.
 */
function isSerializationFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const candidate = err as { original?: { code?: string } };
  const code = candidate.original?.code;
  if (code === '40001') {
    // Postgres serialization_failure.
    return true;
  }
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return true;
  }
  return false;
}

class NotificationService {
  private readonly deps: RoleResolverDeps;
  private readonly resolveRoleAudience: ResolveRoleAudienceFn;

  constructor(
    deps: RoleResolverDeps,
    resolveRoleAudience: ResolveRoleAudienceFn = defaultResolveRoleAudience,
  ) {
    this.deps = deps;
    this.resolveRoleAudience = resolveRoleAudience;
  }

  /**
   * Records a notification activity and fans it out to its audience.
   *
   * Behavioural cases — observed via DB side effects, not a return value:
   *   - Dedup hit: a prior matching activity row inside the 10-minute
   *     window suppresses the insert; no new activity or recipient rows
   *     are written.
   *   - Empty audience: the activity row is still inserted (audit trail)
   *     but no recipient rows are written.
   *   - Normal happy path: one activity row + N recipient rows are
   *     written under a single transaction.
   *
   * Returns `void`. The dedup outcome and recipient count are not
   * exposed — no caller (handlers in `events/index.ts`) consumes them,
   * and structured-log lines inside this method already record the
   * dedup hit for ops visibility. If a future use case (e.g. metrics
   * or per-call logging at the handler layer) needs to distinguish
   * dedup-hit from empty-audience from happy-path, reintroduce a
   * typed result then.
   *
   * @param input - See `RecordActivityInput` for field-level docs.
   * @throws If `audience.kind='explicit'` exceeds `EXPLICIT_AUDIENCE_MAX`,
   *   or if the role resolver throws (mismatched object type for role,
   *   missing required object).
   */
  async recordActivity(input: RecordActivityInput): Promise<void> {
    // Validate explicit-audience size before opening a transaction — the
    // failure is a programming error and should not waste a DB round-trip.
    if (input.audience.kind === 'explicit' && input.audience.accountIds.length > EXPLICIT_AUDIENCE_MAX) {
      throw new Error(
        `recordActivity: explicit audience size ${input.audience.accountIds.length} exceeds max ${EXPLICIT_AUDIENCE_MAX}`,
      );
    }

    // Resolve audience before opening the write transaction. Role resolution
    // queries calendar/accounts interfaces which run their own transactions;
    // we don't want them nested inside our write tx. The recipient list is
    // captured here and consumed under the transaction below. Audience-at-T
    // semantics are correct: the role-holders snapshot is taken before the
    // activity row is committed, matching the design's "recipe at activity
    // creation time" framing.
    const resolvedAccountIds = await this.resolveAudience(input.audience);

    // Stage the actor row: Flag verb runs anonymization (drops identity,
    // computes display name/url from the actor discriminator alone); all
    // other verbs pass the supplied identity through unchanged.
    const actorRow = this.buildActorRow(input);

    // Sanitize snapshot text fields (defense-in-depth — clients must still
    // render these as plain text).
    const actor_display_name = sanitize(actorRow.actor_display_name, ACTOR_DISPLAY_NAME_MAX_LEN);
    const object_label = sanitize(input.object.label, OBJECT_LABEL_MAX_LEN);

    const verb = input.verb;
    const origin = input.origin ?? 'local';

    // SERIALIZABLE isolation is the design-mandated mitigation for the
    // cross-recipient dedup invariant.
    // Under READ COMMITTED (Postgres default) two concurrent `recordActivity`
    // calls each see the snapshot before the other's insert commits; the
    // in-transaction dedup check finds nothing in both, and both inserts
    // succeed. SERIALIZABLE forces one of them to abort with SQLSTATE 40001;
    // the retry loop below restarts and the second attempt sees the winner.
    //
    // Retries are capped at SERIALIZATION_RETRY_LIMIT to bound contention.
    // The legacy `UniqueConstraintError` recovery stays inside the
    // transaction as a secondary defense for any future deployment that
    // adds a unique partial index on the dedup tuple — under SERIALIZABLE
    // it's rarely hit but is harmless.
    let lastError: unknown;
    for (let attempt = 0; attempt < SERIALIZATION_RETRY_LIMIT; attempt += 1) {
      try {
        await db.transaction(
          { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
          async (transaction) => {
            // Cross-recipient dedup check inside the transaction. A matching row
            // within the 10-minute window causes a no-op return — no activity row,
            // no recipient rows. The dedup key shape is verb-specific (see
            // `buildDedupWhere`): Follow/Announce/Editor* dedup on actor identity;
            // Flag/Report* dedup on (verb, object_type, object_id) only.
            const dedupExisting = await this.findDedupMatch(verb, actorRow, input.object, transaction);
            if (dedupExisting) {
              logger.debug(
                { activityId: dedupExisting.id, verb },
                'recordActivity deduped within window',
              );
              return;
            }

            // Insert the activity row.
            let activity: NotificationActivityEntity;
            try {
              activity = await NotificationActivityEntity.create(
                {
                  verb,
                  origin,
                  actor_kind: actorRow.actor_kind,
                  actor_account_id: actorRow.actor_account_id,
                  actor_uri: actorRow.actor_uri,
                  actor_display_name,
                  actor_display_url: actorRow.actor_display_url,
                  object_type: input.object.type,
                  object_id: input.object.id,
                  object_label,
                },
                { transaction },
              );
            }
            catch (err) {
              // Concurrency fallback: if a concurrent call inserted a matching
              // activity between our dedup-check and our insert, the DB will
              // reject this insert (only when a unique constraint covers the
              // dedup tuple — see schema note). Re-read the dedup window and
              // log the winner. Under SERIALIZABLE this path is rarely
              // reached because the serialization-failure abort beats us to it.
              if (err instanceof UniqueConstraintError) {
                const winner = await this.findDedupMatch(verb, actorRow, input.object, transaction);
                if (winner) {
                  logger.debug(
                    { activityId: winner.id, verb },
                    'recordActivity deduped via UniqueConstraint recovery',
                  );
                  return;
                }
              }
              throw err;
            }

            // Audience resolved to zero: still keep the activity row (audit trail
            // exists, click-through still works for any future caller that may
            // join on it), but skip recipient fan-out.
            if (resolvedAccountIds.length === 0) {
              return;
            }

            // Fan-out: one recipient row per resolved account. `bulkCreate`
            // handles the insert; unique constraint on
            // (notification_activity_id, account_id) catches double-fan-out
            // (e.g. a caller passing a duplicate account id) but the resolver
            // and explicit-validation paths already dedupe their outputs.
            const recipientRows = resolvedAccountIds.map((accountId) => ({
              notification_activity_id: activity.id,
              account_id: accountId,
            }));
            await NotificationRecipientEntity.bulkCreate(recipientRows, { transaction });
          },
        );
        return;
      }
      catch (err) {
        lastError = err;
        if (isSerializationFailure(err) && attempt < SERIALIZATION_RETRY_LIMIT - 1) {
          logger.debug(
            { attempt, verb },
            'recordActivity serialization conflict, retrying',
          );
          continue;
        }
        throw err;
      }
    }
    // Retry budget exhausted — surface the last serialization failure so
    // the caller can decide whether to fall back or alert.
    throw lastError ?? new Error('recordActivity exhausted serialization retry budget');
  }

  /**
   * Dismisses open recipient rows for activities matching the supplied
   * object reference and optional filters.
   *
   * The method runs the equivalent of a single UPDATE against
   * `notification_recipient` joined to `notification_activity` on
   * `(object_type, object_id)`, plus optional verb/actor filters, setting
   * `dismissed_at = NOW() WHERE dismissed_at IS NULL`. SQLite's Sequelize
   * dialect does not express UPDATE … FROM JOIN cleanly, so the
   * implementation runs the join as a SELECT to collect the matching
   * activity IDs, then a single UPDATE on `notification_recipient` with
   * `notification_activity_id IN (...)` AND `dismissed_at IS NULL`. The
   * IS NULL guard is what makes the call idempotent — a second run finds
   * no open rows to touch.
   *
   * Actor filters match the preserved-identity columns on
   * `notification_activity` and are intentionally a no-op against Flag
   * rows: Flag stores NULL identity columns so `actor_account_id = ?` or
   * `actor_uri = ?` cannot ever match.
   *
   * @throws If both `actorAccountId` and `actorUri` are set.
   */
  async dismissForObject(input: DismissForObjectInput): Promise<void> {
    // Mutex check up front — programming error, do not round-trip to DB.
    if (input.actorAccountId !== undefined && input.actorUri !== undefined) {
      throw new Error(
        'dismissForObject: at most one of actorAccountId / actorUri may be set per call',
      );
    }

    await db.transaction(async (transaction) => {
      // Build the activity-side filter. The join semantics are expressed
      // as a two-step query (find matching activity IDs → update their
      // recipients) because Sequelize's `Model.update` does not support
      // a JOIN clause portably across Postgres + SQLite. The IN-list
      // approach reads cleanly and lets us avoid raw SQL.
      const activityWhere: Record<string, unknown> = {
        object_type: input.objectType,
        object_id: input.objectId,
      };
      if (input.verbs !== undefined && input.verbs.length > 0) {
        activityWhere.verb = { [Op.in]: input.verbs };
      }
      if (input.actorAccountId !== undefined) {
        activityWhere.actor_account_id = input.actorAccountId;
      }
      if (input.actorUri !== undefined) {
        activityWhere.actor_uri = input.actorUri;
      }

      const matchingActivities = await NotificationActivityEntity.findAll({
        where: activityWhere,
        attributes: ['id'],
        transaction,
      });

      if (matchingActivities.length === 0) {
        // No matching activities → no recipients to dismiss. This is the
        // common no-op path when an actor filter does not line up (e.g.
        // Flag's NULL identity columns) or when the object simply has no
        // associated notifications.
        return;
      }

      const activityIds = matchingActivities.map((row) => row.id);

      // Single UPDATE on recipients. The `WHERE dismissed_at IS NULL`
      // clause is the idempotency guarantee — already-dismissed rows are
      // skipped so a re-run does not overwrite the original timestamp.
      await NotificationRecipientEntity.update(
        { dismissed_at: literal('CURRENT_TIMESTAMP') },
        {
          where: {
            notification_activity_id: { [Op.in]: activityIds },
            dismissed_at: { [Op.is]: null },
          },
          transaction,
        },
      );
    });
  }

  /**
   * Updates the recipient-side lifecycle flags (`seen` / `dismissed`) on a
   * single notification row. Scoped strictly to rows where
   * `account_id = <accountId>` — there is no admin override and no
   * cross-account write path. A row that exists for another account
   * returns `NotificationRecipientNotFoundError` (the route handler maps
   * to 404, identical to the genuinely-missing-id response, so callers
   * cannot use the response code to probe whether a recipient id exists
   * on the server).
   *
   * Flip semantics:
   *   - `seen: true` when `seen_at IS NULL` → sets `seen_at = new Date()`.
   *   - `seen: false` when `seen_at IS NOT NULL` → sets `seen_at = null`.
   *   - `dismissed` mirrors the above against `dismissed_at`.
   *   - Idempotent: setting the same boolean twice writes nothing.
   *
   * @throws `NotificationRecipientNotFoundError` when no row matches the
   *   `(id, accountId)` pair.
   * @throws Generic Error when neither `seen` nor `dismissed` is set —
   *   the route validates body shape before calling, so reaching this
   *   branch indicates a programming error.
   */
  async updateRecipientState(
    accountId: string,
    recipientId: string,
    input: UpdateRecipientStateInput,
  ): Promise<void> {
    if (input.seen === undefined && input.dismissed === undefined) {
      throw new Error(
        'updateRecipientState: at least one of `seen` or `dismissed` must be set',
      );
    }

    // Single-row lookup scoped to the calling account. Combining the
    // account_id filter into the WHERE (instead of fetching by id and
    // then asserting) means "row exists but belongs to another account"
    // collapses into the same "no row found" branch as "row does not
    // exist" — the response code cannot distinguish the two cases.
    const recipient = await NotificationRecipientEntity.findOne({
      where: {
        id: recipientId,
        account_id: accountId,
      },
    });

    if (recipient === null) {
      throw new NotificationRecipientNotFoundError();
    }

    // Compute the next-state timestamps before issuing the UPDATE so the
    // idempotent no-op case (same boolean as the current derived state)
    // skips the write entirely.
    const updates: Partial<{ seen_at: Date | null; dismissed_at: Date | null }> = {};
    if (input.seen !== undefined) {
      const currentlySeen = recipient.seen_at !== null;
      if (input.seen !== currentlySeen) {
        updates.seen_at = input.seen ? new Date() : null;
      }
    }
    if (input.dismissed !== undefined) {
      const currentlyDismissed = recipient.dismissed_at !== null;
      if (input.dismissed !== currentlyDismissed) {
        updates.dismissed_at = input.dismissed ? new Date() : null;
      }
    }

    if (Object.keys(updates).length === 0) {
      // No-op: derived booleans already match the requested state.
      return;
    }

    await recipient.update(updates);
  }

  /**
   * Returns paginated notifications for the supplied account, ordered by
   * recipient creation date descending (most recent first). The query is
   * scoped strictly to `notification_recipient` rows where
   * `account_id = <accountId>` — there is no admin override; admins access
   * underlying objects via their domain endpoints, not via another account's
   * inbox.
   *
   * Active-only by default: rows with a non-null `dismissed_at` are excluded.
   * Dismissed rows are produced by object-state transitions (e.g. a report
   * being resolved fires `dismissForObject` which sets `dismissed_at` on
   * every recipient of the originating Flag) and by user-initiated
   * dismissals; the active inbox should not surface them. The seven-day
   * retention sweep eventually deletes dismissed rows
   * (`retention-cleanup.ts`); until then, this filter keeps them out of the
   * default list — the admin inbox query (filtered to
   * non-dismissed) no longer returns the Flag.
   *
   * Returns the wire shape directly (no entity-to-model projection in
   * between) because the read path's natural domain model IS the per-
   * recipient response: there is no per-recipient domain object that
   * diverges from what the client renders. The (recipient, activity) join
   * is fetched eagerly and projected inline.
   *
   * Identity columns on `notification_activity` (`actor_account_id`,
   * `actor_uri`) are intentionally dropped here; only `actor.kind`,
   * `actor.displayName`, and `actor.displayUrl` reach the response. For
   * Flag rows the entity layer already stores `actor_kind='anonymous'` with
   * identity columns NULL, so the projection cannot leak Flag reporter
   * identity even by accident.
   *
   * @param accountId - Authenticated account id; the scope filter.
   * @param limit - Page size (already clamped by the route handler).
   * @param offset - Pagination offset (already clamped by the route handler).
   */
  async getNotifications(
    accountId: string,
    limit: number,
    offset: number,
  ): Promise<NotificationResponse[]> {
    const rows = await NotificationRecipientEntity.findAll({
      where: {
        account_id: accountId,
        dismissed_at: { [Op.is]: null },
      },
      include: [{ model: NotificationActivityEntity, required: true }],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    return rows.map((row) => this.toNotificationResponse(row as RecipientWithActivity));
  }

  /**
   * Projects an eager-loaded `(recipient, activity)` pair to the wire
   * shape. The `seen`/`dismissed` flags are derived inline from the
   * recipient's nullable timestamps (the new persistence layer dropped the
   * boolean projections per pv-89mw.2.3).
   *
   * Identity columns (`actor_account_id`, `actor_uri`) are intentionally
   * dropped here. For Flag rows the entity layer already stores them NULL,
   * so this is defense-in-depth.
   */
  private toNotificationResponse(recipient: RecipientWithActivity): NotificationResponse {
    const activity = recipient.activity;
    return {
      id: recipient.id,
      activityId: activity.id,
      verb: activity.verb,
      origin: activity.origin as 'local' | 'federated',
      actor: {
        kind: activity.actor_kind as NotificationResponse['actor']['kind'],
        displayName: activity.actor_display_name,
        displayUrl: activity.actor_display_url ?? null,
      },
      object: {
        type: activity.object_type,
        id: activity.object_id,
        label: activity.object_label,
      },
      seen: recipient.seen_at !== null,
      dismissed: recipient.dismissed_at !== null,
      createdAt: recipient.created_at.toISOString(),
    };
  }

  /**
   * Resolves the `audience` field into the recipient account-id list.
   *
   * - `kind='role'` delegates to the role resolver (pv-89mw.3.3).
   * - `kind='explicit'` validates each id against the account table and
   *   silently drops ones that don't resolve. The over-50 size check has
   *   already happened in `recordActivity`; this method is the lookup pass.
   */
  private async resolveAudience(audience: RecordActivityAudience): Promise<string[]> {
    if (audience.kind === 'role') {
      return this.resolveRoleAudience(audience.role, audience.objectRef, this.deps);
    }

    // Explicit: validate IDs against accounts; drop nonexistent silently.
    // The validation runs as a single query (`IN (...)`) rather than N
    // round-trips so the worst case stays bounded.
    if (audience.accountIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(audience.accountIds));
    const existing = await AccountEntity.findAll({
      where: { id: { [Op.in]: uniqueIds } },
      attributes: ['id'],
    });
    const existingIds = new Set(existing.map((row) => row.id));
    // Preserve input order for deterministic recipient row order.
    return uniqueIds.filter((id) => existingIds.has(id));
  }

  /**
   * Builds the actor row that will be persisted on `notification_activity`.
   *
   * For `verb='Flag'`, the anonymization policy (pv-89mw.3.2) discards the
   * caller's actor identity entirely and computes display fields from the
   * actor discriminator alone. For all other verbs the caller's actor
   * identity flows through, with `actor_display_name` defaulting to a
   * placeholder if the caller didn't supply one (the field is non-nullable
   * on the entity).
   */
  private buildActorRow(input: RecordActivityInput): ActorRow {
    if (input.verb === 'Flag') {
      const flagInput = this.actorToFlagInput(input.actor);
      const anonymized = anonymizeFlagActor(flagInput);
      return {
        actor_kind: anonymized.actor_kind,
        actor_account_id: anonymized.actor_account_id,
        actor_uri: anonymized.actor_uri,
        actor_display_name: anonymized.actor_display_name,
        actor_display_url: anonymized.actor_display_url,
      };
    }

    // Non-Flag verbs: caller-supplied identity passes through, but the
    // reserved `i18n:` prefix is scrubbed — only the Flag anonymization
    // policy is permitted to emit i18n tokens (see scrubReservedI18nPrefix).
    const displayName = scrubReservedI18nPrefix(input.actorDisplayName);
    switch (input.actor.kind) {
      case 'account':
        return {
          actor_kind: 'account',
          actor_account_id: input.actor.accountId,
          actor_uri: null,
          actor_display_name: displayName,
          actor_display_url: input.actorDisplayUrl ?? null,
        };
      case 'remote_actor':
        return {
          actor_kind: 'remote_actor',
          actor_account_id: null,
          actor_uri: input.actor.uri,
          actor_display_name: displayName,
          actor_display_url: input.actorDisplayUrl ?? null,
        };
      case 'system':
        return {
          actor_kind: 'system',
          actor_account_id: null,
          actor_uri: null,
          actor_display_name: displayName,
          actor_display_url: input.actorDisplayUrl ?? null,
        };
      case 'anonymous':
      default:
        return {
          actor_kind: 'anonymous',
          actor_account_id: null,
          actor_uri: null,
          actor_display_name: displayName,
          actor_display_url: input.actorDisplayUrl ?? null,
        };
    }
  }

  /**
   * Adapts the public `RecordActivityActor` discriminator to the
   * `anonymizeFlagActor` input shape. The notifications service uses
   * `anonymous` as the catch-all caller-supplied form (web-form reports);
   * the anonymizer's input vocabulary names this `anonymous_web` for clarity.
   *
   * `kind: 'system'` is explicitly rejected here rather than silently
   * collapsed into the anonymous form. The verb catalog enumerates exactly three Flag reporter cases —
   * local account, remote AP actor, anonymous web form — and a system
   * actor is none of those: it carries no retaliation risk (the privacy
   * rationale for anonymization) and rendering it as "Anonymous reporter"
   * would be presentationally wrong. If a scheduler-driven Flag verb is
   * ever introduced, this guard must be revisited alongside the design.
   */
  private actorToFlagInput(actor: RecordActivityActor): FlagActorInput {
    switch (actor.kind) {
      case 'account':
        return { kind: 'account', accountId: actor.accountId };
      case 'remote_actor':
        return { kind: 'remote_actor', uri: actor.uri };
      case 'anonymous':
        return { kind: 'anonymous_web' };
      case 'system':
        throw new Error(
          "Flag verb does not support actor kind 'system' "
          + '(three reporter cases only: local account, remote AP actor, '
          + 'anonymous web form).',
        );
      default: {
        const exhaustiveCheck: never = actor;
        throw new Error(`Unknown actor kind: ${String(exhaustiveCheck)}`);
      }
    }
  }

  /**
   * Looks for a prior matching activity row inside the dedup window.
   *
   * The where-clause is verb-specific:
   *   - Follow/Announce/EditorInvited/EditorRevoked dedup on
   *     `(verb, actor_kind, actor_account_id|actor_uri, object_type, object_id)`.
   *     Same actor performing the same action on the same object collapses.
   *   - Flag dedups on `(verb, object_type, object_id)` only — actor
   *     identity is intentionally NOT a dedup component because Flag rows
   *     store no actor identity.
   *   - ReportEscalated/ReportResolved dedup on
   *     `(verb, object_type, object_id)`. Lifecycle transitions on the
   *     same report collapse.
   *
   * Returns the first matching row (any matching row triggers the no-op
   * dedup return), or null when no match exists in the window.
   */
  private async findDedupMatch(
    verb: NotificationVerb,
    actorRow: ActorRow,
    object: RecordActivityObject,
    transaction: Transaction,
  ): Promise<NotificationActivityEntity | null> {
    const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);

    const where: Record<string, unknown> = {
      verb,
      object_type: object.type,
      object_id: object.id,
      created_at: { [Op.gte]: dedupCutoff },
    };

    if (this.isActorKeyedVerb(verb)) {
      // Actor-identity component: scope by actor_kind, then by
      // actor_account_id or actor_uri depending on the kind. The 'anonymous'
      // / 'system' branches are defensive — they have no real per-actor
      // identifier so they collapse on the object key alone.
      where.actor_kind = actorRow.actor_kind;
      if (actorRow.actor_kind === 'account') {
        where.actor_account_id = actorRow.actor_account_id;
      }
      else if (actorRow.actor_kind === 'remote_actor') {
        where.actor_uri = actorRow.actor_uri;
      }
    }

    return NotificationActivityEntity.findOne({ where, transaction });
  }

  /**
   * Whether the verb's dedup key includes actor identity. Centralized so the
   * dedup-check and any future unique-constraint design read from a single
   * source of truth.
   */
  private isActorKeyedVerb(verb: NotificationVerb): boolean {
    switch (verb) {
      case 'Follow':
      case 'Announce':
      case 'EditorInvited':
      case 'EditorRevoked':
        return true;
      case 'Flag':
      case 'ReportEscalated':
      case 'ReportResolved':
        return false;
      default: {
        const exhaustiveCheck: never = verb;
        throw new Error(`Unknown notification verb: ${String(exhaustiveCheck)}`);
      }
    }
  }
}

export default NotificationService;
