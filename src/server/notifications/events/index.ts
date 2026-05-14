import { EventEmitter } from 'events';

import { DomainEventHandlers } from '@/server/common/types/domain';
import NotificationService from '@/server/notifications/service/notification';
import CalendarInterface from '@/server/calendar/interface';
import { createLogger } from '@/server/common/helper/logger';
import { Report, ReportStatus } from '@/common/model/report';

const logger = createLogger('notifications');

export interface CalendarFollowedPayload {
  calendarId: string;
  followerName: string;
  followerUrl: string | null;
}

export interface EventRepostedPayload {
  eventId: string;
  calendarId: string;
  reposterName: string;
  reposterUrl: string | null;
}

/**
 * Payload for the activitypub:event:unreposted event bus emission. The
 * notifications domain is one of multiple listeners; the canonical type lives
 * in the calendar domain (src/server/calendar/events/index.ts) but is restated
 * here because cross-domain imports are not permitted. The shape must stay in
 * sync.
 *
 * Emitted by both the local-unpost flow and the inbound-unshare flow:
 *   - Local flow: actorAccountId set (the local editor who unposted),
 *     actorUrl null.
 *   - Inbound flow: actorAccountId null, actorUrl set to the remote actor's
 *     https:// profile URL.
 *
 * Local-event invariant: the event being unreposted is local to this
 * instance. Inbound unshare for remote-origin events is filtered at the
 * inbox emit site, not here.
 *
 * Idempotency: emit fires once per destroyed SharedEventEntity row. A
 * second unshare on an already-dismissed event has no row to destroy and
 * therefore no emit (see DEC-008 sticky-dismissal flow).
 *
 * Handler branching: the handler uses actorAccountId presence to decide
 * audience — local-flow emissions exclude the initiating editor from the
 * co-editor fan-out ("owner-initiated actions exclude initiator"
 * convention); inbound-flow emissions notify every editor (no initiator on
 * this instance).
 */
export interface EventUnrepostedPayload {
  eventId: string;
  calendarId: string;
  actorName: string;
  actorUrl: string | null;
  actorAccountId: string | null;
}

export interface ReportCreatedPayload {
  report: Report;
  reporterEmail?: string;
}

export interface ReportReceivedPayload {
  report: Report;
}

export interface ReportVerifiedPayload {
  report: Report;
}

export interface ReportEscalatedPayload {
  report: Report;
  reason: string;
}

export default class NotificationEventHandlers implements DomainEventHandlers {
  private service: NotificationService;
  private calendarInterface: CalendarInterface;

  constructor(service: NotificationService, calendarInterface: CalendarInterface) {
    this.service = service;
    this.calendarInterface = calendarInterface;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('activitypub:calendar:followed', this.handleCalendarFollowed.bind(this));
    eventBus.on('activitypub:event:reposted', this.handleEventReposted.bind(this));
    eventBus.on('activitypub:event:unreposted', this.handleEventUnreposted.bind(this));
    eventBus.on('reportCreated', this.handleReportCreated.bind(this));
    eventBus.on('reportReceived', this.handleReportReceived.bind(this));
    eventBus.on('reportVerified', this.handleReportVerified.bind(this));
    eventBus.on('reportEscalated', this.handleReportEscalated.bind(this));
    eventBus.on('reportAutoEscalated', this.handleReportEscalated.bind(this));
  }

  private async handleCalendarFollowed(payload: CalendarFollowedPayload): Promise<void> {
    try {
      const accounts = await this.calendarInterface.getEditorsForCalendar(payload.calendarId);
      for (const account of accounts) {
        await this.service.createNotification(
          'follow',
          payload.calendarId,
          null,
          payload.followerName,
          payload.followerUrl,
          account.id,
        );
      }
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling activitypub:calendar:followed');
    }
  }

  private async handleEventReposted(payload: EventRepostedPayload): Promise<void> {
    try {
      const accounts = await this.calendarInterface.getEditorsForCalendar(payload.calendarId);
      for (const account of accounts) {
        await this.service.createNotification(
          'repost',
          payload.calendarId,
          payload.eventId,
          payload.reposterName,
          payload.reposterUrl,
          account.id,
        );
      }
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling activitypub:event:reposted');
    }
  }

  /**
   * Handles the activitypub:event:unreposted event by notifying calendar
   * editors that a reposted event was unposted (DEC-008 sticky dismissal
   * flow).
   *
   * Audience branches on actorAccountId presence:
   *   - Local flow (actorAccountId set): the editor who performed the unpost
   *     is excluded from the fan-out — the "owner-initiated actions exclude
   *     initiator" convention. actorUrl is null because the actor is a local
   *     user already known to co-editors (privacy-playbook: data
   *     minimization).
   *   - Inbound flow (actorAccountId null): a remote calendar undid a share
   *     of a local event. No local initiator exists, so every editor is
   *     notified, and actorUrl carries the remote actor's profile URL so
   *     the notification can link back to them.
   */
  private async handleEventUnreposted(payload: EventUnrepostedPayload): Promise<void> {
    try {
      const accounts = await this.calendarInterface.getEditorsForCalendar(payload.calendarId);
      const recipients = payload.actorAccountId
        ? accounts.filter(account => account.id !== payload.actorAccountId)
        : accounts;
      for (const account of recipients) {
        await this.service.createNotification(
          'unshare',
          payload.calendarId,
          payload.eventId,
          payload.actorName,
          payload.actorUrl,
          account.id,
        );
      }
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling activitypub:event:unreposted');
    }
  }

  /**
   * Handles the reportCreated event by notifying calendar editors that
   * a report was filed against an event on their calendar. Skips reports
   * that are still PENDING_VERIFICATION (anonymous unverified reporters)
   * to avoid surfacing reports that may never be confirmed.
   *
   * Privacy invariant (DEC-004, moderation-privacy): reporter identity
   * is never written to the notification. actorName and actorUrl are
   * always empty/null regardless of reporterType.
   */
  private async handleReportCreated(payload: ReportCreatedPayload): Promise<void> {
    if (payload.report.status === ReportStatus.PENDING_VERIFICATION) {
      return;
    }
    await this.fanOutReportNotification('report_received', payload.report);
  }

  /**
   * Handles the federated reportReceived event (inbound Flag activities).
   * Moderation emits this only for already-SUBMITTED reports, so no
   * status guard is required here.
   */
  private async handleReportReceived(payload: ReportReceivedPayload): Promise<void> {
    await this.fanOutReportNotification('report_received', payload.report);
  }

  /**
   * Handles the reportVerified event by notifying calendar editors that
   * an anonymous reporter completed email verification.
   */
  private async handleReportVerified(payload: ReportVerifiedPayload): Promise<void> {
    await this.fanOutReportNotification('report_verified', payload.report);
  }

  /**
   * Handles both reportEscalated (manual) and reportAutoEscalated events.
   * The escalation reason is intentionally ignored to prevent admin-authored
   * notes or system-derived text from reaching editors through this channel.
   */
  private async handleReportEscalated(payload: ReportEscalatedPayload): Promise<void> {
    await this.fanOutReportNotification('report_escalated', payload.report);
  }

  /**
   * Fans out a report-related notification to every account that can review
   * reports on the report's calendar — admins, the owner, and editors with
   * can_review_reports=true. The recipient list is strictly the set of
   * accounts that can act on the report; editors without report-review
   * permission do not receive a deep-link they cannot use (pv-2ppm).
   *
   * Reporter identity is never surfaced — actorName is always the empty
   * string and actorUrl is always null, regardless of reporterType (DEC-004,
   * moderation-privacy). report.id is forwarded so the inbox can deep-link
   * to the report detail surface.
   */
  private async fanOutReportNotification(type: string, report: Report): Promise<void> {
    if (!report.calendarId) {
      return;
    }
    try {
      const accounts = await this.calendarInterface.getReportReviewersForCalendar(report.calendarId);
      for (const account of accounts) {
        await this.service.createNotification(
          type,
          report.calendarId,
          report.eventId,
          '',
          null,
          account.id,
          report.id,
        );
      }
    }
    catch (error) {
      logger.error({ err: error, type }, 'Error handling report notification');
    }
  }
}
