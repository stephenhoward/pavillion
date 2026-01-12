import nodemailer from 'nodemailer';
import { MailConfig } from '@/server/email/model/types';
import { MailTransport } from '@/server/email/transport/mail-transport';

/**
 * Interface for email storage in testing transport
 */
export interface StoredEmail {
  id: string;
  date: Date;
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  raw: string;
}

/**
 * In-memory store for sent emails during testing.
 *
 * Provides singleton access to stored emails for verification in tests.
 */
export class EmailStore {
  private static instance: EmailStore;
  private emails: StoredEmail[] = [];

  private constructor() {}

  /**
   * Get singleton instance of EmailStore
   */
  public static getInstance(): EmailStore {
    if (!EmailStore.instance) {
      EmailStore.instance = new EmailStore();
    }
    return EmailStore.instance;
  }

  /**
   * Store an email
   */
  store(email: StoredEmail): void {
    this.emails.push(email);
  }

  /**
   * Get all stored emails
   */
  getAll(): StoredEmail[] {
    return [...this.emails];
  }

  /**
   * Find emails by recipient email address
   */
  findByRecipient(email: string): StoredEmail[] {
    return this.emails.filter(mail => {
      if (Array.isArray(mail.to)) {
        return mail.to.includes(email);
      }
      return mail.to === email;
    });
  }

  /**
   * Find emails by subject (case-insensitive partial match)
   */
  findBySubject(subject: string): StoredEmail[] {
    return this.emails.filter(mail =>
      mail.subject.toLowerCase().includes(subject.toLowerCase()),
    );
  }

  /**
   * Get most recent email
   */
  getLatest(): StoredEmail | undefined {
    if (this.emails.length === 0) return undefined;
    return this.emails[this.emails.length - 1];
  }

  /**
   * Clear all stored emails
   */
  clear(): void {
    this.emails = [];
  }
}

/**
 * Memory-based transport for testing purposes.
 *
 * Stores emails in an in-memory store that can be queried in tests
 * to verify email sending behavior.
 */
export class TestingTransport extends MailTransport {
  protected emailStore: EmailStore;

  constructor(private mailConfig: MailConfig) {
    super();
    this.emailStore = EmailStore.getInstance();
    this.transport = nodemailer.createTransport({
      name: 'testing',
      version: '1.0.0',
      send: async (mail, callback) => {
        try {
          // Build the email content
          const message = mail.message.createReadStream();
          let rawContent = '';
          for await (const chunk of message) {
            rawContent += chunk.toString();
          }

          // Extract email data from envelope (from and to)
          const { from, to } = mail.message.getEnvelope();
          const messageId = `<testing-${Date.now()}-${Math.random().toString(36).substring(2, 10)}@test>`;

          // Get text, HTML, and subject from mail data (not envelope)
          const mailData = mail.data || {};
          const subject = mailData.subject as string || '(No subject)';

          // Store the email in memory
          this.emailStore.store({
            id: messageId,
            date: new Date(),
            from: from,
            to: to,
            subject: subject,
            text: mailData.text || '',
            html: mailData.html,
            raw: rawContent,
          });

          if (process.env.NODE_ENV === 'test' && process.env.MAIL_TEST_VERBOSE === 'true') {
            console.log('\n--- Email Sent (Testing Transport) ---');
            console.log(`From: ${from}`);
            console.log(`To: ${to}`);
            console.log(`Subject: ${subject}`);
            console.log('--- End Email ---\n');
          }

          // Return success
          callback(null, {
            messageId: messageId,
            envelope: mail.message.getEnvelope(),
            originalMessage: mail.message,
          });
        }
        catch (err) {
          console.error('Failed to store email in memory', err);
          callback(err);
        }
      },
    });
  }

  /**
   * Get all emails sent (when using testing transport)
   */
  public getEmails(): StoredEmail[] {
    return this.emailStore.getAll();
  }

  /**
   * Get the most recently sent email
   */
  public getLatestEmail(): StoredEmail | undefined {
    return EmailStore.getInstance().getLatest();
  }

  /**
   * Find emails sent to a specific recipient
   */
  public findEmailsByRecipient(email: string): StoredEmail[] {
    return EmailStore.getInstance().findByRecipient(email);
  }

  /**
   * Find emails with subject containing the specified text
   */
  public findEmailsBySubject(subject: string): StoredEmail[]  {
    return EmailStore.getInstance().findBySubject(subject);
  }

  /**
   * Clear all stored emails (useful between tests)
   */
  clearEmails(): void {
    EmailStore.getInstance().clear();
  }
}
