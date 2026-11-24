import { Account } from '@/common/model/account';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';
import { forgotPasswordPath, loginPath } from '@/server/common/helper/auth-links';

const textTemplate = compileTemplate('src/server/accounts', 'account_already_exists_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'account_already_exists_email.html.hbs');

class AccountAlreadyExistsEmail extends EmailMessage {
  account: Account;
  instanceName: string;

  constructor(account: Account, instanceName: string) {
    super('account_already_exists_email', textTemplate, htmlTemplate);
    this.account = account;
    this.instanceName = instanceName;
  }

  buildMessage(language: string): MailData {
    const loginUrl = publicUrl(loginPath());
    const forgotPasswordUrl = publicUrl(forgotPasswordPath());

    return {
      emailAddress: this.account.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        language: language,
        instanceName: this.instanceName,
        loginUrl,
        forgotPasswordUrl,
      }),
      htmlMessage: this.renderHtml(language, {
        language: language,
        instanceName: this.instanceName,
        loginUrl,
        forgotPasswordUrl,
      }),
    };
  }
}

export default AccountAlreadyExistsEmail;
