import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import { ReportStatus } from '@/common/model/report';
import ModerationInterface from '../interface';
import CalendarInterface from '@/server/calendar/interface';
import EmailInterface from '@/server/email/interface';
import ReportVerificationEmail from '../model/report_verification_email';
import type { ReportCreatedPayload } from './types';

/**
 * Event handlers for the moderation domain.
 *
 * Listens for domain events and triggers moderation-related
 * side effects such as sending verification emails when
 * anonymous reporters submit reports.
 */
export default class ModerationEventHandlers implements DomainEventHandlers {
  private service: ModerationInterface;
  private calendarInterface: CalendarInterface;
  private emailInterface: EmailInterface;

  constructor(
    service: ModerationInterface,
    calendarInterface: CalendarInterface,
    emailInterface: EmailInterface,
  ) {
    this.service = service;
    this.calendarInterface = calendarInterface;
    this.emailInterface = emailInterface;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('reportCreated', this.handleReportCreated.bind(this));
  }

  /**
   * Handles the reportCreated event by sending a verification email
   * to anonymous reporters. Authenticated and administrator reports
   * skip verification and do not receive an email.
   *
   * @param payload - Event payload containing the report and reporter email
   */
  private async handleReportCreated(payload: ReportCreatedPayload): Promise<void> {
    const { report, reporterEmail } = payload;

    // Only send verification email for anonymous reports pending verification
    if (report.reporterType !== 'anonymous' || report.status !== ReportStatus.PENDING_VERIFICATION) {
      return;
    }

    if (!reporterEmail || !report.verificationToken) {
      return;
    }

    // Look up the event to get its name for the email
    let eventName = 'Unknown Event';
    try {
      const event = await this.calendarInterface.getEventById(report.eventId);
      const languages = event.getLanguages();
      const language = languages.length > 0 ? languages[0] : 'en';
      eventName = event.content(language).name || eventName;
    }
    catch {
      // If event lookup fails, proceed with default name
    }

    const email = new ReportVerificationEmail(
      reporterEmail,
      eventName,
      report.category,
      report.verificationToken,
    );

    const mailData = email.buildMessage('en');
    await this.emailInterface.sendEmail(mailData);
  }
}
