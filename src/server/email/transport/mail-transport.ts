import nodemailer from 'nodemailer';

/**
 * Abstract base class for mail transports.
 *
 * All transport implementations extend this class and provide
 * their own configured nodemailer transporter.
 */
export abstract class MailTransport {
  protected transport: nodemailer.Transporter | null = null;

  /**
   * Sends an email using the configured transport.
   *
   * @param mailOptions - Nodemailer mail options
   * @returns Promise resolving to sent message info
   * @throws Error if transport is not initialized
   */
  public async sendMail(mailOptions: nodemailer.SendMailOptions): Promise<nodemailer.SentMessageInfo> {
    if (!this.transport) {
      throw new Error('Transport not initialized');
    }
    return this.transport.sendMail(mailOptions);
  }
}
