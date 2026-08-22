/**
 * Shared email composition types.
 *
 * MailData lives in common so every domain can compose messages without
 * importing the email domain's internals. Transport configuration types
 * remain in the email domain.
 */

/**
 * Data structure for email content
 */
export interface MailData {
  emailAddress: string;
  subject: string;
  textMessage: string;
  htmlMessage?: string;
}
