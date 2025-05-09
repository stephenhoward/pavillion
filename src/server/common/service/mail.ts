import config from 'config';
import { SentMessageInfo } from 'nodemailer';

import { MailConfig, MailData } from '@/server/common/service/mail/types';
import { MailTransport } from '@/server/common/service/mail/mail-transport';
import { SmtpTransport } from '@/server/common/service/mail/smtp-transport';
import { SendmailTransport } from '@/server/common/service/mail/sendmail-transport';
import { DevelopmentTransport } from '@/server/common/service/mail/development-transport';
import { TestingTransport } from '@/server/common/service/mail/testing-transport';

/**
 * Email Service for sending messages via various transports.
 * Provides a unified interface for sending emails regardless of the underlying transport mechanism.
 */
class EmailServiceClass {
  public transportInstance: MailTransport;
  private mailConfig: MailConfig;

  /**
   * Initializes the Email Service with configured transport.
   * Reads configuration and creates appropriate transport instance.
   */
  constructor() {
    this.mailConfig = this.getMailConfig();
    this.transportInstance = this.createTransport();
  }

  /**
   * Gets mail configuration from config files with sensible defaults.
   * Falls back to environment-specific defaults if configuration is missing.
   *
   * @returns {MailConfig} The mail configuration object
   * @private
   */
  private getMailConfig(): MailConfig {
    const defaultConfig: MailConfig = {
      transport: 'development',
      from: 'noreply@example.com',
      settings: {},
    };

    try {
      if (config.has('mail')) {
        return config.get('mail');
      }
    }
    catch (err) {
      console.warn('Mail configuration not found, using default transport');
      console.warn(err);
    }

    // For test environment, use testing transport
    if (process.env.NODE_ENV === 'test') {
      return {
        transport: 'testing',
        from: process.env.MAIL_FROM || defaultConfig.from,
        settings: {},
      };
    }

    // For development, use development transport by default
    if (process.env.NODE_ENV === 'development') {
      return {
        transport: 'development',
        from: process.env.MAIL_FROM || defaultConfig.from,
        settings: {
          outputDir: process.env.MAIL_OUTPUT_DIR || 'logs/mail',
          console: process.env.MAIL_CONSOLE !== 'false',
        },
      };
    }

    return defaultConfig;
  }

  /**
   * Creates a mail transport based on the configuration.
   * Supports SMTP, sendmail, development, and testing transports.
   *
   * @returns {MailTransport} The configured mail transport instance
   * @private
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
   * Sends an email using the configured transport.
   *
   * @param {MailData} data - Mail data object containing email details:
   * @param {string} data.emailAddress - Recipient email address
   * @param {string} data.subject - Email subject
   * @param {string} data.textMessage - Plain text email body
   * @param {string} [data.htmlMessage] - Optional HTML email body
   * @returns {Promise<SentMessageInfo | null>} Promise resolving to the message info or null if sending failed
   */
  public async sendEmail(data: MailData): Promise<SentMessageInfo | null> {
    try {
      const info = await this.transportInstance.sendMail({
        from: process.env.MAIL_FROM || this.mailConfig.from,
        to: data.emailAddress,
        subject: data.subject,
        text: data.textMessage,
        html: data.htmlMessage,
      });

      console.log(`Message sent (${this.mailConfig.transport}):`, info.messageId);
      return info;
    }
    catch (error) {
      console.error('Error sending email:', error);
      return null;
    }
  }
}

// Create a singleton instance
const EmailService = new EmailServiceClass();

export default EmailService;
