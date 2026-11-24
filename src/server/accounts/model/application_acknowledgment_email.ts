import config from 'config';
import AccountApplication from '@/common/model/application';
import { MailData } from '@/server/common/email/types';
import { EmailMessage, compileTemplate } from '@/server/common/email/message';

const textTemplate = compileTemplate('src/server/accounts', 'application_acknowledgment_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'application_acknowledgment_email.html.hbs');

class ApplicationAcknowledgmentEmail extends EmailMessage {
  application: AccountApplication;
  instanceName: string;

  constructor(application: AccountApplication, instanceName: string) {
    super('application_acknowledgment_email', textTemplate, htmlTemplate);
    this.application = application;
    this.instanceName = instanceName;
  }

  buildMessage(language: string): MailData {
    return {
      emailAddress: this.application.email,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        language: language,
        instanceName: this.instanceName,
        appUrl: config.get('domain'),
      }),
      htmlMessage: this.renderHtml(language, {
        language: language,
        instanceName: this.instanceName,
        appUrl: config.get('domain'),
      }),
    };
  }
}

export default ApplicationAcknowledgmentEmail;
