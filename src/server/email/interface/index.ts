import { SentMessageInfo } from 'nodemailer';
import EmailService from '@/server/email/service/email';
import { MailData } from '@/server/email/model/types';
import { TestingTransport, StoredEmail } from '@/server/email/transport/testing-transport';

/**
 * Email domain interface for cross-domain communication.
 *
 * Provides a clean interface for other domains to send emails without
 * depending on internal email domain implementation details.
 */
export default class EmailInterface {
  /**
   * Sends an email using the configured transport.
   *
   * @param data - Mail data object containing email details
   * @returns Promise resolving to the message info or null if sending failed
   */
  async sendEmail(data: MailData): Promise<SentMessageInfo | null> {
    return EmailService.sendEmail(data);
  }

  /**
   * Gets the most recently sent email.
   * Only available when using the testing transport.
   *
   * @returns The most recent email or undefined if no emails or not using testing transport
   */
  getLatestEmail(): StoredEmail | undefined {
    const transport = EmailService.transportInstance;
    if (transport instanceof TestingTransport) {
      return transport.getLatestEmail();
    }
    return undefined;
  }

  /**
   * Finds emails sent to a specific recipient.
   * Only available when using the testing transport.
   *
   * @param email - Recipient email address to search for
   * @returns Array of matching emails or empty array if not using testing transport
   */
  findEmailsByRecipient(email: string): StoredEmail[] {
    const transport = EmailService.transportInstance;
    if (transport instanceof TestingTransport) {
      return transport.findEmailsByRecipient(email);
    }
    return [];
  }

  /**
   * Clears all stored emails.
   * Only available when using the testing transport.
   */
  clearEmails(): void {
    const transport = EmailService.transportInstance;
    if (transport instanceof TestingTransport) {
      transport.clearEmails();
    }
  }

  /**
   * Gets the current transport type.
   * Useful for debugging and testing.
   *
   * @returns The transport type identifier
   */
  getTransportType(): string {
    return EmailService.getTransportType();
  }
}
