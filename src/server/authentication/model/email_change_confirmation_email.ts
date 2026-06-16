import config from 'config';
import { Account } from '@/common/model/account';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/authentication', 'email_change_confirmation_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/authentication', 'email_change_confirmation_email.html.hbs');

export default class EmailChangeConfirmationEmail extends EmailMessage {
  account: Account;
  newEmail: string;
  token: string;

  constructor(account: Account, newEmail: string, token: string) {
    super('email_change_confirmation_email', textTemplate, htmlTemplate);
    this.account = account;
    this.newEmail = newEmail;
    this.token = token;
  }

  buildMessage(language: string): MailData {
    // confirmUrl is the base path; the templates append `/{{token}}` so the
    // emitted link is `<domain>/auth/email/confirm/<token>` — the path-param
    // form that matches the API route POST /api/auth/v1/email/confirm/:token
    // and the client confirm route /auth/email/confirm/:token (epic pv-91a3,
    // :token is the forward standard). Do NOT switch this back to `?code=`
    // without realigning the route and the client page.
    return {
      emailAddress: this.newEmail,
      subject: this.renderSubject(language,{}),
      textMessage: this.renderPlaintext(language, {
        token: this.token,
        language: language,
        confirmUrl: config.get('domain') + '/auth/email/confirm',
      }),
      htmlMessage: this.renderHtml(language, {
        token: this.token,
        language: language,
        confirmUrl: config.get('domain') + '/auth/email/confirm',
      }),
    };
  }
}
