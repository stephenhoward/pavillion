import config from 'config';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { MailData } from '@/server/common/service/mail/types';
import { EmailMessage, compileTemplate } from '@/server/common/service/mail/message';

const textTemplate = compileTemplate('src/server/calendar', 'editor_notification_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/calendar', 'editor_notification_email.html.hbs');

/**
 * Email message for notifying existing users they've been granted calendar editor access.
 * Used when the invited user already has an account.
 */
class EditorNotificationEmail extends EmailMessage {
  calendar: Calendar;
  inviter: Account;
  recipient: Account;
  message?: string;

  constructor(
    calendar: Calendar,
    inviter: Account,
    recipient: Account,
    message?: string,
  ) {
    super('editor_notification_email', textTemplate, htmlTemplate);
    this.calendar = calendar;
    this.inviter = inviter;
    this.recipient = recipient;
    this.message = message;
  }

  buildMessage(language: string): MailData {
    const domain = config.get('domain');
    const calendarUrl = `${domain}/@${this.calendar.urlName}`;
    const calendarName = this.calendar.content(language).name;

    return {
      emailAddress: this.recipient.email,
      subject: this.renderSubject(language, {
        calendarName,
      }),
      textMessage: this.renderPlaintext(language, {
        calendarName,
        inviterName: this.inviter.email,
        message: this.message,
        calendarUrl,
      }),
      htmlMessage: this.renderHtml(language, {
        calendarName,
        inviterName: this.inviter.email,
        message: this.message,
        calendarUrl,
      }),
    };
  }
}

export default EditorNotificationEmail;
