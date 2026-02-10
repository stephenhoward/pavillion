import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import { ReportStatus } from '@/common/model/report';
import ModerationInterface from '../interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ReportVerificationEmail from '../model/report_verification_email';
import NewReportNotificationEmail from '../model/new_report_notification_email';
import { logError } from '@/server/common/helper/error-logger';
import type { ReportCreatedPayload, ReportVerifiedPayload } from './types';

/**
 * Event handlers for the moderation domain.
 *
 * Listens for domain events and triggers moderation-related
 * side effects such as sending verification emails when
 * anonymous reporters submit reports, and notifying calendar
 * owners when reports are verified or submitted by authenticated users.
 */
export default class ModerationEventHandlers implements DomainEventHandlers {
  private service: ModerationInterface;
  private calendarInterface: CalendarInterface;
  private accountsInterface: AccountsInterface;
  private emailInterface: EmailInterface;

  constructor(
    service: ModerationInterface,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    emailInterface: EmailInterface,
  ) {
    this.service = service;
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
    this.emailInterface = emailInterface;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('reportCreated', this.handleReportCreated.bind(this));
    eventBus.on('reportVerified', this.handleReportVerified.bind(this));
  }

  /**
   * Handles the reportCreated event by sending a verification email
   * to anonymous reporters. Authenticated and administrator reports
   * skip verification and do not receive an email.
   *
   * For authenticated reports (status is already 'submitted'),
   * sends a notification to the calendar owner.
   *
   * @param payload - Event payload containing the report and reporter email
   */
  private async handleReportCreated(payload: ReportCreatedPayload): Promise<void> {
    const { report, reporterEmail } = payload;

    // For anonymous reports pending verification, send verification email
    if (report.reporterType === 'anonymous' && report.status === ReportStatus.PENDING_VERIFICATION) {
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
      return;
    }

    // For authenticated or administrator reports that are already submitted,
    // notify the calendar owner
    if (report.status === ReportStatus.SUBMITTED) {
      await this.sendOwnerNotification(report.eventId, report.calendarId, report.category);
    }
  }

  /**
   * Handles the reportVerified event by notifying the calendar owner
   * that a report has been verified and is now submitted.
   *
   * @param payload - Event payload containing the verified report
   */
  private async handleReportVerified(payload: ReportVerifiedPayload): Promise<void> {
    const { report } = payload;
    await this.sendOwnerNotification(report.eventId, report.calendarId, report.category);
  }

  /**
   * Sends a new report notification email to the calendar owner.
   *
   * Looks up the event name, calendar owner, and total report count,
   * then sends the notification email.
   *
   * @param eventId - The event that was reported
   * @param calendarId - The calendar containing the event
   * @param reportCategory - The category of the report
   */
  private async sendOwnerNotification(
    eventId: string,
    calendarId: string,
    reportCategory: string,
  ): Promise<void> {
    try {
      // Look up the calendar owner account ID
      const ownerAccountId = await this.calendarInterface.getCalendarOwnerAccountId(calendarId);
      if (!ownerAccountId) {
        return;
      }

      // Look up the owner account to get their email
      const ownerAccount = await this.accountsInterface.getAccountById(ownerAccountId);
      if (!ownerAccount || !ownerAccount.email) {
        return;
      }

      // Look up the event name
      let eventName = 'Unknown Event';
      try {
        const event = await this.calendarInterface.getEventById(eventId);
        const languages = event.getLanguages();
        const language = languages.length > 0 ? languages[0] : 'en';
        eventName = event.content(language).name || eventName;
      }
      catch {
        // If event lookup fails, proceed with default name
      }

      // Count total reports for this event
      const reports = await this.service.getReportsForEvent(eventId);
      const reportCount = reports.length;

      // Build and send the notification email
      const email = new NewReportNotificationEmail(
        ownerAccount.email,
        eventName,
        reportCategory,
        reportCount,
      );

      const language = ownerAccount.language || 'en';
      const mailData = email.buildMessage(language);
      await this.emailInterface.sendEmail(mailData);
    }
    catch (error) {
      // Log but don't fail - notification is best-effort
      logError(error, '[MODERATION] Failed to send owner notification email');
    }
  }
}
