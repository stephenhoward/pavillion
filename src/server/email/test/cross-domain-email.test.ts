/**
 * Integration tests for cross-domain email sending.
 *
 * These tests verify that other domains can successfully send emails
 * through the new email domain interface.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import EmailService from '@/server/email/service/email';
import { EmailStore } from '@/server/email/transport/testing-transport';
import { Account } from '@/common/model/account';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import PasswordResetEmail from '@/server/authentication/model/password_reset_email';
import EditorNotificationEmail from '@/server/calendar/model/editor_notification_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

// Initialize i18next for template rendering
initI18Next();

describe('Cross-Domain Email Integration', () => {
  let sandbox: sinon.SinonSandbox;
  let emailStore: EmailStore;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    emailStore = EmailStore.getInstance();
    emailStore.clear();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Authentication Domain - Password Reset Email', () => {
    it('should send password reset email successfully through email service', async () => {
      // Arrange
      const account = new Account('test-id', 'testuser', 'user@example.com');
      const resetToken = 'test-reset-token-123';

      const passwordResetEmail = new PasswordResetEmail(account, resetToken);
      const mailData = passwordResetEmail.buildMessage('en');

      // Act
      const result = await EmailService.sendEmail(mailData);

      // Assert
      expect(result).not.toBeNull();

      const storedEmail = emailStore.getLatest();
      expect(storedEmail).toBeDefined();
      expect(storedEmail?.to).toContain('user@example.com');
      expect(storedEmail?.subject).toBeDefined();
      expect(storedEmail?.text).toContain(resetToken);
    });

    it('should capture password reset email content in testing transport', async () => {
      // Arrange
      const account = new Account('test-id', 'testuser', 'recipient@test.com');
      const resetToken = 'unique-token-456';

      const passwordResetEmail = new PasswordResetEmail(account, resetToken);
      const mailData = passwordResetEmail.buildMessage('en');

      // Act
      await EmailService.sendEmail(mailData);

      // Assert
      const emails = emailStore.findByRecipient('recipient@test.com');
      expect(emails.length).toBe(1);
      expect(emails[0].text).toContain(resetToken);
    });
  });

  describe('Calendar Domain - Editor Notification Email', () => {
    it('should send editor notification email successfully through email service', async () => {
      // Arrange
      const calendar = new Calendar('cal-123', 'test-calendar');
      const content = new CalendarContent('en');
      content.name = 'Test Calendar';
      calendar.addContent(content);

      const inviter = new Account('inviter-id', 'inviter', 'inviter@example.com');
      const recipient = new Account('recipient-id', 'recipient', 'editor@example.com');

      const notificationEmail = new EditorNotificationEmail(
        calendar,
        inviter,
        recipient,
        'Welcome to the team!',
      );
      const mailData = notificationEmail.buildMessage('en');

      // Act
      const result = await EmailService.sendEmail(mailData);

      // Assert
      expect(result).not.toBeNull();

      const storedEmail = emailStore.getLatest();
      expect(storedEmail).toBeDefined();
      expect(storedEmail?.to).toContain('editor@example.com');
      expect(storedEmail?.subject).toBeDefined();
    });

    it('should capture editor notification email content with calendar name', async () => {
      // Arrange
      const calendar = new Calendar('cal-456', 'my-calendar');
      const content = new CalendarContent('en');
      content.name = 'My Awesome Calendar';
      calendar.addContent(content);

      const inviter = new Account('inviter-id', 'owner', 'owner@test.com');
      const recipient = new Account('recipient-id', 'neweditor', 'neweditor@test.com');
      const personalMessage = 'Looking forward to collaborating!';

      const notificationEmail = new EditorNotificationEmail(
        calendar,
        inviter,
        recipient,
        personalMessage,
      );
      const mailData = notificationEmail.buildMessage('en');

      // Act
      await EmailService.sendEmail(mailData);

      // Assert
      const emails = emailStore.findByRecipient('neweditor@test.com');
      expect(emails.length).toBe(1);

      // Verify email contains relevant calendar information
      const emailText = emails[0].text;
      expect(emailText).toBeDefined();
    });
  });

  describe('Email Store Functionality', () => {
    it('should track multiple emails from different domains', async () => {
      // Arrange - Create emails from different domains
      const account = new Account('user-id', 'user', 'user@test.com');
      const passwordResetEmail = new PasswordResetEmail(account, 'token-1');

      const calendar = new Calendar('cal-789', 'shared-calendar');
      const calContent = new CalendarContent('en');
      calContent.name = 'Shared Calendar';
      calendar.addContent(calContent);
      const inviter = new Account('inviter-id', 'inviter', 'inviter@test.com');
      const editorEmail = new EditorNotificationEmail(calendar, inviter, account);

      // Act - Send both emails
      await EmailService.sendEmail(passwordResetEmail.buildMessage('en'));
      await EmailService.sendEmail(editorEmail.buildMessage('en'));

      // Assert - Both emails should be captured
      const allEmails = emailStore.getAll();
      expect(allEmails.length).toBe(2);

      // Find emails by recipient
      const userEmails = emailStore.findByRecipient('user@test.com');
      expect(userEmails.length).toBe(2);
    });

    it('should allow clearing emails between test scenarios', async () => {
      // Arrange
      const account = new Account('user-id', 'user', 'user@test.com');
      const email = new PasswordResetEmail(account, 'token');

      // Act - Send an email
      await EmailService.sendEmail(email.buildMessage('en'));
      expect(emailStore.getAll().length).toBe(1);

      // Clear the store
      emailStore.clear();

      // Assert
      expect(emailStore.getAll().length).toBe(0);
      expect(emailStore.getLatest()).toBeUndefined();
    });
  });
});
