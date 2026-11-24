import { Account } from '@/common/model/account';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';
import { resetPasswordPath } from '@/server/common/helper/auth-links';

const textTemplate = compileTemplate('src/server/accounts', 'application_accepted_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'application_accepted_email.html.hbs');

class ApplicationAcceptedEmail extends EmailMessage {
  account: Account;
  passwordResetCode: string;
  instanceName: string;

  constructor(application: Account, passwordResetCode: string, instanceName: string) {
    super('application_accepted_email', textTemplate, htmlTemplate);
    this.account = application;
    this.passwordResetCode = passwordResetCode;
    this.instanceName = instanceName;
  }

  buildMessage(language: string): MailData {
    const registrationUrl = publicUrl(resetPasswordPath());

    return {
      emailAddress: this.account.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        passwordResetCode: this.passwordResetCode,
        language: language,
        instanceName: this.instanceName,
        registrationUrl,
      }),
      htmlMessage: this.renderHtml(language, {
        passwordResetCode: this.passwordResetCode,
        language: language,
        instanceName: this.instanceName,
        registrationUrl,
      }),
    };
  }
}

export default ApplicationAcceptedEmail;
