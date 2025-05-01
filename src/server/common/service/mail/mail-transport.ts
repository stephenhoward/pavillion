import nodemailer from 'nodemailer';

export abstract class MailTransport {
    protected transport: nodemailer.Transporter | null = null;
    public async sendMail(mailOptions: nodemailer.SendMailOptions): Promise<nodemailer.SentMessageInfo> {
        if (!this.transport) {
          throw new Error('Transport not initialized');
        }
        return this.transport.sendMail(mailOptions);
      }
  }
