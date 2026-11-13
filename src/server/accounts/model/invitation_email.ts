import AccountInvitation from '@/common/model/invitation';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';

const textTemplate = compileTemplate('src/server/accounts', 'account_invitation_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'account_invitation_email.html.hbs');

export interface InvitationEmailContext {
  instanceName: string;
  inviterName: string;
}

class AccountInvitationEmail extends EmailMessage {
  invitation: AccountInvitation;
  code: string;
  context: InvitationEmailContext;

  constructor(invitation: AccountInvitation, code: string, context: InvitationEmailContext) {
    super('account_invitation_email', textTemplate, htmlTemplate);
    this.invitation = invitation;
    this.code = code;
    this.context = context;
  }

  buildMessage(language: string): MailData {
    const invitationUrl = publicUrl('/auth/invitation');

    const templateData = {
      inviteCode: this.code,
      language,
      invitationUrl,
      instanceName: this.context.instanceName,
      inviterName: this.context.inviterName,
      message: this.invitation.message,
    };

    return {
      emailAddress: this.invitation.email,
      subject: this.renderSubject(language, { instanceName: this.context.instanceName }),
      textMessage: this.renderPlaintext(language, templateData),
      htmlMessage: this.renderHtml(language, templateData),
    };
  }
}

export default AccountInvitationEmail;
