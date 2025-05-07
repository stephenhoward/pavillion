import config from 'config';
import AccountApplication from '@/common/model/application';
import { MailData } from '@/server/common/service/mail/types';
import { EmailMessage, compileTemplate } from '@/server/common/service/mail/message';

const textTemplate = compileTemplate('src/server/accounts', 'application_accepted_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'application_accepted_email.html.hbs');

class ApplicationAcceptedEmail extends EmailMessage {
  application: AccountApplication;
  passwordResetCode: string;

  constructor(application: AccountApplication, passwordResetCode: string) {
    super('application_accepted_email', textTemplate, htmlTemplate);
    this.application = application;
    this.passwordResetCode = passwordResetCode;
  }

  buildMessage(language: string): MailData {
    return {
      emailAddress: this.application.email,
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
