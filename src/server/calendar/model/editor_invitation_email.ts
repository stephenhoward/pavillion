import { Calendar } from '@/common/model/calendar';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';
import AccountInvitation from '@/common/model/invitation';

/** Instance and inviter names resolved by the sender; kept as plain values so the model stays dumb. */
interface InvitationEmailContext {
  instanceName: string;
  inviterName: string;
}

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
  context: InvitationEmailContext;

  constructor(
    invitation: AccountInvitation,
    inviteCode: string,
    calendar: Calendar,
    context: InvitationEmailContext,
  ) {
    super('editor_invitation_email', textTemplate, htmlTemplate);
    this.invitation = invitation;
    this.calendar = calendar;
    this.inviteCode = inviteCode;
    this.context = context;
  }

  buildMessage(language: string): MailData {
    const invitationUrl = publicUrl('/auth/invitation');
    const calendarName = this.calendar.content(language).name;
    const templateData = {
      language,
      calendarName,
      instanceName: this.context.instanceName,
      inviterName: this.context.inviterName,
      message: this.invitation.message,
      inviteCode: this.inviteCode,
      invitationUrl,
    };

    return {
      emailAddress: this.invitation.email,
      subject: this.renderSubject(language, {
        calendarName,
        instanceName: this.context.instanceName,
      }),
      textMessage: this.renderPlaintext(language, templateData),
      htmlMessage: this.renderHtml(language, templateData),
    };
  }
}

export default EditorInvitationEmail;
