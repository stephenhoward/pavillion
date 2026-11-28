import { Account } from '@/common/model/account';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';
import { emailConfirmPath } from '@/server/common/helper/auth-links';

const textTemplate = compileTemplate('src/server/authentication', 'email_change_confirmation_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/authentication', 'email_change_confirmation_email.html.hbs');

export default class EmailChangeConfirmationEmail extends EmailMessage {
  account: Account;
  newEmail: string;
  token: string;
  instanceName: string;

  constructor(account: Account, newEmail: string, token: string, instanceName: string) {
    super('email_change_confirmation_email', textTemplate, htmlTemplate);
    this.account = account;
    this.newEmail = newEmail;
    this.token = token;
    this.instanceName = instanceName;
  }

  buildMessage(language: string): MailData {
    // confirmUrl is the full link `<domain>/auth/email/confirm/<token>` — the
    // path-param form that matches the API route POST
    // /api/auth/v1/email/confirm/:token and the client confirm route
    // /auth/email/confirm/:token (:token is the forward standard). Do NOT
    // switch this back to `?code=` without realigning the route and the
    // client page.
    const confirmUrl = publicUrl(emailConfirmPath(this.token));

    return {
      emailAddress: this.newEmail,
      subject: this.renderSubject(language,{}),
      textMessage: this.renderPlaintext(language, {
        token: this.token,
        language: language,
        instanceName: this.instanceName,
        confirmUrl,
      }),
      htmlMessage: this.renderHtml(language, {
        token: this.token,
        language: language,
        instanceName: this.instanceName,
        confirmUrl,
      }),
    };
  }
}
