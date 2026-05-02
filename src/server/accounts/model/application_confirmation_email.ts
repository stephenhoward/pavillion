import config from 'config';
import AccountApplication from '@/common/model/application';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/accounts', 'application_confirmation_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'application_confirmation_email.html.hbs');

class ApplicationConfirmationEmail extends EmailMessage {
  application: AccountApplication;
  token: string;

  constructor(application: AccountApplication, token: string) {
    super('application_confirmation_email', textTemplate, htmlTemplate);
    this.application = application;
    this.token = token;
  }

  buildMessage(language: string): MailData {
    const confirmationUrl = config.get('domain') + '/apply/confirm/' + this.token;

    return {
      emailAddress: this.application.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        language: language,
        confirmationUrl: confirmationUrl,
      }),
      htmlMessage: this.renderHtml(language, {
        language: language,
        confirmationUrl: confirmationUrl,
      }),
    };
  }
}

export default ApplicationConfirmationEmail;
