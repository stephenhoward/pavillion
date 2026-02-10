import config from 'config';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/moderation', 'admin-report-notification.text.hbs');
const htmlTemplate = compileTemplate('src/server/moderation', 'admin-report-notification.html.hbs');

/**
 * Email message notifying a calendar owner that an administrator
 * has created a report about an event on their calendar.
 *
 * Includes priority indicator in the subject line, deadline display,
 * and a link to the owner review dashboard.
 */
class AdminReportNotificationEmail extends EmailMessage {
  recipientEmail: string;
  eventName: string;
  calendarName: string;
  reportCategory: string;
  reportDescription: string;
  priority: string;
  deadline: string | null;
  calendarId: string;

  constructor(
    recipientEmail: string,
    eventName: string,
    calendarName: string,
    reportCategory: string,
    reportDescription: string,
    priority: string,
    deadline: string | null,
    calendarId: string,
  ) {
    super('admin_report_notification_email', textTemplate, htmlTemplate);
    this.recipientEmail = recipientEmail;
    this.eventName = eventName;
    this.calendarName = calendarName;
    this.reportCategory = reportCategory;
    this.reportDescription = reportDescription;
    this.priority = priority;
    this.deadline = deadline;
    this.calendarId = calendarId;
  }

  /**
   * Builds the complete email message with admin report details.
   *
   * @param language - Language code for translations
   * @returns Complete mail data ready for sending
   */
  buildMessage(language: string): MailData {
    const truncatedName = this.eventName.length > 100
      ? this.eventName.substring(0, 100) + '...'
      : this.eventName;

    const truncatedDescription = this.reportDescription.length > 200
      ? this.reportDescription.substring(0, 200) + '...'
      : this.reportDescription;

    const reviewUrl = config.get('domain') + '/calendar/' + this.calendarId + '/reports';
    const priorityLabel = this.priority.toUpperCase();

    const templateData = {
      eventName: truncatedName,
      calendarName: this.calendarName,
      reportCategory: this.reportCategory,
      reportDescription: truncatedDescription,
      priority: this.priority,
      deadline: this.deadline,
      reviewUrl,
      language,
    };

    return {
      emailAddress: this.recipientEmail,
      subject: `[${priorityLabel}] ` + this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, templateData),
      htmlMessage: this.renderHtml(language, templateData),
    };
  }
}

export default AdminReportNotificationEmail;
