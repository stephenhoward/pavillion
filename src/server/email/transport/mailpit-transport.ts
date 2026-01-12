import nodemailer from 'nodemailer';
import { MailConfig } from '@/server/email/model/types';
import { MailTransport } from '@/server/email/transport/mail-transport';

/**
 * Mailpit transport for Docker-based development email testing.
 *
 * Connects to a Mailpit container running in Docker for email capture.
 * Mailpit provides a web UI at port 8025 to view captured emails.
 *
 * This transport is automatically selected when SMTP_HOST=mailpit
 * (via the config package's environment variable mapping).
 */
export class MailpitTransport extends MailTransport {

  constructor(private mailConfig: MailConfig) {
    super();

    // Mailpit uses SMTP on port 1025 without authentication
    // Settings come from config package which resolves SMTP_HOST/SMTP_PORT env vars
    const host = mailConfig.settings?.host || 'mailpit';
    const port = parseInt(mailConfig.settings?.port || '1025', 10);

    this.transport = nodemailer.createTransport({
      host: host,
      port: port,
      secure: false, // Mailpit doesn't use TLS
      // No authentication required for Mailpit
    });
  }
}
