/**
 * Types for mail configuration
 */
export interface MailConfig {
  transport: 'smtp' | 'sendmail' | 'development' | 'testing';
  from: string;
  settings: {
    [key: string]: any;
  };
};

export interface MailData {
    emailAddress: string;
    subject: string;
    textMessage: string;
    htmlMessage?: string;
};
