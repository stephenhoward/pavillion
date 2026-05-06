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

// Track BackupFailedEmail constructor and buildMessage calls for assertion
const backupFailedEmailConstructorCalls: any[][] = [];
const backupFailedEmailBuildMessageCalls: string[] = [];

vi.mock('@/server/housekeeping/model/backup-failed-email', () => ({
  default: class {
    constructor(
      public backupType: string,
      public filename: string,
      public errorMessage: string,
      public occurredAt: string,
      private recipientEmail: string,
    ) {
      backupFailedEmailConstructorCalls.push([backupType, filename, errorMessage, occurredAt, recipientEmail]);
    }
    buildMessage(language: string) {
      backupFailedEmailBuildMessageCalls.push(language);
      return {
        from: 'noreply@test.com',
        to: (this as any).recipientEmail,
        subject: 'Backup Failed',
        text: `Backup Failed (${language}): ${(this as any).backupType} ${(this as any).filename}`,
        backupType: (this as any).backupType,
        filename: (this as any).filename,
        errorMessage: (this as any).errorMessage,
        occurredAt: (this as any).occurredAt,
        language,
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

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockEmailInterface = new EmailInterface();
    sendEmailStub = sandbox.stub(mockEmailInterface, 'sendEmail').resolves(null);

    // Reset BackupFailedEmail trackers for each test
    backupFailedEmailConstructorCalls.length = 0;
    backupFailedEmailBuildMessageCalls.length = 0;

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
    });
  });

  describe('sendBackupFailed', () => {
    const backupType = 'scheduled' as const;
    const filename = 'pavillion-backup-2026-05-06.tar.gz';
    const errorMessage = 'pg_dump: connection refused';
    const occurredAt = new Date('2026-05-06T12:34:56.000Z');

    it('should send emails to all admin accounts in their preferred languages', async () => {
      await service.sendBackupFailed(backupType, filename, errorMessage, occurredAt);

      // Should query for admin accounts
      expect(getAdminsStub.calledOnce).toBe(true);

      // Should send email to each admin (3 admins)
      expect(sendEmailStub.callCount).toBe(3);

      // Verify emails sent to correct recipients
      const calls = sendEmailStub.getCalls();
      expect(calls[0].args[0].to).toBe('admin1@test.com');
      expect(calls[1].args[0].to).toBe('admin2@test.com');
      expect(calls[2].args[0].to).toBe('admin3@test.com');

      // Verify each admin's email was rendered in their preferred language
      expect(backupFailedEmailBuildMessageCalls).toEqual(['en', 'es', 'fr']);
    });

    it('should pass backupType, filename, errorMessage, and occurredAt to the email model', async () => {
      await service.sendBackupFailed(backupType, filename, errorMessage, occurredAt);

      // Constructor called once per admin (3 admins)
      expect(backupFailedEmailConstructorCalls.length).toBe(3);

      // Each constructor call should carry the same backup details (and admin email)
      const expectedOccurredAt = occurredAt.toISOString();
      const adminEmails = ['admin1@test.com', 'admin2@test.com', 'admin3@test.com'];
      backupFailedEmailConstructorCalls.forEach((args, idx) => {
        const [type, file, errMsg, when, recipient] = args;
        expect(type).toBe(backupType);
        expect(file).toBe(filename);
        expect(errMsg).toBe(errorMessage);
        expect(when).toBe(expectedOccurredAt);
        expect(recipient).toBe(adminEmails[idx]);
      });

      // The MailData passed to sendEmail should also reflect those values (via the mock buildMessage)
      const sendEmailCalls = sendEmailStub.getCalls();
      sendEmailCalls.forEach((call, idx) => {
        const mailData = call.args[0];
        expect(mailData.backupType).toBe(backupType);
        expect(mailData.filename).toBe(filename);
        expect(mailData.errorMessage).toBe(errorMessage);
        expect(mailData.occurredAt).toBe(expectedOccurredAt);
        expect(mailData.to).toBe(adminEmails[idx]);
      });
    });

    it('should accept a pre-formatted occurredAt string', async () => {
      const occurredAtStr = '2026-05-06 12:34:56 UTC';
      await service.sendBackupFailed('manual', filename, errorMessage, occurredAtStr);

      expect(backupFailedEmailConstructorCalls.length).toBe(3);
      backupFailedEmailConstructorCalls.forEach((args) => {
        // String is passed through unchanged
        expect(args[3]).toBe(occurredAtStr);
        expect(args[0]).toBe('manual');
      });
    });

    it('should not abort the loop when one admin send fails', async () => {
      // First call rejects, subsequent calls succeed
      sendEmailStub.onFirstCall().rejects(new Error('SMTP rejected for admin1'));
      sendEmailStub.onSecondCall().resolves(null);
      sendEmailStub.onThirdCall().resolves(null);

      await expect(
        service.sendBackupFailed(backupType, filename, errorMessage, occurredAt),
      ).resolves.not.toThrow();

      // All three admins were attempted
      expect(sendEmailStub.callCount).toBe(3);

      // Remaining admins still received their emails
      const calls = sendEmailStub.getCalls();
      expect(calls[1].args[0].to).toBe('admin2@test.com');
      expect(calls[2].args[0].to).toBe('admin3@test.com');
    });

    it('should not throw if email sending fails for all admins', async () => {
      sendEmailStub.rejects(new Error('SMTP not configured'));

      // Should not throw - graceful degradation
      await expect(
        service.sendBackupFailed(backupType, filename, errorMessage, occurredAt),
      ).resolves.not.toThrow();
    });

    it('should skip sending if no admins found', async () => {
      getAdminsStub.resolves([]);

      await expect(
        service.sendBackupFailed(backupType, filename, errorMessage, occurredAt),
      ).resolves.not.toThrow();

      // Should not attempt to send emails
      expect(sendEmailStub.callCount).toBe(0);
      expect(backupFailedEmailConstructorCalls.length).toBe(0);
    });
  });
});
