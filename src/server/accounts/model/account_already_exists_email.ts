import config from 'config';
import { Account } from '@/common/model/account';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/accounts', 'account_already_exists_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'account_already_exists_email.html.hbs');

class AccountAlreadyExistsEmail extends EmailMessage {
  account: Account;

  constructor(account: Account) {
    super('account_already_exists_email', textTemplate, htmlTemplate);
    this.account = account;
  }

  buildMessage(language: string): MailData {
    return {
      emailAddress: this.account.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        language: language,
        loginUrl: config.get('domain') + '/auth/login',
        forgotPasswordUrl: config.get('domain') + '/auth/forgot',
      }),
      htmlMessage: this.renderHtml(language, {
        language: language,
        loginUrl: config.get('domain') + '/auth/login',
        forgotPasswordUrl: config.get('domain') + '/auth/forgot',
      }),
    };
  }
}

export default AccountAlreadyExistsEmail;
