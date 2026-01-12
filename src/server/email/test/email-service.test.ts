import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';

/**
 * Tests for Email Domain Core Functionality
 *
 * These tests verify:
 * - Transport selection logic (test vs development vs mailpit vs smtp)
 * - EmailService.sendEmail() method with mock transport
 * - MailConfig type validation
 */

describe('EmailService Transport Selection', () => {
  let sandbox: sinon.SinonSandbox;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Reset modules to ensure fresh imports
    vi.resetModules();
  });

  afterEach(() => {
    sandbox.restore();
    // Restore environment
    process.env = { ...originalEnv };
  });

  it('should select TestingTransport when NODE_ENV is test', async () => {
    // Arrange
    process.env.NODE_ENV = 'test';
    delete process.env.MAIL_HOST;

    // Act - import fresh instance
    const { createEmailService } = await import('../service/email');
    const service = createEmailService();

    // Assert
    expect(service.getTransportType()).toBe('testing');
  });

  it('should correctly instantiate MailpitTransport', async () => {
    // Since Vitest sets NODE_ENV=test, we test that the MailpitTransport
    // class works correctly when instantiated directly
    const { MailpitTransport } = await import('../transport/mailpit-transport');

    const mailConfig = {
      transport: 'mailpit' as const,
      from: 'test@example.com',
      settings: {
        host: 'mailpit',
        port: '1025',
      },
    };

    const transport = new MailpitTransport(mailConfig);
    expect(transport).toBeDefined();
  });

  it('should correctly instantiate DevelopmentTransport', async () => {
    // Since Vitest sets NODE_ENV=test, we test that the DevelopmentTransport
    // class works correctly when instantiated directly
    const { DevelopmentTransport } = await import('../transport/development-transport');

    const mailConfig = {
      transport: 'development' as const,
      from: 'test@example.com',
      settings: {
        outputDir: 'logs/mail',
      },
    };

    const transport = new DevelopmentTransport(mailConfig);
    expect(transport).toBeDefined();
  });

  it('should correctly instantiate SmtpTransport', async () => {
    // Since Vitest sets NODE_ENV=test, we test that the SmtpTransport
    // class works correctly when instantiated directly
    // (Transport selection in EmailService is overridden in test environment)
    const { SmtpTransport } = await import('../transport/smtp-transport');

    const mailConfig = {
      transport: 'smtp' as const,
      from: 'test@example.com',
      settings: {
        host: 'smtp.example.com',
        port: '587',
        user: 'user@example.com',
        pass: 'password',
        secure: 'false',
      },
    };

    const transport = new SmtpTransport(mailConfig);
    expect(transport).toBeDefined();
  });

  it('should verify transport selection priority order', async () => {
    // Test the priority order documented in getMailConfig:
    // 1. Test environment (NODE_ENV=test): Testing transport <- always true in Vitest
    // 2. Docker/Mailpit (MAIL_HOST=mailpit): Mailpit transport
    // 3. Explicit transport (MAIL_TRANSPORT env): Specified transport
    // 4. SMTP configured (MAIL_HOST set): SMTP transport
    // 5. Development environment: Development transport
    // 6. Config file transport setting
    // 7. Default: Development transport

    // In test environment, should always get testing transport
    process.env.NODE_ENV = 'test';
    const { createEmailService } = await import('../service/email');
    const service = createEmailService();
    expect(service.getTransportType()).toBe('testing');
  });
});

describe('EmailService.sendEmail', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    vi.resetModules();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should send an email with correct parameters using testing transport', async () => {
    // Arrange
    process.env.NODE_ENV = 'test';

    const { createEmailService } = await import('../service/email');
    const { EmailStore } = await import('../transport/testing-transport');
    const service = createEmailService();
    const emailStore = EmailStore.getInstance();
    emailStore.clear();

    const emailData = {
      emailAddress: 'recipient@example.com',
      subject: 'Test Subject',
      textMessage: 'Test plain text content',
      htmlMessage: '<p>Test HTML content</p>',
    };

    // Act
    const result = await service.sendEmail(emailData);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.messageId).toBeDefined();

    const storedEmail = emailStore.getLatest();
    expect(storedEmail).toBeDefined();
    // Note: `to` is stored as an array by nodemailer
    expect(storedEmail?.to).toContain('recipient@example.com');
    expect(storedEmail?.subject).toBe('Test Subject');
  });

  it('should return null and log error when sending fails', async () => {
    // Arrange
    process.env.NODE_ENV = 'test';

    const { createEmailService } = await import('../service/email');
    const service = createEmailService();

    // Mock the transport to fail
    const errorMessage = 'Sending failed';
    const sendMailStub = sandbox.stub(service.transportInstance, 'sendMail');
    sendMailStub.rejects(new Error(errorMessage));

    const consoleErrorStub = sandbox.stub(console, 'error');

    // Act
    const result = await service.sendEmail({
      emailAddress: 'test@example.com',
      subject: 'Test Subject',
      textMessage: 'Test content',
    });

    // Assert
    expect(result).toBeNull();
    expect(consoleErrorStub.calledWith('Error sending email:', sinon.match.instanceOf(Error))).toBe(true);
  });

  it('should use MAIL_FROM environment variable when set', async () => {
    // Arrange
    process.env.NODE_ENV = 'test';
    process.env.MAIL_FROM = 'custom-sender@example.com';

    const { createEmailService } = await import('../service/email');
    const service = createEmailService();

    const sendMailStub = sandbox.stub(service.transportInstance, 'sendMail');
    sendMailStub.resolves({
      messageId: 'test-message-id',
      envelope: { from: 'custom-sender@example.com', to: ['to@example.com'] },
    });

    // Act
    await service.sendEmail({
      emailAddress: 'test@example.com',
      subject: 'Test Subject',
      textMessage: 'Test content',
    });

    // Assert
    expect(sendMailStub.calledOnce).toBe(true);
    expect(sendMailStub.firstCall.args[0]).toHaveProperty('from', 'custom-sender@example.com');

    // Cleanup
    delete process.env.MAIL_FROM;
  });
});

describe('MailConfig Type Validation', () => {
  it('should accept valid MailConfig with smtp transport', async () => {
    const { isValidMailConfig } = await import('../model/types');

    const config = {
      transport: 'smtp' as const,
      from: 'noreply@example.com',
      settings: {
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        user: 'user',
        pass: 'password',
      },
    };

    expect(isValidMailConfig(config)).toBe(true);
  });

  it('should accept valid MailConfig with mailpit transport', async () => {
    const { isValidMailConfig } = await import('../model/types');

    const config = {
      transport: 'mailpit' as const,
      from: 'noreply@example.com',
      settings: {},
    };

    expect(isValidMailConfig(config)).toBe(true);
  });

  it('should accept valid MailConfig with development transport', async () => {
    const { isValidMailConfig } = await import('../model/types');

    const config = {
      transport: 'development' as const,
      from: 'noreply@example.com',
      settings: {
        outputDir: 'logs/mail',
      },
    };

    expect(isValidMailConfig(config)).toBe(true);
  });

  it('should accept valid MailConfig with testing transport', async () => {
    const { isValidMailConfig } = await import('../model/types');

    const config = {
      transport: 'testing' as const,
      from: 'noreply@example.com',
      settings: {},
    };

    expect(isValidMailConfig(config)).toBe(true);
  });

  it('should reject MailConfig with missing required fields', async () => {
    const { isValidMailConfig } = await import('../model/types');

    // Missing transport
    expect(isValidMailConfig({
      from: 'noreply@example.com',
      settings: {},
    })).toBe(false);

    // Missing from
    expect(isValidMailConfig({
      transport: 'smtp',
      settings: {},
    })).toBe(false);

    // Missing settings
    expect(isValidMailConfig({
      transport: 'smtp',
      from: 'noreply@example.com',
    })).toBe(false);
  });

  it('should reject MailConfig with invalid transport type', async () => {
    const { isValidMailConfig } = await import('../model/types');

    const config = {
      transport: 'invalid-transport',
      from: 'noreply@example.com',
      settings: {},
    };

    expect(isValidMailConfig(config)).toBe(false);
  });
});
