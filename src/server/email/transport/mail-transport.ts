import type { SendMailOptions, SentMessageInfo, Transporter } from 'nodemailer';

/**
 * Abstract base class for mail transports.
 *
 * All transport implementations extend this class and provide
 * their own configured nodemailer transporter.
 */
export abstract class MailTransport {
  protected transport: Transporter | null = null;

  /**
   * Sends an email using the configured transport.
   *
   * @param mailOptions - Nodemailer mail options
   * @returns Promise resolving to sent message info
   * @throws Error if transport is not initialized
   */
  public async sendMail(mailOptions: SendMailOptions): Promise<SentMessageInfo> {
    if (!this.transport) {
      throw new Error('Transport not initialized');
    }
    return this.transport.sendMail(mailOptions);
  }
}
