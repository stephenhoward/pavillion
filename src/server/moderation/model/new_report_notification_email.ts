import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/moderation', 'new-report-notification.text.hbs');
const htmlTemplate = compileTemplate('src/server/moderation', 'new-report-notification.html.hbs');

/**
 * Email message notifying a calendar owner that a new report
 * has been submitted (and verified) for an event on their calendar.
 *
 * Includes the event name, report category, and total report count.
 */
class NewReportNotificationEmail extends EmailMessage {
  recipientEmail: string;
  eventName: string;
  reportCategory: string;
  reportCount: number;

  constructor(
    recipientEmail: string,
    eventName: string,
    reportCategory: string,
    reportCount: number,
  ) {
    super('new_report_notification_email', textTemplate, htmlTemplate);
    this.recipientEmail = recipientEmail;
    this.eventName = eventName;
    this.reportCategory = reportCategory;
    this.reportCount = reportCount;
  }

  /**
   * Builds the complete email message with report details.
   *
   * @param language - Language code for translations
   * @returns Complete mail data ready for sending
   */
  buildMessage(language: string): MailData {
    const truncatedName = this.eventName.length > 100
      ? this.eventName.substring(0, 100) + '...'
      : this.eventName;

    return {
      emailAddress: this.recipientEmail,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        eventName: truncatedName,
        reportCategory: this.reportCategory,
        reportCount: this.reportCount,
        language,
      }),
      htmlMessage: this.renderHtml(language, {
        eventName: truncatedName,
        reportCategory: this.reportCategory,
        reportCount: this.reportCount,
        language,
      }),
    };
  }
}

export default NewReportNotificationEmail;
