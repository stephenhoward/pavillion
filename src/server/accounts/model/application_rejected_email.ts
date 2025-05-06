import config from 'config';
import AccountApplication from '@/common/model/application';
import { MailData } from '@/server/common/service/mail/types';
import { EmailMessage, compileTemplate } from '@/server/common/service/mail/message';

const textTemplate = compileTemplate('src/server/accounts', 'application_rejected_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'application_rejected_email.html.hbs');

class ApplicationRejectedEmail extends EmailMessage {
    application: AccountApplication;

    constructor(application: AccountApplication) {
        super('application_rejected_email', textTemplate, htmlTemplate);
        this.application = application;
    }

    buildMessage(language: string): MailData {
        return {
            emailAddress: this.application.email,
            subject: this.renderSubject(language, {}),
            textMessage: this.renderPlaintext(language, {
                language: language,
                appUrl: config.get('domain'),
            }),
            htmlMessage: this.renderHtml(language, {
                language: language,
                appUrl: config.get('domain'),
            }),
        };
    }
}

export default ApplicationRejectedEmail;