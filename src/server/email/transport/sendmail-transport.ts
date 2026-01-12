import nodemailer from 'nodemailer';
import { MailConfig } from '@/server/email/model/types';
import { MailTransport } from '@/server/email/transport/mail-transport';

/**
 * Sendmail transport for systems with local sendmail installed.
 *
 * Uses the system's sendmail binary to send emails.
 */
export class SendmailTransport extends MailTransport {

  constructor(private mailConfig: MailConfig) {
    super();
    this.transport = nodemailer.createTransport({
      sendmail: true,
      path: process.env.MAIL_SENDMAIL_PATH || mailConfig.settings.path || '/usr/sbin/sendmail',
    });
  }
}
