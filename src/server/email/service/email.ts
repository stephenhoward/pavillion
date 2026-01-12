import config from 'config';
import { SentMessageInfo } from 'nodemailer';

import { MailConfig, MailData, MailTransportType } from '@/server/email/model/types';
import { MailTransport } from '@/server/email/transport/mail-transport';
import { SmtpTransport } from '@/server/email/transport/smtp-transport';
import { SendmailTransport } from '@/server/email/transport/sendmail-transport';
import { DevelopmentTransport } from '@/server/email/transport/development-transport';
import { TestingTransport } from '@/server/email/transport/testing-transport';
import { MailpitTransport } from '@/server/email/transport/mailpit-transport';

/**
 * Email Service for sending messages via various transports.
 *
 * Provides a unified interface for sending emails regardless of the
 * underlying transport mechanism. Supports automatic transport selection
 * based on environment and configuration.
 */
class EmailServiceClass {
  public transportInstance: MailTransport;
  private mailConfig: MailConfig;
  private transportType: MailTransportType;

  /**
   * Initializes the Email Service with configured transport.
   * Reads configuration and creates appropriate transport instance.
   */
  constructor() {
    this.mailConfig = this.getMailConfig();
    this.transportType = this.mailConfig.transport;
    this.transportInstance = this.createTransport();
  }

  /**
   * Gets the current transport type for testing/debugging.
   *
   * @returns The transport type identifier
   */
  public getTransportType(): MailTransportType {
    return this.transportType;
  }

  /**
   * Gets mail configuration from config files with sensible defaults.
   * Uses the config package which automatically applies environment variable
   * overrides from custom-environment-variables.yaml.
   *
   * Environment variables (via config package):
   * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_SECURE: SMTP settings
   * - MAIL_TRANSPORT: Override transport type
   * - MAIL_FROM: Override sender address
   *
   * Transport selection priority:
   * 1. Test environment (NODE_ENV=test): Testing transport (in-memory)
   * 2. SMTP_HOST=mailpit: Mailpit transport (Docker development)
   * 3. SMTP_HOST set (without explicit MAIL_TRANSPORT): SMTP transport
   * 4. MAIL_TRANSPORT explicitly set: Use specified transport
   * 5. NODE_ENV=development (without SMTP_HOST): Development transport (file-based)
   * 6. Default: From config file or development transport
   *
   * @returns The mail configuration object
   */
  private getMailConfig(): MailConfig {
    const defaultConfig: MailConfig = {
      transport: 'development',
      from: 'noreply@example.com',
      settings: {},
    };

    // For test environment, always use testing transport
    if (process.env.NODE_ENV === 'test') {
      const fromAddress = config.has('mail.from') ? config.get<string>('mail.from') : defaultConfig.from;
      return {
        transport: 'testing',
        from: fromAddress,
        settings: {},
      };
    }

    // Load configuration from config package (includes env var overrides)
    let mailConfig: MailConfig = defaultConfig;
    try {
      if (config.has('mail')) {
        mailConfig = config.get('mail');
      }
    }
    catch (err) {
      console.warn('Mail configuration not found, using defaults');
    }

    // Check for Mailpit (Docker development) - detected by SMTP_HOST=mailpit
    if (mailConfig.settings?.host === 'mailpit') {
      return {
        transport: 'mailpit',
        from: mailConfig.from || defaultConfig.from,
        settings: {
          host: 'mailpit',
          port: mailConfig.settings?.port || '1025',
        },
      };
    }

    // If SMTP host is configured and transport is not explicitly set to a sending transport,
    // auto-detect SMTP transport. This handles production with SMTP_HOST but no MAIL_TRANSPORT.
    const autoDetectTransports = ['development', 'test'];
    if (mailConfig.settings?.host && autoDetectTransports.includes(mailConfig.transport)) {
      return {
        ...mailConfig,
        transport: 'smtp',
      };
    }

    // If transport is explicitly set (via config or MAIL_TRANSPORT env), use it
    if (mailConfig.transport && mailConfig.transport !== 'test') {
      return mailConfig;
    }

    // For development without SMTP host, use development transport (file-based)
    if (process.env.NODE_ENV === 'development' && !mailConfig.settings?.host) {
      return {
        transport: 'development',
        from: mailConfig.from || defaultConfig.from,
        settings: {
          outputDir: mailConfig.settings?.outputDir || 'logs/mail',
          console: mailConfig.settings?.console !== false,
        },
      };
    }

    return mailConfig;
  }

  /**
   * Creates a mail transport based on the configuration.
   * Supports SMTP, sendmail, mailpit, development, and testing transports.
   *
   * @returns The configured mail transport instance
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

      case 'mailpit':
        return new MailpitTransport(this.mailConfig);

      case 'development':
      default:
        return new DevelopmentTransport(this.mailConfig);
    }
  }

  /**
   * Sends an email using the configured transport.
   *
   * @param data - Mail data object containing email details
   * @returns Promise resolving to the message info or null if sending failed
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

/**
 * Factory function to create a new EmailService instance.
 *
 * Used for testing to get fresh instances with different environment configurations.
 *
 * @returns A new EmailServiceClass instance
 */
export function createEmailService(): EmailServiceClass {
  return new EmailServiceClass();
}

// Create a singleton instance for normal use
const EmailService = new EmailServiceClass();

export default EmailService;
