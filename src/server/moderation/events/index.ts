import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import { ReportStatus } from '@/common/model/report';
import ModerationInterface from '../interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ReportVerificationEmail from '../model/report_verification_email';
import NewReportNotificationEmail from '../model/new_report_notification_email';
import AdminReportNotificationEmail from '../model/admin_report_notification_email';
import EscalationReminderEmail from '../model/escalation_reminder_email';
import AutoEscalationNotificationEmail from '../model/auto_escalation_notification_email';
import { logError } from '@/server/common/helper/error-logger';
import type {
  ReportCreatedPayload,
  ReportVerifiedPayload,
  ReportEscalationReminderPayload,
  ReportAutoEscalatedPayload,
} from './types';

/**
 * Event handlers for the moderation domain.
 *
 * Listens for domain events and triggers moderation-related
 * side effects such as sending verification emails when
 * anonymous reporters submit reports, notifying calendar
 * owners when reports are verified or submitted by authenticated users,
 * sending escalation reminders, and notifying admins of auto-escalations.
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
    eventBus.on('reportEscalationReminder', this.handleEscalationReminder.bind(this));
    eventBus.on('reportAutoEscalated', this.handleAutoEscalated.bind(this));
  }

  /**
   * Handles the reportCreated event by sending a verification email
   * to anonymous reporters. Authenticated and administrator reports
   * skip verification and do not receive an email.
   *
   * For authenticated reports (status is already 'submitted'),
   * sends a notification to the calendar owner.
   *
   * For administrator reports, sends an admin report notification
   * to the calendar owner with priority and deadline details.
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

    // For administrator reports that are already submitted,
    // send admin report notification to the calendar owner
    if (report.reporterType === 'administrator' && report.status === ReportStatus.SUBMITTED) {
      await this.sendAdminReportNotification(report);
      return;
    }

    // For authenticated reports that are already submitted,
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
   * Handles the reportEscalationReminder event by sending a reminder
   * email to the calendar owner that a report needs their attention
   * before it is automatically escalated.
   *
   * @param payload - Event payload containing the report approaching escalation
   */
  private async handleEscalationReminder(payload: ReportEscalationReminderPayload): Promise<void> {
    const { report } = payload;

    try {
      // Look up the calendar owner
      const ownerAccountId = await this.calendarInterface.getCalendarOwnerAccountId(report.calendarId);
      if (!ownerAccountId) {
        return;
      }

      const ownerAccount = await this.accountsInterface.getAccountById(ownerAccountId);
      if (!ownerAccount || !ownerAccount.email) {
        return;
      }

      // Look up the event name
      const eventName = await this.getEventName(report.eventId);

      // Calculate time remaining before escalation
      const timeRemaining = this.calculateTimeRemaining(report);

      const email = new EscalationReminderEmail(
        ownerAccount.email,
        eventName,
        report.category,
        report.description,
        timeRemaining,
        report.calendarId,
      );

      const language = ownerAccount.language || 'en';
      const mailData = email.buildMessage(language);
      await this.emailInterface.sendEmail(mailData);
    }
    catch (error) {
      logError(error, '[MODERATION] Failed to send escalation reminder email');
    }
  }

  /**
   * Handles the reportAutoEscalated event by sending a notification
   * email to all instance administrators that a report has been
   * automatically escalated due to calendar owner inaction.
   *
   * @param payload - Event payload containing the auto-escalated report and reason
   */
  private async handleAutoEscalated(payload: ReportAutoEscalatedPayload): Promise<void> {
    const { report } = payload;

    try {
      // Look up the calendar owner email for the notification
      let ownerEmail = 'Unknown';
      const ownerAccountId = await this.calendarInterface.getCalendarOwnerAccountId(report.calendarId);
      if (ownerAccountId) {
        const ownerAccount = await this.accountsInterface.getAccountById(ownerAccountId);
        if (ownerAccount?.email) {
          ownerEmail = ownerAccount.email;
        }
      }

      // Look up event and calendar names
      const eventName = await this.getEventName(report.eventId);
      const calendarName = await this.getCalendarName(report.calendarId);

      // Format pending since date
      const pendingSince = report.createdAt.toISOString().split('T')[0];

      // Send notification to all admins
      const admins = await this.accountsInterface.getAdmins();
      for (const admin of admins) {
        if (!admin.email) {
          continue;
        }

        const email = new AutoEscalationNotificationEmail(
          admin.email,
          eventName,
          calendarName,
          report.category,
          report.description,
          ownerEmail,
          pendingSince,
          report.id,
        );

        const language = admin.language || 'en';
        const mailData = email.buildMessage(language);
        await this.emailInterface.sendEmail(mailData);
      }
    }
    catch (error) {
      logError(error, '[MODERATION] Failed to send auto-escalation notification email');
    }
  }

  /**
   * Sends an admin report notification email to the calendar owner.
   * Includes priority indicator, deadline, and report details.
   *
   * @param report - The admin-created report
   */
  private async sendAdminReportNotification(report: import('@/common/model/report').Report): Promise<void> {
    try {
      // Look up the calendar owner
      const ownerAccountId = await this.calendarInterface.getCalendarOwnerAccountId(report.calendarId);
      if (!ownerAccountId) {
        return;
      }

      const ownerAccount = await this.accountsInterface.getAccountById(ownerAccountId);
      if (!ownerAccount || !ownerAccount.email) {
        return;
      }

      // Look up event and calendar names
      const eventName = await this.getEventName(report.eventId);
      const calendarName = await this.getCalendarName(report.calendarId);

      // Format deadline if present
      const deadline = report.adminDeadline
        ? report.adminDeadline.toISOString().split('T')[0]
        : null;

      const email = new AdminReportNotificationEmail(
        ownerAccount.email,
        eventName,
        calendarName,
        report.category,
        report.description,
        report.adminPriority || 'medium',
        deadline,
        report.calendarId,
      );

      const language = ownerAccount.language || 'en';
      const mailData = email.buildMessage(language);
      await this.emailInterface.sendEmail(mailData);
    }
    catch (error) {
      logError(error, '[MODERATION] Failed to send admin report notification email');
    }
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

  /**
   * Looks up the name of an event by its ID.
   *
   * @param eventId - The event UUID
   * @returns The event name, or 'Unknown Event' if lookup fails
   */
  private async getEventName(eventId: string): Promise<string> {
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
    return eventName;
  }

  /**
   * Looks up the name of a calendar by its ID.
   *
   * @param calendarId - The calendar UUID
   * @returns The calendar name, or 'Unknown Calendar' if lookup fails
   */
  private async getCalendarName(calendarId: string): Promise<string> {
    let calendarName = 'Unknown Calendar';
    try {
      const calendar = await this.calendarInterface.getCalendar(calendarId);
      if (calendar) {
        const languages = calendar.getLanguages();
        const language = languages.length > 0 ? languages[0] : 'en';
        calendarName = calendar.content(language).name || calendar.urlName || calendarName;
      }
    }
    catch {
      // If calendar lookup fails, proceed with default name
    }
    return calendarName;
  }

  /**
   * Calculates a human-readable time remaining string before
   * a report is auto-escalated.
   *
   * @param report - The report with an adminDeadline or createdAt date
   * @returns Human-readable time remaining string
   */
  private calculateTimeRemaining(report: import('@/common/model/report').Report): string {
    const now = new Date();
    let deadlineDate: Date;

    if (report.adminDeadline) {
      deadlineDate = report.adminDeadline;
    }
    else {
      // Default: use createdAt + default escalation hours (72h)
      deadlineDate = new Date(report.createdAt.getTime() + 72 * 60 * 60 * 1000);
    }

    const diffMs = deadlineDate.getTime() - now.getTime();
    if (diffMs <= 0) {
      return 'Imminent';
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return `${diffMinutes} minutes`;
    }

    return `${diffHours} hours`;
  }
}
