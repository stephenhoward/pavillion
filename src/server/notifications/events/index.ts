import { EventEmitter } from 'events';

import { DomainEventHandlers } from '@/server/common/types/domain';
import NotificationService, { type RecordActivityActor } from '@/server/notifications/service/notification';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import { createLogger } from '@/server/common/helper/logger';
import { CALENDAR_BUS_EVENTS, type EditorInvitedPayload, type EditorRevokedPayload } from '@/server/calendar/events/types';
import {
  MODERATION_BUS_EVENTS,
  type ReportFlaggedPayload,
  type ReportEscalatedBusPayload,
  type ReportResolvedBusPayload,
} from '@/server/moderation/events/types';

const logger = createLogger('notifications');

/**
 * Fallback `object_label` strings used when the cross-domain lookup at
 * snapshot time fails or yields no usable name. These keep the persisted
 * row non-empty so the deleted-object render path still produces a readable
 * inbox row.
 *
 * The strings are intentionally generic — they are the labels of last
 * resort when the underlying calendar/event is gone or unreachable at
 * emit time. Clients localize via i18n keys at render time when they
 * detect these fallbacks; the snapshot value here is the English
 * baseline.
 */
const LABEL_FALLBACK_CALENDAR = 'Calendar';
const LABEL_FALLBACK_EVENT = 'Event';
const LABEL_FALLBACK_REPORT = 'Report';

/**
 * Payload for the existing `activitypub:calendar:followed` event emitted by
 * the AP inbox after a remote actor follows a local calendar. `followerUrl`
 * is the AP actor URI; nullable purely for defensive payload-construction.
 */
export interface CalendarFollowedPayload {
  calendarId: string;
  followerName: string;
  followerUrl: string | null;
}

/**
 * Payload for the existing `activitypub:event:reposted` event emitted by the
 * AP inbox after a remote actor announces a local event. `reposterUrl` is
 * the AP actor URI; nullable purely for defensive payload-construction.
 */
export interface EventRepostedPayload {
  eventId: string;
  calendarId: string;
  reposterName: string;
  reposterUrl: string | null;
}

/**
 * NotificationEventHandlers — the single subscriber that turns cross-domain
 * bus events into notification activity rows.
 *
 * Emitting domains
 * never call `NotificationsInterface` directly. They emit events; this
 * class subscribes and routes to `recordActivity` / `dismissForObject`.
 *
 * The seven subscriptions cover both the AP-inbox flows (Follow, Announce)
 * carried over from the legacy notifications path and the new local-domain
 * flows (Flag/Escalated/Resolved from moderation, EditorInvited/Revoked
 * from calendar).
 *
 * Audience-resolution rules
 * justification (cases 1–7):
 *   - Cases 1–2 (Follow, Announce) — `audience.kind='role'` with
 *     `calendar-editors`. The role resolver runs inside `recordActivity`.
 *   - Case 3 (Flag) — owners + admins together. Because
 *     `RecordActivityAudience` is single-valued and the Flag dedup key
 *     `(verb, object_type, object_id)` would collapse a second call,
 *     the handler resolves both role lists itself via the injected
 *     interfaces and passes the combined set as `audience.kind='explicit'`.
 *   - Case 4 (ReportEscalated) — `audience.kind='role'` with
 *     `instance-admins`.
 *   - Case 5 (ReportResolved) — explicit; reviewer is the natural
 *     recipient for the in-app row. Followed by a `dismissForObject`
 *     call that closes the prior Flag/ReportEscalated notifications for
 *     the same Report.
 *   - Cases 6–7 (EditorInvited, EditorRevoked) — explicit; the invitee /
 *     revoked editor is the natural single recipient.
 *
 * Snapshot label sourcing — **snapshot-on-write**
 * object encoding. At emit time each handler resolves the object's display
 * name through the cross-domain interface it already holds (CalendarInterface
 * for calendar/event lookups) and passes it as `object.label` so the
 * persisted row carries a non-empty snapshot. This is the design the
 * deleted-object render fallback depends on: once the
 * underlying calendar/event/report is gone, the snapshot label is the only
 * remaining display string.
 *
 * Lookup failures are non-fatal — they fall back to a verb-specific generic
 * label (`Calendar` / `Event` / `Report`) so the inbox row remains readable
 * even when the cross-domain call fails. The fallback strings are short and
 * generic by design; clients may swap them for localized strings at render
 * time, but the snapshot is the unconditional baseline.
 *
 * For Flag / ReportEscalated / ReportResolved, the bus payload carries
 * both `eventId` and `calendarId`. Per
 * ("object_label for a Flag is the event title — most useful for the
 * recipient"), the handler prefers the flagged event's title and falls
 * back to the owning calendar's name when the event lookup fails or
 * returns an empty title. For admin reports against remote events
 * (`calendarId === null` and the event is not locally resolvable), the
 * generic `Report` fallback is used.
 *
 * Error handling: every handler is wrapped so a notification-side failure
 * does not surface back to the bus emitter. Notifications is a side-
 * effect consumer; an inbox-row insert failure must never roll back the
 * underlying calendar/moderation/AP transaction.
 */
export default class NotificationEventHandlers implements DomainEventHandlers {
  private service: NotificationService;
  private calendarInterface: CalendarInterface;
  private accountsInterface: AccountsInterface;

  constructor(
    service: NotificationService,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
  ) {
    this.service = service;
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('activitypub:calendar:followed', this.handleCalendarFollowed.bind(this));
    eventBus.on('activitypub:event:reposted', this.handleEventReposted.bind(this));
    eventBus.on(MODERATION_BUS_EVENTS.REPORT_FLAGGED, this.handleReportFlagged.bind(this));
    eventBus.on(MODERATION_BUS_EVENTS.REPORT_ESCALATED, this.handleReportEscalated.bind(this));
    eventBus.on(MODERATION_BUS_EVENTS.REPORT_RESOLVED, this.handleReportResolved.bind(this));
    eventBus.on(CALENDAR_BUS_EVENTS.EDITOR_INVITED, this.handleEditorInvited.bind(this));
    eventBus.on(CALENDAR_BUS_EVENTS.EDITOR_REVOKED, this.handleEditorRevoked.bind(this));
  }

  // ---------------------------------------------------------------------------
  // Snapshot label resolvers — cross-domain lookups at emit time
  // ---------------------------------------------------------------------------

  /**
   * Looks up a calendar by id and returns its display name. Returns
   * {@link LABEL_FALLBACK_CALENDAR} if the calendar is missing, the lookup
   * throws, or no language has a populated name (a Calendar with only the
   * `urlName` populated still hits the fallback — `urlName` is a slug, not
   * a display string).
   *
   * Lookup failures are intentionally silent: notifications is a side-
   * effect consumer, and label resolution is best-effort.
   */
  private async resolveCalendarLabel(calendarId: string): Promise<string> {
    try {
      const calendar = await this.calendarInterface.getCalendar(calendarId);
      if (!calendar) {
        return LABEL_FALLBACK_CALENDAR;
      }
      return calendar.displayName(LABEL_FALLBACK_CALENDAR);
    }
    catch (error) {
      logger.debug({ err: error, calendarId }, 'resolveCalendarLabel lookup failed');
      return LABEL_FALLBACK_CALENDAR;
    }
  }

  /**
   * Looks up an event by id and returns its title. Returns
   * {@link LABEL_FALLBACK_EVENT} on missing event, lookup failure, or
   * empty title across all populated languages.
   */
  private async resolveEventLabel(eventId: string): Promise<string> {
    try {
      const event = await this.calendarInterface.getEventById(eventId);
      return event.displayName(LABEL_FALLBACK_EVENT);
    }
    catch (error) {
      logger.debug({ err: error, eventId }, 'resolveEventLabel lookup failed');
      return LABEL_FALLBACK_EVENT;
    }
  }

  /**
   * Looks up an account by id and returns its display name. Returns an
   * empty string when the account is missing, the lookup throws, or the
   * account has no display name set.
   *
   * The empty fallback is intentional: the notifications service treats
   * `actorDisplayName=''` as "no actor name" and persists it as the empty
   * string. The render path (client `useNotificationDisplay`) hides the
   * actor span when display name is empty, which is the same behaviour we
   * want when the granting/revoking account has been deleted.
   *
   * Lookup failures are intentionally silent — notifications is a side-
   * effect consumer and actor identity is best-effort, matching the
   * label-resolver pattern above.
   */
  private async resolveAccountDisplayName(accountId: string): Promise<string> {
    try {
      const account = await this.accountsInterface.getAccountById(accountId);
      return account?.displayName ?? '';
    }
    catch (error) {
      logger.debug({ err: error, accountId }, 'resolveAccountDisplayName lookup failed');
      return '';
    }
  }

  /**
   * Resolves the snapshot label for the Flag / ReportEscalated /
   * ReportResolved family., the most
   * useful display string for a recipient is the **event title** — that's
   * what makes the inbox row meaningful at a glance.
   *
   * Resolution order:
   *   1. The flagged event's title (via `CalendarInterface.getEventById`).
   *   2. The owning calendar's name (via `getCalendar`) when the event
   *      lookup fails or returns an empty title. This covers federated
   *      Flags against remote events whose row exists locally but whose
   *      title is not retained, and the deletion-race window between
   *      report creation and event deletion.
   *   3. The generic `Report` fallback when both lookups fail, or when
   *      `calendarId === null` and the event is not locally resolvable
   *      (admin-initiated reports against remote events).
   *
   * Lookup failures are intentionally silent: notifications is a side-
   * effect consumer, and label resolution is best-effort. The snapshot
   * is persisted with whatever string we can find — empty strings are
   * never written.
   */
  private async resolveReportLabel(eventId: string, calendarId: string | null): Promise<string> {
    try {
      const event = await this.calendarInterface.getEventById(eventId);
      const title = event.displayName('');
      if (title !== '') {
        return title;
      }
    }
    catch (error) {
      logger.debug({ err: error, eventId }, 'resolveReportLabel event lookup failed; trying calendar fallback');
    }
    if (calendarId === null) {
      return LABEL_FALLBACK_REPORT;
    }
    try {
      const calendar = await this.calendarInterface.getCalendar(calendarId);
      if (calendar) {
        const name = calendar.displayName('');
        if (name !== '') {
          return name;
        }
      }
    }
    catch (error) {
      logger.debug({ err: error, calendarId }, 'resolveReportLabel calendar fallback lookup failed');
    }
    return LABEL_FALLBACK_REPORT;
  }

  // ---------------------------------------------------------------------------
  // ActivityPub-origin handlers
  // ---------------------------------------------------------------------------

  /**
   * `activitypub:calendar:followed` → `Follow` activity addressed to the
   * calendar's editors. Origin is always `federated` because the AP inbox
   * is the only emitter. The actor identity is the remote AP actor URI
   * carried on `payload.followerUrl`.
   */
  private async handleCalendarFollowed(payload: CalendarFollowedPayload): Promise<void> {
    try {
      const label = await this.resolveCalendarLabel(payload.calendarId);
      await this.service.recordActivity({
        verb: 'Follow',
        origin: 'federated',
        actor: payload.followerUrl
          ? { kind: 'remote_actor', uri: payload.followerUrl }
          : { kind: 'anonymous' },
        actorDisplayName: payload.followerName,
        actorDisplayUrl: payload.followerUrl,
        object: {
          type: 'calendar',
          id: payload.calendarId,
          label,
        },
        audience: {
          kind: 'role',
          role: 'calendar-editors',
          objectRef: { type: 'calendar', id: payload.calendarId },
        },
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling activitypub:calendar:followed');
    }
  }

  /**
   * `activitypub:event:reposted` → `Announce` activity addressed to the
   * editors of the announced event's calendar. The emitter has already
   * resolved event→calendar before emitting, so the role resolver maps
   * `calendar-editors` to the calendar editors directly.
   */
  private async handleEventReposted(payload: EventRepostedPayload): Promise<void> {
    try {
      const label = await this.resolveEventLabel(payload.eventId);
      await this.service.recordActivity({
        verb: 'Announce',
        origin: 'federated',
        actor: payload.reposterUrl
          ? { kind: 'remote_actor', uri: payload.reposterUrl }
          : { kind: 'anonymous' },
        actorDisplayName: payload.reposterName,
        actorDisplayUrl: payload.reposterUrl,
        object: {
          type: 'event',
          id: payload.eventId,
          label,
        },
        audience: {
          kind: 'role',
          role: 'calendar-editors',
          objectRef: { type: 'calendar', id: payload.calendarId },
        },
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling activitypub:event:reposted');
    }
  }

  // ---------------------------------------------------------------------------
  // Moderation-origin handlers
  // ---------------------------------------------------------------------------

  /**
   * `moderation:report:flagged` → `Flag` activity addressed to both
   * `calendar-owners` (of the flagged event's calendar) and
   * `instance-admins`. Because `RecordActivityAudience` is single-valued
   * and the Flag dedup key is object-keyed (no actor component), the
   * handler resolves both role lists locally and passes the combined,
   * deduplicated set as `audience.kind='explicit'`.
   *
   * Reporter identity for local reports is intentionally absent from the
   * bus payload (see `ReportFlaggedPayload`). For federated reports, the
   * payload carries the AP actor URI on `actorUri`; the handler forwards
   * it as a `remote_actor` actor so the Flag anonymizer inside
   * `recordActivity` can derive the reporting instance's
   * `https://<host>` display URL. The anonymizer always nulls out the
   * identity columns (`actor_account_id`, `actor_uri`) and sets
   * `actor_kind='anonymous'`; the only behavioural delta is the
   * presence of the per-host display URL for federated reports.
   *
   * `calendarId === null` is possible when an admin reports a remote
   * event (no local calendar owns it). In that case there are no
   * calendar-owners to address; instance-admins still get the row.
   */
  private async handleReportFlagged(payload: ReportFlaggedPayload): Promise<void> {
    try {
      const ownerIds = payload.calendarId
        ? (await this.calendarInterface.getOwnersForCalendar(payload.calendarId)).map(o => o.id)
        : [];
      const adminIds = await this.accountsInterface.getInstanceAdmins();
      const combined = Array.from(new Set([...ownerIds, ...adminIds]));
      const label = await this.resolveReportLabel(payload.eventId, payload.calendarId);

      // Federated Flags carry the reporter's AP actor URI so the Flag
      // anonymizer can stamp the `https://<host>` display URL on the
      // notification row. The URI itself is discarded by the anonymizer;
      // only the host portion is retained for display. Local Flags omit
      // the actor identity.
      const actor: RecordActivityActor = payload.origin === 'federated' && payload.actorUri
        ? { kind: 'remote_actor', uri: payload.actorUri }
        : { kind: 'anonymous' };

      await this.service.recordActivity({
        verb: 'Flag',
        origin: payload.origin,
        actor,
        object: {
          type: 'report',
          id: payload.reportId,
          label,
        },
        audience: {
          kind: 'explicit',
          accountIds: combined,
        },
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling moderation:report:flagged');
    }
  }

  /**
   * `moderation:report:escalated` → `ReportEscalated` activity addressed
   * to `instance-admins`. The escalating actor (scheduler, admin, or
   * calendar owner who dismissed) is not surfaced as the activity actor —
   * the row reads as a state-change notification, and the bus payload
   * deliberately omits reviewer identity. Actor is recorded as `system`.
   */
  private async handleReportEscalated(payload: ReportEscalatedBusPayload): Promise<void> {
    try {
      const label = await this.resolveReportLabel(payload.eventId, payload.calendarId);
      await this.service.recordActivity({
        verb: 'ReportEscalated',
        origin: 'local',
        actor: { kind: 'system' },
        object: {
          type: 'report',
          id: payload.reportId,
          label,
        },
        audience: {
          kind: 'role',
          role: 'instance-admins',
        },
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling moderation:report:escalated');
    }
  }

  /**
   * `moderation:report:resolved` → two side effects:
   *   1. Record a `ReportResolved` activity addressed to the reviewer
   *      who closed the report (explicit single recipient).
   *   2. Dismiss all open recipient rows for prior `Flag` and
   *      `ReportEscalated` activities on the same Report. the dismissal scope
   *      decision is local to this handler — no other domain needs to
   *      know.
   *
   * Both steps are best-effort independently: the dismissal runs even
   * when the activity record was deduped, so an idempotent re-emit of
   * the resolved event yields the correct end state (recipients stay
   * dismissed; first-run timestamps are preserved by the
   * `WHERE dismissed_at IS NULL` guard inside `dismissForObject`).
   */
  private async handleReportResolved(payload: ReportResolvedBusPayload): Promise<void> {
    try {
      const label = await this.resolveReportLabel(payload.eventId, payload.calendarId);
      await this.service.recordActivity({
        verb: 'ReportResolved',
        origin: 'local',
        // The reviewer is the action's actor but their identity stays in
        // moderation; the activity records `system` for the inbox row
        // and the in-app recipient is the reviewer themselves (explicit
        // audience). The verb name carries the lifecycle meaning.
        actor: { kind: 'system' },
        object: {
          type: 'report',
          id: payload.reportId,
          label,
        },
        audience: {
          kind: 'explicit',
          accountIds: [payload.reviewerId],
        },
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling moderation:report:resolved (recordActivity)');
    }

    // The dismissal step is independent of whether the activity record
    // was inserted or deduped — even when deduped (a duplicate resolve
    // event) the dismissal must still happen because the original
    // resolve might not have completed cleanly. The
    // `WHERE dismissed_at IS NULL` guard inside `dismissForObject`
    // preserves prior-run timestamps for idempotency.
    try {
      await this.service.dismissForObject({
        objectType: 'report',
        objectId: payload.reportId,
        verbs: ['Flag', 'ReportEscalated'],
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling moderation:report:resolved (dismissForObject)');
    }
  }

  // ---------------------------------------------------------------------------
  // Calendar editor-membership handlers
  // ---------------------------------------------------------------------------

  /**
   * `calendar:editor:invited` → `EditorInvited` activity addressed
   * explicitly to the invitee. The grant-issuing actor is supplied via
   * `payload.grantedBy` and recorded as `account`-kind on the activity.
   *
   * The granting account's display name is resolved via the injected
   * AccountsInterface at emit time and passed as `actorDisplayName` —
   * without it the persisted row carries an empty actor name and the
   * inbox renders a grammatically broken sentence (pv-02kb.1).
   */
  private async handleEditorInvited(payload: EditorInvitedPayload): Promise<void> {
    try {
      const [label, actorDisplayName] = await Promise.all([
        this.resolveCalendarLabel(payload.calendarId),
        this.resolveAccountDisplayName(payload.grantedBy),
      ]);
      await this.service.recordActivity({
        verb: 'EditorInvited',
        origin: 'local',
        actor: { kind: 'account', accountId: payload.grantedBy },
        actorDisplayName,
        object: {
          type: 'calendar',
          id: payload.calendarId,
          label,
        },
        audience: {
          kind: 'explicit',
          accountIds: [payload.accountId],
        },
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling calendar:editor:invited');
    }
  }

  /**
   * `calendar:editor:revoked` → `EditorRevoked` activity addressed
   * explicitly to the revoked editor. The revoking actor is supplied via
   * `payload.revokedBy` and recorded as `account`-kind on the activity.
   *
   * The revoking account's display name is resolved via the injected
   * AccountsInterface at emit time and passed as `actorDisplayName` —
   * without it the persisted row carries an empty actor name and the
   * inbox renders a grammatically broken sentence (pv-02kb.1).
   */
  private async handleEditorRevoked(payload: EditorRevokedPayload): Promise<void> {
    try {
      const [label, actorDisplayName] = await Promise.all([
        this.resolveCalendarLabel(payload.calendarId),
        this.resolveAccountDisplayName(payload.revokedBy),
      ]);
      await this.service.recordActivity({
        verb: 'EditorRevoked',
        origin: 'local',
        actor: { kind: 'account', accountId: payload.revokedBy },
        actorDisplayName,
        object: {
          type: 'calendar',
          id: payload.calendarId,
          label,
        },
        audience: {
          kind: 'explicit',
          accountIds: [payload.accountId],
        },
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling calendar:editor:revoked');
    }
  }
}
