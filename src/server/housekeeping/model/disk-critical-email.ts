import { MailData } from '@/server/email/model/types';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

const textTemplate = compileTemplate('src/server/housekeeping', 'disk-critical.text.hbs');
const htmlTemplate = compileTemplate('src/server/housekeeping', 'disk-critical.html.hbs');

/**
 * Email message for critical disk space alerts.
 *
 * Sent when disk usage reaches the critical threshold (typically 90%).
 * Uses urgent language to convey the need for immediate administrator action.
 */
export default class DiskCriticalEmail extends EmailMessage {
  usagePercent: string;
  threshold: number;
  path: string;
  usedSpace: string;
  totalSpace: string;
  recipientEmail: string;

  constructor(
    usagePercent: number,
    threshold: number,
    path: string,
    usedSpace: string,
    totalSpace: string,
    recipientEmail: string,
  ) {
    super('disk_critical_email', textTemplate, htmlTemplate);
    this.usagePercent = usagePercent.toFixed(1);
    this.threshold = threshold;
    this.path = path;
    this.usedSpace = usedSpace;
    this.totalSpace = totalSpace;
    this.recipientEmail = recipientEmail;
  }

  buildMessage(language: string): MailData {
    const templateData = {
      usagePercent: this.usagePercent,
      threshold: this.threshold,
      path: this.path,
      usedSpace: this.usedSpace,
      totalSpace: this.totalSpace,
    };

    return {
      emailAddress: this.recipientEmail,
      subject: this.renderSubject(language, templateData),
      textMessage: this.renderPlaintext(language, templateData),
      htmlMessage: this.renderHtml(language, templateData),
    };
  }
}
