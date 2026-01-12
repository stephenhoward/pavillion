import config from 'config';
import { Account } from '@/common/model/account';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

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
    return {
      emailAddress: this.account.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        passwordResetCode: this.passwordResetCode,
        language: language,
        registrationUrl: config.get('domain') + '/auth/password',
      }),
      htmlMessage: this.renderHtml(language, {
        passwordResetCode: this.passwordResetCode,
        language: language,
        registrationUrl: config.get('domain') + '/auth/password',
      }),
    };
  }
}

export default ApplicationAcceptedEmail;
