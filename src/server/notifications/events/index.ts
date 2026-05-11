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
 * Payload for the eventUnreposted event bus emission. The notifications
 * domain is one of multiple listeners; the canonical type lives in the
 * calendar domain (src/server/calendar/events/index.ts) but is restated here
 * because cross-domain imports are not permitted. The shape must stay in sync.
 *
 * `actorAccountId` identifies the local editor who initiated the unpost so the
 * handler can exclude that account from the co-editor fan-out (the
 * "owner-initiated actions exclude initiator" convention).
 */
export interface EventUnrepostedPayload {
  eventId: string;
  calendarId: string;
  actorAccountId: string;
  actorName: string;
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
    eventBus.on('eventUnreposted', this.handleEventUnreposted.bind(this));
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
   * Handles the eventUnreposted event by notifying co-editors of the calendar
   * that a reposted event was unposted (DEC-008 sticky dismissal flow). The
   * actor — the editor who performed the unpost — is excluded from the fan-out
   * to avoid a redundant self-notification, establishing the
   * "owner-initiated actions exclude initiator" convention.
   *
   * actor_url is null because the actor is a local user; co-editors already
   * share calendar access with the actor, so a profile link adds no
   * disambiguation value (privacy-playbook: data minimization).
   */
  private async handleEventUnreposted(payload: EventUnrepostedPayload): Promise<void> {
    try {
      const accounts = await this.calendarInterface.getEditorsForCalendar(payload.calendarId);
      const recipients = accounts.filter(account => account.id !== payload.actorAccountId);
      for (const account of recipients) {
        await this.service.createNotification(
          'unshare',
          payload.calendarId,
          payload.eventId,
          payload.actorName,
          null,
          account.id,
        );
      }
    }
    catch (error) {
      logger.error({ err: error }, 'Error handling eventUnreposted');
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
   * Fans out a report-related notification to every editor of the report's
   * calendar. Reporter identity is never surfaced — actorName is always
   * the empty string and actorUrl is always null, regardless of
   * reporterType (DEC-004, moderation-privacy).
   */
  private async fanOutReportNotification(type: string, report: Report): Promise<void> {
    if (!report.calendarId) {
      return;
    }
    try {
      const accounts = await this.calendarInterface.getEditorsForCalendar(report.calendarId);
      for (const account of accounts) {
        await this.service.createNotification(
          type,
          report.calendarId,
          report.eventId,
          '',
          null,
          account.id,
        );
      }
    }
    catch (error) {
      logger.error({ err: error, type }, 'Error handling report notification');
    }
  }
}
