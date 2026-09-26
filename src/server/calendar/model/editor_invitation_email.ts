import config from 'config';
import { Calendar } from '@/common/model/calendar';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import AccountInvitation from '@/common/model/invitation';

const textTemplate = compileTemplate('src/server/calendar', 'editor_invitation_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/calendar', 'editor_invitation_email.html.hbs');

/**
 * Email message for inviting new users to become calendar editors.
 * Used when the invited email doesn't belong to an existing account.
 */
class EditorInvitationEmail extends EmailMessage {
  invitation: AccountInvitation;
  calendar: Calendar;
  inviteCode: string;

  constructor(
    invitation: AccountInvitation,
    inviteCode: string,
    calendar: Calendar,
  ) {
    super('editor_invitation_email', textTemplate, htmlTemplate);
    this.invitation = invitation;
    this.calendar = calendar;
    this.inviteCode = inviteCode;
  }

  buildMessage(language: string): MailData {
    const domain = config.get('domain');
    // Absolute: both templates render this as an anchor href, and a mail client
    // has no origin to resolve a scheme-less value against.
    const invitationUrl = `https://${domain}/auth/invitation`;
    const calendarName = this.calendar.content(language).name;
    const templateData = {
      calendarName,
      inviterName: this.invitation.invitedBy.username,
      message: this.invitation.message,
      inviteCode: this.inviteCode,
      invitationUrl,
    };

    return {
      emailAddress: this.invitation.email,
      subject: this.renderSubject(language, {
        calendarName,
      }),
      textMessage: this.renderPlaintext(language, templateData),
      htmlMessage: this.renderHtml(language, templateData),
    };
  }
}

export default EditorInvitationEmail;
