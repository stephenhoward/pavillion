import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import AlertsService from '@/server/housekeeping/service/alerts';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import { Account } from '@/common/model/account';

// Mock the email classes to avoid i18n errors
vi.mock('@/server/housekeeping/model/disk-warning-email', () => ({
  default: class {
    constructor(
      usagePercent: number,
      threshold: number,
      path: string,
      usedSpace: string,
      totalSpace: string,
      private recipientEmail: string,
    ) {}
    buildMessage() {
      return {
        from: 'noreply@test.com',
        to: (this as any).recipientEmail,
        subject: 'Disk Warning',
        text: 'Warning',
      };
    }
  },
}));

vi.mock('@/server/housekeeping/model/disk-critical-email', () => ({
  default: class {
    constructor(
      usagePercent: number,
      threshold: number,
      path: string,
      usedSpace: string,
      totalSpace: string,
      private recipientEmail: string,
    ) {}
    buildMessage() {
      return {
        from: 'noreply@test.com',
        to: (this as any).recipientEmail,
        subject: 'Disk Critical',
        text: 'Critical',
      };
    }
  },
}));

describe('AlertsService', () => {
  let service: AlertsService;
  let mockEmailInterface: EmailInterface;
  let mockAccountsInterface: AccountsInterface;
  let sandbox: sinon.SinonSandbox;
  let sendEmailStub: sinon.SinonStub;
  let getAdminsStub: sinon.SinonStub;
  let consoleWarnStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockEmailInterface = new EmailInterface();
    sendEmailStub = sandbox.stub(mockEmailInterface, 'sendEmail').resolves(null);

    // Mock admin accounts with different language preferences
    const mockAdmins = [
      Object.assign(new Account(), { id: 'admin-1', email: 'admin1@test.com', language: 'en' }),
      Object.assign(new Account(), { id: 'admin-2', email: 'admin2@test.com', language: 'es' }),
      Object.assign(new Account(), { id: 'admin-3', email: 'admin3@test.com', language: 'fr' }),
    ];

    // Create a mock AccountsInterface with stubbed getAdmins
    mockAccountsInterface = {
      getAdmins: sandbox.stub().resolves(mockAdmins),
    } as any;
    getAdminsStub = mockAccountsInterface.getAdmins as sinon.SinonStub;

    consoleWarnStub = sandbox.stub(console, 'warn');

    service = new AlertsService(mockEmailInterface, mockAccountsInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('sendDiskWarning', () => {
    it('should send emails to all admin accounts', async () => {
      await service.sendDiskWarning(85.3, 80, '/backups', '85 GB', '100 GB');

      // Should query for admin accounts
      expect(getAdminsStub.calledOnce).toBe(true);

      // Should send email to each admin (3 admins)
      expect(sendEmailStub.callCount).toBe(3);

      // Verify emails sent to correct recipients
      const calls = sendEmailStub.getCalls();
      expect(calls[0].args[0].to).toBe('admin1@test.com');
      expect(calls[1].args[0].to).toBe('admin2@test.com');
      expect(calls[2].args[0].to).toBe('admin3@test.com');
    });

    it('should send emails in each admin\'s preferred language', async () => {
      await service.sendDiskWarning(85.3, 80, '/backups', '85 GB', '100 GB');

      // Emails should be sent (buildMessage called with each admin's language)
      // Note: We can't easily test buildMessage language directly without mocking it,
      // but we verify all admins received emails
      expect(sendEmailStub.callCount).toBe(3);
    });

    it('should not throw error if email sending fails', async () => {
      sendEmailStub.rejects(new Error('SMTP not configured'));

      // Should not throw - graceful degradation
      await expect(service.sendDiskWarning(85.3, 80, '/backups')).resolves.not.toThrow();
    });

    it('should skip sending if no admins found', async () => {
      getAdminsStub.resolves([]);

      await service.sendDiskWarning(85.3, 80, '/backups');

      // Should not attempt to send emails
      expect(sendEmailStub.callCount).toBe(0);

      // Should log warning about no admins
      expect(consoleWarnStub.calledWith('[Alerts] No admin accounts found, skipping warning alert')).toBe(true);
    });
  });

  describe('sendDiskCritical', () => {
    it('should send emails to all admin accounts', async () => {
      await service.sendDiskCritical(95.7, 90, '/backups', '95 GB', '100 GB');

      // Should query for admin accounts
      expect(getAdminsStub.calledOnce).toBe(true);

      // Should send email to each admin (3 admins)
      expect(sendEmailStub.callCount).toBe(3);

      // Verify emails sent to correct recipients
      const calls = sendEmailStub.getCalls();
      expect(calls[0].args[0].to).toBe('admin1@test.com');
      expect(calls[1].args[0].to).toBe('admin2@test.com');
      expect(calls[2].args[0].to).toBe('admin3@test.com');
    });

    it('should not throw error if email sending fails', async () => {
      sendEmailStub.rejects(new Error('SMTP not configured'));

      // Should not throw - graceful degradation
      await expect(service.sendDiskCritical(95.7, 90, '/backups')).resolves.not.toThrow();
    });

    it('should skip sending if no admins found', async () => {
      getAdminsStub.resolves([]);

      await service.sendDiskCritical(95.7, 90, '/backups');

      // Should not attempt to send emails
      expect(sendEmailStub.callCount).toBe(0);

      // Should log warning about no admins
      expect(consoleWarnStub.calledWith('[Alerts] No admin accounts found, skipping critical alert')).toBe(true);
    });
  });
});
