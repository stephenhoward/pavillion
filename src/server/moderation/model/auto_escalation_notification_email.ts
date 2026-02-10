import config from 'config';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/moderation', 'auto-escalation-notification.text.hbs');
const htmlTemplate = compileTemplate('src/server/moderation', 'auto-escalation-notification.html.hbs');

/**
 * Email message notifying an instance administrator that a report
 * has been automatically escalated due to calendar owner inaction.
 *
 * Includes the original report details, calendar owner info,
 * and how long the report was pending.
 */
class AutoEscalationNotificationEmail extends EmailMessage {
  recipientEmail: string;
  eventName: string;
  calendarName: string;
  reportCategory: string;
  reportDescription: string;
  ownerEmail: string;
  pendingSince: string;
  reportId: string;

  constructor(
    recipientEmail: string,
    eventName: string,
    calendarName: string,
    reportCategory: string,
    reportDescription: string,
    ownerEmail: string,
    pendingSince: string,
    reportId: string,
  ) {
    super('auto_escalation_notification_email', textTemplate, htmlTemplate);
    this.recipientEmail = recipientEmail;
    this.eventName = eventName;
    this.calendarName = calendarName;
    this.reportCategory = reportCategory;
    this.reportDescription = reportDescription;
    this.ownerEmail = ownerEmail;
    this.pendingSince = pendingSince;
    this.reportId = reportId;
  }

  /**
   * Builds the complete email message with escalation details.
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

    const reviewUrl = config.get('domain') + '/admin/moderation/reports/' + this.reportId;

    const templateData = {
      eventName: truncatedName,
      calendarName: this.calendarName,
      reportCategory: this.reportCategory,
      reportDescription: truncatedDescription,
      ownerEmail: this.ownerEmail,
      pendingSince: this.pendingSince,
      reviewUrl,
      language,
    };

    return {
      emailAddress: this.recipientEmail,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, templateData),
      htmlMessage: this.renderHtml(language, templateData),
    };
  }
}

export default AutoEscalationNotificationEmail;
