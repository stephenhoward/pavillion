/**
 * Types for mail configuration
 *
 * This module defines the core types used throughout the email domain
 * for configuring and sending emails via various transports.
 */

/**
 * Valid transport types for mail delivery
 */
export type MailTransportType = 'smtp' | 'sendmail' | 'development' | 'testing' | 'mailpit';

/**
 * Configuration for mail transport and delivery
 */
export interface MailConfig {
  transport: MailTransportType;
  from: string;
  settings: {
    [key: string]: any;
  };
}

/**
 * Data structure for email content
 */
export interface MailData {
  emailAddress: string;
  subject: string;
  textMessage: string;
  htmlMessage?: string;
}

/**
 * Type guard to validate MailConfig objects
 *
 * @param config - Object to validate
 * @returns True if the object is a valid MailConfig
 */
export function isValidMailConfig(config: unknown): config is MailConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const obj = config as Record<string, unknown>;

  // Check required fields exist
  if (!('transport' in obj) || !('from' in obj) || !('settings' in obj)) {
    return false;
  }

  // Validate transport type
  const validTransports: MailTransportType[] = ['smtp', 'sendmail', 'development', 'testing', 'mailpit'];
  if (typeof obj.transport !== 'string' || !validTransports.includes(obj.transport as MailTransportType)) {
    return false;
  }

  // Validate from is a string
  if (typeof obj.from !== 'string') {
    return false;
  }

  // Validate settings is an object
  if (typeof obj.settings !== 'object' || obj.settings === null) {
    return false;
  }

  return true;
}
