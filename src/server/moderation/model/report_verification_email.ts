import config from 'config';
import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/moderation', 'report-verification.text.hbs');
const htmlTemplate = compileTemplate('src/server/moderation', 'report-verification.html.hbs');

/**
 * Email message for verifying anonymous event report submissions.
 *
 * Sent to the reporter's email address after they submit a report.
 * Contains a verification link that must be clicked to confirm the report.
 */
class ReportVerificationEmail extends EmailMessage {
  reporterEmail: string;
  eventName: string;
  reportCategory: string;
  verificationToken: string;

  constructor(
    reporterEmail: string,
    eventName: string,
    reportCategory: string,
    verificationToken: string,
  ) {
    super('report_verification_email', textTemplate, htmlTemplate);
    this.reporterEmail = reporterEmail;
    this.eventName = eventName;
    this.reportCategory = reportCategory;
    this.verificationToken = verificationToken;
  }

  /**
   * Builds the complete email message with verification link.
   *
   * @param language - Language code for translations
   * @returns Complete mail data ready for sending
   */
  buildMessage(language: string): MailData {
    const verifyUrl = config.get('domain') + '/api/public/v1/reports/verify/' + this.verificationToken;
    const truncatedName = this.eventName.length > 100 ? this.eventName.substring(0, 100) + '...' : this.eventName;

    return {
      emailAddress: this.reporterEmail,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, {
        eventName: truncatedName,
        reportCategory: this.reportCategory,
        verifyUrl,
        language,
      }),
      htmlMessage: this.renderHtml(language, {
        eventName: truncatedName,
        reportCategory: this.reportCategory,
        verifyUrl,
        language,
      }),
    };
  }
}

export default ReportVerificationEmail;
