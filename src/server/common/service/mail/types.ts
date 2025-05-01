/**
 * Types for mail configuration
 */
export interface MailConfig {
  transport: 'smtp' | 'sendmail' | 'development' | 'testing';
  from: string;
  settings: {
    [key: string]: any;
  };
}