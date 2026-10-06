import { Account } from '@/common/model/account';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';

const textTemplate = compileTemplate('src/server/authentication', 'password_reset_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/authentication', 'password_reset_email.html.hbs');

export default class PasswordResetEmail extends EmailMessage {
  account: Account;
  token: string;

  constructor(account: Account, token: string) {
    super('password_reset_email', textTemplate, htmlTemplate);
    this.account = account;
    this.token = token;
  }

  buildMessage(language: string): MailData {
    const resetUrl = publicUrl('/auth/password');

    return {
      emailAddress: this.account.email,
      subject: this.renderSubject(language,{}),
      textMessage: this.renderPlaintext(language, {
        token: this.token,
        language: language,
        resetUrl,
      }),
      htmlMessage: this.renderHtml(language, {
        token: this.token,
        language: language,
        resetUrl,
      }),
    };
  }
}
