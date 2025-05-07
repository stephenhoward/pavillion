import { describe, it, expect, beforeEach } from 'vitest';
import { EmailStore, StoredEmail } from '@/server/common/service/mail/testing-transport';

describe('EmailStore', () => {
  let emailStore: EmailStore;

  beforeEach(() => {
    // Reset the store before each test
    emailStore = EmailStore.getInstance();
    emailStore.clear();
  });

  it('should store and retrieve emails', () => {
    // Sample email data
    const email: StoredEmail = {
      id: 'test-message-id',
      date: new Date(),
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      text: 'Test content',
      html: '<p>Test content</p>',
      raw: 'Raw email content',
    };

    // Store the email
    emailStore.store(email);

    // Get all emails
    const emails = emailStore.getAll();

    // Verify email was stored
    expect(emails.length).toBe(1);
    expect(emails[0].id).toBe(email.id);
    expect(emails[0].from).toBe(email.from);
    expect(emails[0].to).toBe(email.to);
    expect(emails[0].subject).toBe(email.subject);
    expect(emails[0].text).toBe(email.text);
    expect(emails[0].html).toBe(email.html);
  });

  it('should find emails by recipient', () => {
    // Store multiple emails
    const email1: StoredEmail = {
      id: 'test-message-1',
      date: new Date(),
      from: 'sender@example.com',
      to: 'user1@example.com',
      subject: 'Email for User 1',
      text: 'Content for user1',
      raw: 'Raw content 1',
    };

    const email2: StoredEmail = {
      id: 'test-message-2',
      date: new Date(),
      from: 'sender@example.com',
      to: 'user2@example.com',
      subject: 'Email for User 2',
      text: 'Content for user2',
      raw: 'Raw content 2',
    };

    // Store emails
    emailStore.store(email1);
    emailStore.store(email2);

    // Find by recipient
    const user1Emails = emailStore.findByRecipient('user1@example.com');
    const user2Emails = emailStore.findByRecipient('user2@example.com');
    const nonexistentEmails = emailStore.findByRecipient('nonexistent@example.com');

    // Verify correct emails are found
    expect(user1Emails.length).toBe(1);
    expect(user1Emails[0].id).toBe('test-message-1');

    expect(user2Emails.length).toBe(1);
    expect(user2Emails[0].id).toBe('test-message-2');

    expect(nonexistentEmails.length).toBe(0);
  });

  it('should find emails by subject', () => {
    // Store emails with different subjects
    const email1: StoredEmail = {
      id: 'test-message-1',
      date: new Date(),
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Password Reset',
      text: 'Reset your password',
      raw: 'Raw content 1',
    };

    const email2: StoredEmail = {
      id: 'test-message-2',
      date: new Date(),
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Welcome Message',
      text: 'Welcome to our app',
      raw: 'Raw content 2',
    };

    // Store emails
    emailStore.store(email1);
    emailStore.store(email2);

    // Find by subject (partial match)
    const passwordEmails = emailStore.findBySubject('Password');
    const welcomeEmails = emailStore.findBySubject('Welcome');
    const nonexistentEmails = emailStore.findBySubject('Nonexistent');

    // Verify correct emails are found
    expect(passwordEmails.length).toBe(1);
    expect(passwordEmails[0].id).toBe('test-message-1');

    expect(welcomeEmails.length).toBe(1);
    expect(welcomeEmails[0].id).toBe('test-message-2');

    expect(nonexistentEmails.length).toBe(0);
  });

  it('should handle array of recipients', () => {
    // Email with multiple recipients
    const email: StoredEmail = {
      id: 'test-message-1',
      date: new Date(),
      from: 'sender@example.com',
      to: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
      subject: 'Group Message',
      text: 'Message to multiple recipients',
      raw: 'Raw content',
    };

    // Store the email
    emailStore.store(email);

    // Find by different recipients
    const user1Emails = emailStore.findByRecipient('user1@example.com');
    const user2Emails = emailStore.findByRecipient('user2@example.com');
    const user3Emails = emailStore.findByRecipient('user3@example.com');
    const nonexistentEmails = emailStore.findByRecipient('nonexistent@example.com');

    // Verify each recipient can find the email
    expect(user1Emails.length).toBe(1);
    expect(user1Emails[0].id).toBe('test-message-1');

    expect(user2Emails.length).toBe(1);
    expect(user2Emails[0].id).toBe('test-message-1');

    expect(user3Emails.length).toBe(1);
    expect(user3Emails[0].id).toBe('test-message-1');

    expect(nonexistentEmails.length).toBe(0);
  });

  it('should get the latest email', () => {
    // No emails
    expect(emailStore.getLatest()).toBeUndefined();

    // Add first email
    const email1: StoredEmail = {
      id: 'test-message-1',
      date: new Date(2023, 1, 1),
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'First Email',
      text: 'First email content',
      raw: 'Raw content 1',
    };
    emailStore.store(email1);

    // Check latest
    expect(emailStore.getLatest()?.id).toBe('test-message-1');

    // Add second email
    const email2: StoredEmail = {
      id: 'test-message-2',
      date: new Date(2023, 1, 2),
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Second Email',
      text: 'Second email content',
      raw: 'Raw content 2',
    };
    emailStore.store(email2);

    // Check latest is updated
    expect(emailStore.getLatest()?.id).toBe('test-message-2');
  });

  it('should clear all stored emails', () => {
    // Store some emails
    emailStore.store({
      id: 'test-message-1',
      date: new Date(),
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Test Subject',
      text: 'Test content',
      raw: 'Raw content',
    });

    emailStore.store({
      id: 'test-message-2',
      date: new Date(),
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Another Subject',
      text: 'More content',
      raw: 'More raw content',
    });

    // Verify emails are stored
    expect(emailStore.getAll().length).toBe(2);

    // Clear emails
    emailStore.clear();

    // Verify emails are removed
    expect(emailStore.getAll().length).toBe(0);
    expect(emailStore.getLatest()).toBeUndefined();
  });
});
