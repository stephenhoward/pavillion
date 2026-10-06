import { Account } from '@/common/model/account';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';

const textTemplate = compileTemplate('src/server/accounts', 'account_already_exists_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'account_already_exists_email.html.hbs');

class AccountAlreadyExistsEmail extends EmailMessage {
  account: Account;

  constructor(account: Account) {
    super('account_already_exists_email', textTemplate, htmlTemplate);
    this.account = account;
  }

  buildMessage(language: string): MailData {
    const loginUrl = publicUrl('/auth/login');
    const forgotPasswordUrl = publicUrl('/auth/forgot');

    return {
      emailAddress: this.account.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        language: language,
        loginUrl,
        forgotPasswordUrl,
      }),
      htmlMessage: this.renderHtml(language, {
        language: language,
        loginUrl,
        forgotPasswordUrl,
      }),
    };
  }
}

export default AccountAlreadyExistsEmail;
