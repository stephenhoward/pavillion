import config from 'config';
import AccountApplication from '@/common/model/application';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/accounts', 'admin_application_notification_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/accounts', 'admin_application_notification_email.html.hbs');

/**
 * Email message notifying an instance administrator that an account
 * application has been confirmed and is awaiting review in the admin queue.
 *
 * The applicant's free-text message is intentionally NOT reproduced in the
 * email body — it may contain sensitive personal context that the applicant
 * intends for the controlled in-app queue, not for admin mailboxes which
 * sync to mobile devices and persist indefinitely. The applicant email is
 * included so admins can recognize known correspondents at a glance, and the
 * full message is reviewed in the admin applications queue (deep-linked from
 * this email).
 */
class AdminApplicationNotificationEmail extends EmailMessage {
  recipientEmail: string;
  application: AccountApplication;

  constructor(recipientEmail: string, application: AccountApplication) {
    super('admin_application_notification_email', textTemplate, htmlTemplate);
    this.recipientEmail = recipientEmail;
    this.application = application;
  }

  /**
   * Builds the admin-notify email payload.
   *
   * @param language - Language code for translations (e.g. 'en', 'fr')
   * @returns Complete mail data ready for sending
   */
  buildMessage(language: string): MailData {
    const appUrl = config.get<string>('domain');
    const reviewUrl = appUrl + '/admin/applications';

    const templateData = {
      applicantEmail: this.application.email,
      reviewUrl,
      appUrl,
      language,
    };

    return {
      emailAddress: this.recipientEmail,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, templateData),
      htmlMessage: this.renderHtml(language, templateData),
    };
  }
}

export default AdminApplicationNotificationEmail;
