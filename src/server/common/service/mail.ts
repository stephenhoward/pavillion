import config from 'config';
import { SentMessageInfo } from 'nodemailer';

import { MailConfig, MailData } from '@/server/common/service/mail/types';
import { MailTransport } from '@/server/common/service/mail/mail-transport';
import { SmtpTransport } from '@/server/common/service/mail/smtp-transport';
import { SendmailTransport } from '@/server/common/service/mail/sendmail-transport';
import { DevelopmentTransport } from '@/server/common/service/mail/development-transport';
import { TestingTransport } from '@/server/common/service/mail/testing-transport';

/**
 * Email Service for sending messages via various transports
 */
class EmailServiceClass {
  public transportInstance: MailTransport;
  private mailConfig: MailConfig;

  constructor() {
    this.mailConfig = this.getMailConfig();
    this.transportInstance = this.createTransport();
  }

  /**
   * Get mail configuration from config files with defaults
   */
  private getMailConfig(): MailConfig {
    const defaultConfig: MailConfig = {
      transport: 'development',
      from: 'noreply@example.com',
      settings: {}
    };

    try {
      if (config.has('mail')) {
        return config.get('mail');
      }
    } catch (err) {
      console.warn('Mail configuration not found, using default transport');
    }

    // For test environment, use testing transport
    if (process.env.NODE_ENV === 'test') {
      return {
        transport: 'testing',
        from: process.env.MAIL_FROM || defaultConfig.from,
        settings: {}
      };
    }

    // For development, use development transport by default
    if (process.env.NODE_ENV === 'development') {
      return {
        transport: 'development',
        from: process.env.MAIL_FROM || defaultConfig.from,
        settings: {
          outputDir: process.env.MAIL_OUTPUT_DIR || 'logs/mail',
          console: process.env.MAIL_CONSOLE !== 'false'
        }
      };
    }

    return defaultConfig;
  }

  /**
   * Create a nodemailer transport based on configuration
   */
  private createTransport(): MailTransport {
    console.log('Creating mail transport:', this.mailConfig.transport);
    switch (this.mailConfig.transport) {
      case 'smtp':
        return new SmtpTransport(this.mailConfig);

      case 'sendmail':
        return new SendmailTransport(this.mailConfig);

      case 'testing':
        return new TestingTransport(this.mailConfig);

      case 'development':
      default:
        return new DevelopmentTransport(this.mailConfig);
    }
  }

  /**
   * Send an email using the configured transport
   *
   * @param data - MailData object containing email details:
   * - emailAddress: Recipient email address
   * - subject: Email subject
   * - textMessage: Plain text email body
   * - htmlMessage: Optional HTML email body
   * @returns Promise resolving to the message info or null if sending failed
   */

  public async sendEmail(data: MailData): Promise<SentMessageInfo | null> {
    try {
      const info = await this.transportInstance.sendMail({
        from: process.env.MAIL_FROM || this.mailConfig.from,
        to: data.emailAddress,
        subject: data.subject,
        text: data.textMessage,
        html: data.htmlMessage
      });

      console.log(`Message sent (${this.mailConfig.transport}):`, info.messageId);
      return info;
    } catch (error) {
      console.error('Error sending email:', error);
      return null;
    }
  }
}

// Create a singleton instance
const EmailService = new EmailServiceClass();

export default EmailService;
