import nodemailer from 'nodemailer';
import { MailConfig } from '@/server/common/service/mail/types';
import { MailTransport } from '@/server/common/service/mail/mail-transport';

export class SendmailTransport extends MailTransport {

  constructor(private mailConfig: MailConfig) {
    super();
    this.transport = nodemailer.createTransport({
      sendmail: true,
      path: process.env.MAIL_SENDMAIL_PATH || mailConfig.settings.path || '/usr/sbin/sendmail',
    });
  }
}
