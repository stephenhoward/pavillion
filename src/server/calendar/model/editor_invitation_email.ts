import config from 'config';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { MailData } from '@/server/common/service/mail/types';
import { EmailMessage, compileTemplate } from '@/server/common/service/mail/message';

const textTemplate = compileTemplate('src/server/calendar', 'editor_invitation_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/calendar', 'editor_invitation_email.html.hbs');

/**
 * Email message for inviting new users to become calendar editors.
 * Used when the invited email doesn't belong to an existing account.
 */
class EditorInvitationEmail extends EmailMessage {
  calendar: Calendar;
  inviter: Account;
  recipientEmail: string;
  inviteCode: string;
  message?: string;

  constructor(
    calendar: Calendar,
    inviter: Account,
    recipientEmail: string,
    inviteCode: string,
    message?: string,
  ) {
    super('editor_invitation_email', textTemplate, htmlTemplate);
    this.calendar = calendar;
    this.inviter = inviter;
    this.recipientEmail = recipientEmail;
    this.inviteCode = inviteCode;
    this.message = message;
  }

  buildMessage(language: string): MailData {
    const domain = config.get('domain');
    const invitationUrl = `${domain}/auth/register`;
    const calendarUrl = `${domain}/calendar/${this.calendar.urlName}`;
    const calendarName = this.calendar.content(language).name;

    return {
      emailAddress: this.recipientEmail,
      subject: this.renderSubject(language, {
        calendarName,
      }),
      textMessage: this.renderPlaintext(language, {
        calendarName,
        inviterName: this.inviter.username,
        message: this.message,
        inviteCode: this.inviteCode,
        invitationUrl,
        calendarUrl,
        isNewUser: true,
      }),
      htmlMessage: this.renderHtml(language, {
        calendarName,
        inviterName: this.inviter.username,
        message: this.message,
        inviteCode: this.inviteCode,
        invitationUrl,
        calendarUrl,
        isNewUser: true,
      }),
    };
  }
}

export default EditorInvitationEmail;
