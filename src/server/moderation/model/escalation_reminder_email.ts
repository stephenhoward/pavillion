import config from 'config';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/moderation', 'escalation-reminder.text.hbs');
const htmlTemplate = compileTemplate('src/server/moderation', 'escalation-reminder.html.hbs');

/**
 * Email message reminding a calendar owner that a report
 * is approaching its auto-escalation deadline.
 *
 * Sent X hours before auto-escalation, includes a link
 * to the review dashboard and the time remaining.
 */
class EscalationReminderEmail extends EmailMessage {
  recipientEmail: string;
  eventName: string;
  reportCategory: string;
  reportDescription: string;
  timeRemaining: string;
  calendarId: string;

  constructor(
    recipientEmail: string,
    eventName: string,
    reportCategory: string,
    reportDescription: string,
    timeRemaining: string,
    calendarId: string,
  ) {
    super('escalation_reminder_email', textTemplate, htmlTemplate);
    this.recipientEmail = recipientEmail;
    this.eventName = eventName;
    this.reportCategory = reportCategory;
    this.reportDescription = reportDescription;
    this.timeRemaining = timeRemaining;
    this.calendarId = calendarId;
  }

  /**
   * Builds the complete email message with reminder details.
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

    const templateData = {
      eventName: truncatedName,
      reportCategory: this.reportCategory,
      reportDescription: truncatedDescription,
      timeRemaining: this.timeRemaining,
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

export default EscalationReminderEmail;
