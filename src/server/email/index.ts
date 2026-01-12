/**
 * Email Domain
 *
 * This domain handles all email-related functionality including:
 * - Email sending via various transports (SMTP, Mailpit, Development, Testing)
 * - Email message templates with i18n support
 * - Transport selection based on environment
 *
 * Usage:
 * - For domain initialization: import EmailDomain from '@/server/email'
 * - For cross-domain communication: import EmailInterface from '@/server/email/interface'
 * - For types: import { MailData } from '@/server/email/model/types'
 * - For message templates: import { EmailMessage, compileTemplate } from '@/server/email/model/message'
 */

import EmailInterface from './interface';

/**
 * Email Domain entry point.
 * Manages email services and provides the interface for cross-domain communication.
 *
 * Unlike other domains, the Email domain does not have API routes or event handlers.
 * It provides email sending capabilities to other domains via its interface.
 */
export default class EmailDomain {
  public readonly interface: EmailInterface;

  constructor() {
    this.interface = new EmailInterface();
  }
}
