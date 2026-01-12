import nodemailer from 'nodemailer';
import { MailConfig } from '@/server/email/model/types';
import { MailTransport } from '@/server/email/transport/mail-transport';

/**
 * SMTP transport for production email delivery.
 *
 * Configures nodemailer with SMTP settings from environment variables
 * or configuration files. Supports TLS/SSL and authentication.
 */
export class SmtpTransport extends MailTransport {

  constructor(private mailConfig: MailConfig) {
    super();
    this.transport = nodemailer.createTransport({
      host: process.env.MAIL_HOST || mailConfig.settings.host,
      port: parseInt(process.env.MAIL_PORT || mailConfig.settings.port || '587', 10),
      secure: process.env.MAIL_SECURE === 'true' || mailConfig.settings.secure === true,
      auth: {
        user: process.env.MAIL_USER || mailConfig.settings.user,
        pass: process.env.MAIL_PASS || mailConfig.settings.pass,
      },
    });
  }
}
