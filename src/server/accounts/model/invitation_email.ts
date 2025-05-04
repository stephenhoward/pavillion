import config from 'config';
import AccountInvitation from '@/common/model/invitation';
import { MailData } from '@/server/common/service/mail/types';
import { EmailMessage, compileTemplate } from '@/server/common/service/mail/message';

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
        return {
            emailAddress: this.invitation.email,
            subject: this.renderSubject(language, {}),
            textMessage: this.renderPlaintext(language, {
                inviteCode: this.code,
                language: language,
                invitationUrl: config.get('domain') + '/auth/invitation',
                expirationTime: this.invitation.expirationTime,
            }),
            htmlMessage: this.renderHtml(language, {
                inviteCode: this.code,
                language: language,
                invitationUrl: config.get('domain') + '/auth/invitation',
                expirationTime: this.invitation.expirationTime,
            }),
        };
    }
}

export default AccountInvitationEmail;