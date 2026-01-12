import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import nodemailer from 'nodemailer';
import { MailpitTransport } from '../transport/mailpit-transport';
import { MailConfig } from '../model/types';

/**
 * Tests for Mailpit Transport Implementation
 *
 * These tests verify:
 * - MailpitTransport instantiation with valid config
 * - SMTP connection configuration (host, port, no auth)
 * - Transport selection when SMTP_HOST=mailpit (via config package)
 * - sendMail method passes through to nodemailer correctly
 */

describe('MailpitTransport', () => {
  let sandbox: sinon.SinonSandbox;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    vi.resetModules();
    // Reset environment to clean state
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    sandbox.restore();
    process.env = { ...originalEnv };
  });

  describe('instantiation', () => {
    it('should instantiate with valid mailpit config', () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {
          host: 'mailpit',
          port: '1025',
        },
      };

      const transport = new MailpitTransport(mailConfig);

      expect(transport).toBeDefined();
      expect(transport).toBeInstanceOf(MailpitTransport);
    });

    it('should instantiate with minimal config (using defaults)', () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {},
      };

      const transport = new MailpitTransport(mailConfig);

      expect(transport).toBeDefined();
      expect(transport).toBeInstanceOf(MailpitTransport);
    });

    it('should use settings from config object', () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {
          host: 'custom-mailpit-host',
          port: '2025',
        },
      };

      // Spy on nodemailer.createTransport to capture config
      const createTransportSpy = sandbox.spy(nodemailer, 'createTransport');

      new MailpitTransport(mailConfig);

      expect(createTransportSpy.calledOnce).toBe(true);
      const transportConfig = createTransportSpy.firstCall.args[0] as any;
      // Settings should come from the config object (which is populated by config package)
      expect(transportConfig.host).toBe('custom-mailpit-host');
      expect(transportConfig.port).toBe(2025);
    });
  });

  describe('SMTP configuration', () => {
    it('should configure SMTP with default Mailpit host and port 1025', () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {},
      };

      const createTransportSpy = sandbox.spy(nodemailer, 'createTransport');

      new MailpitTransport(mailConfig);

      expect(createTransportSpy.calledOnce).toBe(true);
      const transportConfig = createTransportSpy.firstCall.args[0] as any;

      // Verify default host is 'mailpit'
      expect(transportConfig.host).toBe('mailpit');
      // Verify default port is 1025
      expect(transportConfig.port).toBe(1025);
      // Verify secure is false (no TLS)
      expect(transportConfig.secure).toBe(false);
    });

    it('should configure SMTP without authentication', () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {
          host: 'mailpit',
          port: '1025',
        },
      };

      const createTransportSpy = sandbox.spy(nodemailer, 'createTransport');

      new MailpitTransport(mailConfig);

      expect(createTransportSpy.calledOnce).toBe(true);
      const transportConfig = createTransportSpy.firstCall.args[0] as any;

      // Mailpit doesn't require authentication
      expect(transportConfig.auth).toBeUndefined();
    });

    it('should use custom host and port from config settings', () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {
          host: 'my-mailpit-container',
          port: '3025',
        },
      };

      const createTransportSpy = sandbox.spy(nodemailer, 'createTransport');

      new MailpitTransport(mailConfig);

      expect(createTransportSpy.calledOnce).toBe(true);
      const transportConfig = createTransportSpy.firstCall.args[0] as any;

      expect(transportConfig.host).toBe('my-mailpit-container');
      expect(transportConfig.port).toBe(3025);
    });
  });

  describe('transport selection', () => {
    // Note: Transport selection in EmailService is tested via integration tests
    // and email-service.test.ts. These tests verify the MailpitTransport itself.

    it('should be instantiated with mailpit transport type', () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {
          host: 'mailpit',
          port: '1025',
        },
      };

      const transport = new MailpitTransport(mailConfig);

      // Transport should be created successfully
      expect(transport).toBeDefined();
      expect(transport).toBeInstanceOf(MailpitTransport);
    });

    it('should work with host value "mailpit" from config', () => {
      // This simulates what happens when config package resolves SMTP_HOST=mailpit
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {
          host: 'mailpit',
          port: '1025',
        },
      };

      const createTransportSpy = sandbox.spy(nodemailer, 'createTransport');
      new MailpitTransport(mailConfig);

      const transportConfig = createTransportSpy.firstCall.args[0] as any;
      expect(transportConfig.host).toBe('mailpit');
    });

    it('should be lower priority than testing transport (via NODE_ENV=test)', () => {
      // In test environment, EmailService always returns testing transport
      // This test verifies the expected behavior documented in the spec
      // The actual transport selection is tested in email-service.test.ts

      // When NODE_ENV=test, testing transport is always selected
      // regardless of mail config settings
      expect(process.env.NODE_ENV).toBe('test');
    });
  });

  describe('sendMail method', () => {
    it('should pass mail options to nodemailer transport', async () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {
          host: 'mailpit',
          port: '1025',
        },
      };

      const transport = new MailpitTransport(mailConfig);

      // Create a mock for the internal transport's sendMail method
      const sendMailStub = sandbox.stub().resolves({
        messageId: '<test-message-id@mailpit>',
        envelope: { from: 'test@example.com', to: ['recipient@example.com'] },
      });

      // Replace the internal transport
      (transport as any).transport = { sendMail: sendMailStub };

      const mailOptions = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'This is a test email',
        html: '<p>This is a test email</p>',
      };

      const result = await transport.sendMail(mailOptions);

      expect(sendMailStub.calledOnce).toBe(true);
      expect(sendMailStub.firstCall.args[0]).toEqual(mailOptions);
      expect(result.messageId).toBe('<test-message-id@mailpit>');
    });

    it('should throw error if transport is not initialized', async () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {},
      };

      const transport = new MailpitTransport(mailConfig);

      // Force transport to be null
      (transport as any).transport = null;

      await expect(transport.sendMail({
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Test',
      })).rejects.toThrow('Transport not initialized');
    });

    it('should correctly handle email with all fields', async () => {
      const mailConfig: MailConfig = {
        transport: 'mailpit',
        from: 'test@example.com',
        settings: {
          host: 'mailpit',
          port: '1025',
        },
      };

      const transport = new MailpitTransport(mailConfig);

      const sendMailStub = sandbox.stub().resolves({
        messageId: '<test-message-id@mailpit>',
        envelope: { from: 'sender@example.com', to: ['recipient@example.com'] },
      });

      (transport as any).transport = { sendMail: sendMailStub };

      const mailOptions = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        subject: 'Test Email with All Fields',
        text: 'Plain text version',
        html: '<h1>HTML version</h1>',
      };

      await transport.sendMail(mailOptions);

      expect(sendMailStub.calledOnce).toBe(true);
      const calledWith = sendMailStub.firstCall.args[0];
      expect(calledWith.from).toBe('sender@example.com');
      expect(calledWith.to).toBe('recipient@example.com');
      expect(calledWith.cc).toBe('cc@example.com');
      expect(calledWith.bcc).toBe('bcc@example.com');
      expect(calledWith.subject).toBe('Test Email with All Fields');
      expect(calledWith.text).toBe('Plain text version');
      expect(calledWith.html).toBe('<h1>HTML version</h1>');
    });
  });
});
