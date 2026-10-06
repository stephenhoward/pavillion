import { Account } from '@/common/model/account';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';

const textTemplate = compileTemplate('src/server/accounts', 'application_accepted_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'application_accepted_email.html.hbs');

class ApplicationAcceptedEmail extends EmailMessage {
  account: Account;
  passwordResetCode: string;

  constructor(application: Account, passwordResetCode: string) {
    super('application_accepted_email', textTemplate, htmlTemplate);
    this.account = application;
    this.passwordResetCode = passwordResetCode;
  }

  buildMessage(language: string): MailData {
    const registrationUrl = publicUrl('/auth/password');

    return {
      emailAddress: this.account.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        passwordResetCode: this.passwordResetCode,
        language: language,
        registrationUrl,
      }),
      htmlMessage: this.renderHtml(language, {
        passwordResetCode: this.passwordResetCode,
        language: language,
        registrationUrl,
      }),
    };
  }
}

export default ApplicationAcceptedEmail;
