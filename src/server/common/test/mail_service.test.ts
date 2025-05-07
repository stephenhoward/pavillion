import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EmailStore } from '@/server/common/service/mail/testing-transport';

// Now import EmailService after all mocks are in place
import EmailService from '../service/mail';

describe('EmailService', () => {
  let sandbox: sinon.SinonSandbox;
  let emailStore: EmailStore;

  beforeEach(() => {
    // Create a sandbox for sinon
    sandbox = sinon.createSandbox();

    // Get the email store instance
    emailStore = EmailStore.getInstance();
    emailStore.clear();
  });

  afterEach(() => {
    // Restore all the sandbox stubs
    sandbox.restore();
  });

  it('should send an email with the correct parameters', async () => {
    // Arrange
    const to = 'recipient@example.com';
    const subject = 'Test Subject';
    const text = 'Test plain text content';
    const html = '<p>Test HTML content</p>';

    // Act
    expect( emailStore.getLatest() ).toBe(undefined);
    const result = await EmailService.sendEmail(to, subject, text, html);

    // Assert
    const message = emailStore.getLatest();

    expect(result).not.toBeNull();
    expect(message).not.toBeNull();
  });

  it('should handle errors when sending fails', async () => {
    // Arrange
    const consoleErrorStub = sandbox.stub(console, 'error');
    const errorMessage = 'Sending failed';
    let mockSendMail = sandbox.stub(EmailService.transportInstance, 'sendMail');

    // Make sendMail throw an error for this test only
    mockSendMail.rejects(new Error(errorMessage));

    // Act
    const result = await EmailService.sendEmail(
      'test@example.com',
      'Test Subject',
      'Test content',
    );

    // Assert
    expect(result).toBeNull();
    expect(consoleErrorStub.calledWith('Error sending email:', sinon.match.instanceOf(Error))).toBe(true);

    // Reset the mock after this test
    mockSendMail.resolves({
      messageId: 'test-message-id',
      envelope: { from: 'from@example.com', to: ['to@example.com'] },
    });
  });

  it('should use the from address from config', async () => {
    // Arrange
    let mockSendMail = sandbox.stub(EmailService.transportInstance, 'sendMail');

    // Act
    await EmailService.sendEmail(
      'test@example.com',
      'Test Subject',
      'Test content',
    );

    // Assert
    expect(mockSendMail.calledOnce).toBe(true);
    expect(mockSendMail.firstCall.args[0]).toHaveProperty('from');
  });
});
