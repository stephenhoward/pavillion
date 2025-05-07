import config from 'config';
import { Account } from '@/common/model/account';
import { MailData } from '@/server/common/service/mail/types';
import { EmailMessage, compileTemplate } from '@/server/common/service/mail/message';

const textTemplate = compileTemplate('src/server/accounts', 'account_registration_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'account_registration_email.html.hbs');

class AccountRegistrationEmail extends EmailMessage {
  account: Account;
  token: string;

  constructor(account: Account, token: string) {
    super('account_registration_email', textTemplate, htmlTemplate);
    this.account = account;
    this.token = token;
  }

  buildMessage(language: string): MailData {
    return {
      emailAddress: this.account.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        token: this.token,
        language: language,
        registrationUrl: config.get('domain') + '/auth/password',
      }),
      htmlMessage: this.renderHtml(language, {
        token: this.token,
        language: language,
        registrationUrl: config.get('domain') + '/auth/password',
      }),
    };
  }
}

export default AccountRegistrationEmail;
