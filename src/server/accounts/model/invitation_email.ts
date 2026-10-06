import AccountInvitation from '@/common/model/invitation';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';

const textTemplate = compileTemplate('src/server/accounts', 'account_invitation_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'account_invitation_email.html.hbs');

class AccountInvitationEmail extends EmailMessage {
  invitation: AccountInvitation;
  code: string;

  constructor(invitation: AccountInvitation, code: string) {
    super('account_invitation_email', textTemplate, htmlTemplate);
    this.invitation = invitation;
    this.code = code;
  }

  buildMessage(language: string): MailData {
    const invitationUrl = publicUrl('/auth/invitation');

    return {
      emailAddress: this.invitation.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        inviteCode: this.code,
        language: language,
        invitationUrl,
        expirationTime: this.invitation.expirationTime,
      }),
      htmlMessage: this.renderHtml(language, {
        inviteCode: this.code,
        language: language,
        invitationUrl,
        expirationTime: this.invitation.expirationTime,
      }),
    };
  }
}

export default AccountInvitationEmail;
