import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/housekeeping', 'backup-failed.text.hbs');
const htmlTemplate = compileTemplate('src/server/housekeeping', 'backup-failed.html.hbs');

/**
 * Email message for backup job failure alerts.
 *
 * Sent when a scheduled or manual backup job fails to complete.
 * Provides administrators with the backup type, filename, error details,
 * and timestamp so the failed job can be diagnosed and re-run.
 */
export default class BackupFailedEmail extends EmailMessage {
  backupType: string;
  filename: string;
  errorMessage: string;
  occurredAt: string;
  recipientEmail: string;

  constructor(
    backupType: string,
    filename: string,
    errorMessage: string,
    occurredAt: string,
    recipientEmail: string,
  ) {
    super('backup_failed_email', textTemplate, htmlTemplate);
    this.backupType = backupType;
    this.filename = filename;
    this.errorMessage = errorMessage;
    this.occurredAt = occurredAt;
    this.recipientEmail = recipientEmail;
  }

  buildMessage(language: string): MailData {
    const templateData = {
      backupType: this.backupType,
      filename: this.filename,
      errorMessage: this.errorMessage,
      occurredAt: this.occurredAt,
    };

    return {
      emailAddress: this.recipientEmail,
      subject: this.renderSubject(language, templateData),
      textMessage: this.renderPlaintext(language, templateData),
      htmlMessage: this.renderHtml(language, templateData),
    };
  }
}
