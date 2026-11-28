import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import { Account } from '@/common/model/account';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import { DiskUsageStats } from '@/server/housekeeping/service/disk-monitor';

/**
 * The logger module is mocked wholesale because pino is silent under test;
 * recording the calls is the only way to assert what the alert flow writes,
 * and that it never writes an address, a raw error or an error message.
 */
const { logCalls, renderFailure } = vi.hoisted(() => ({
  logCalls: [] as unknown[][],
  renderFailure: { error: null as Error | null },
}));

vi.mock('@/server/common/helper/logger', () => {
  const record = (level: string) => (...args: unknown[]) => { logCalls.push([level, ...args]); };
  const stub: Record<string, unknown> = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    level: 'silent',
  };
  stub.child = () => stub;
  return { createLogger: () => stub, default: stub };
});

import AlertsService from '@/server/housekeeping/service/alerts';

// The email classes are mocked so these tests need no i18n setup; the real
// templates are rendered by integration/disk-alert-render.test.ts.
vi.mock('@/server/housekeeping/model/disk-warning-email', () => ({
  default: class {
    constructor(
      usagePercent: number,
      threshold: number,
      usedSpace: string,
      totalSpace: string,
      private recipientEmail: string,
    ) {}
    buildMessage() {
      if (renderFailure.error) {
        throw renderFailure.error;
      }
      return {
        from: 'noreply@example.test',
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
      usedSpace: string,
      totalSpace: string,
      private recipientEmail: string,
    ) {}
    buildMessage() {
      if (renderFailure.error) {
        throw renderFailure.error;
      }
      return {
        from: 'noreply@example.test',
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
        from: 'noreply@example.test',
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

    logCalls.length = 0;
    renderFailure.error = null;

    // Reset BackupFailedEmail trackers for each test
    backupFailedEmailConstructorCalls.length = 0;
    backupFailedEmailBuildMessageCalls.length = 0;

    // Mock admin accounts with different language preferences
    const mockAdmins = [
      Object.assign(new Account(), { id: 'admin-1', email: 'admin1@example.test', language: 'en' }),
      Object.assign(new Account(), { id: 'admin-2', email: 'admin2@example.test', language: 'es' }),
      Object.assign(new Account(), { id: 'admin-3', email: 'admin3@example.test', language: 'fr' }),
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
    it('sends one message to each administrator and returns how many were reached', async () => {
      const reached = await service.sendDiskWarning(85.3, 80, '85 GB', '100 GB');

      expect(reached).toBe(3);
      expect(getAdminsStub.calledOnce).toBe(true);
      expect(sendEmailStub.getCalls().map(call => call.args[0].to)).toEqual([
        'admin1@example.test',
        'admin2@example.test',
        'admin3@example.test',
      ]);
    });

    it('counts only the administrators actually reached', async () => {
      sendEmailStub.onSecondCall().rejects(new Error('SMTP rejected'));

      expect(await service.sendDiskWarning(85.3, 80)).toBe(2);
      expect(sendEmailStub.callCount).toBe(3);
      expect(logCalls.filter(([level]) => level === 'warn').map(call => call[1])).toContainEqual(
        { alertLevel: 'warning', failed: 1, attempted: 3 },
      );
    });

    it('returns 0 without throwing when every send fails', async () => {
      sendEmailStub.rejects(new Error('SMTP not configured'));

      expect(await service.sendDiskWarning(85.3, 80)).toBe(0);
    });

    it('returns 0 and sends nothing when there are no administrators', async () => {
      getAdminsStub.resolves([]);

      expect(await service.sendDiskWarning(85.3, 80)).toBe(0);
      expect(sendEmailStub.callCount).toBe(0);
    });
  });

  describe('sendDiskCritical', () => {
    it('sends one message to each administrator and returns how many were reached', async () => {
      const reached = await service.sendDiskCritical(95.7, 90, '95 GB', '100 GB');

      expect(reached).toBe(3);
      expect(sendEmailStub.getCalls().map(call => call.args[0].to)).toEqual([
        'admin1@example.test',
        'admin2@example.test',
        'admin3@example.test',
      ]);
    });

    it('returns 0 without throwing when every send fails', async () => {
      sendEmailStub.rejects(new Error('SMTP not configured'));

      expect(await service.sendDiskCritical(95.7, 90)).toBe(0);
    });

    it('logs one error naming exactly the level, usage and attempted count when no administrator is reached', async () => {
      sendEmailStub.rejects(new Error('SMTP not configured'));

      await service.sendDiskCritical(95.7, 90);

      const errors = logCalls.filter(([level]) => level === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0][1]).toEqual({ alertLevel: 'critical', percentageUsed: 95.7, attempted: 3 });
    });

    it('logs the none-reached error with an attempted count of 0 when there are no administrators', async () => {
      getAdminsStub.resolves([]);

      await service.sendDiskCritical(95.7, 90);

      const errors = logCalls.filter(([level]) => level === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0][1]).toEqual({ alertLevel: 'critical', percentageUsed: 95.7, attempted: 0 });
    });
  });

  describe('processDiskReading', () => {
    const THRESHOLDS = { warning: 80, critical: 90 };
    const NOW = new Date('2026-11-20T12:00:00.000Z');
    let getAlertStateStub: sinon.SinonStub;
    let setAlertStateStub: sinon.SinonStub;

    function reading(percentageUsed: number): DiskUsageStats {
      return {
        totalBytes: BigInt(1000),
        usedBytes: BigInt(Math.round(percentageUsed * 10)),
        freeBytes: BigInt(1000 - Math.round(percentageUsed * 10)),
        percentageUsed,
        path: '/backups',
      };
    }

    beforeEach(() => {
      const snapshots = new DiskSnapshotService();
      getAlertStateStub = sandbox.stub(snapshots, 'getAlertState').resolves({ level: null, sentAt: null });
      setAlertStateStub = sandbox.stub(snapshots, 'setAlertState').resolves();
      service = new AlertsService(mockEmailInterface, mockAccountsInterface, snapshots);
    });

    it('sends the critical alert and records the level with the reading time', async () => {
      await service.processDiskReading(reading(95), THRESHOLDS, NOW);

      expect(sendEmailStub.callCount).toBe(3);
      expect(sendEmailStub.firstCall.args[0].subject).toBe('Disk Critical');
      expect(setAlertStateStub.calledOnceWithExactly(BACKUP_PATH_STAT_KEY, 'critical', NOW)).toBe(true);
    });

    it('records no state when no administrator is reached, so the next run retries', async () => {
      sendEmailStub.rejects(new Error('SMTP not configured'));

      await service.processDiskReading(reading(85), THRESHOLDS, NOW);

      expect(setAlertStateStub.called).toBe(false);
    });

    it('sends nothing while the stored level was alerted within 24 hours', async () => {
      getAlertStateStub.resolves({ level: 'warning', sentAt: new Date(NOW.getTime() - 60 * 60 * 1000) });

      await service.processDiskReading(reading(85), THRESHOLDS, NOW);

      expect(sendEmailStub.called).toBe(false);
      expect(setAlertStateStub.called).toBe(false);
    });

    it('clears stored state on a normal reading without sending', async () => {
      getAlertStateStub.resolves({ level: 'critical', sentAt: NOW });

      await service.processDiskReading(reading(50), THRESHOLDS, NOW);

      expect(sendEmailStub.called).toBe(false);
      expect(setAlertStateStub.calledOnceWithExactly(BACKUP_PATH_STAT_KEY, null, null)).toBe(true);
    });

    it('resolves after a failed state write, logging one error', async () => {
      setAlertStateStub.rejects(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }));

      await expect(service.processDiskReading(reading(95), THRESHOLDS, NOW)).resolves.toBeUndefined();

      const errors = logCalls.filter(([level]) => level === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0][1]).toEqual({ error: { name: 'Error', code: 'SQLITE_BUSY' } });
    });
  });

  /**
   * Every catch in the disk alert flow logs the error's class and code only.
   * Each failure below carries a fixture address and a unique sentinel in its
   * message and in nested fields; neither may reach any logger call, at any
   * level, and no raw error object may be logged.
   */
  describe('disk alert log hygiene', () => {
    const SENTINEL = 'SENTINEL-7f3a9c';
    const ADDRESS = 'admin1@example.test';
    const THRESHOLDS = { warning: 80, critical: 90 };
    const NOW = new Date('2026-11-20T12:00:00.000Z');

    function leakyError(code: string): Error {
      return Object.assign(new Error(`550 mailbox ${ADDRESS} rejected ${SENTINEL}`), {
        code,
        responseCode: 550,
        response: `550 5.1.1 <${ADDRESS}> ${SENTINEL}`,
        rejected: [ADDRESS],
        envelope: { to: [ADDRESS] },
      });
    }

    /** Serialises every logger argument, including errors' non-enumerable fields. */
    function serialisedLogs(): string {
      return JSON.stringify(logCalls, (_key, value) => {
        if (value instanceof Error) {
          return { ...value, name: value.name, message: value.message, stack: value.stack };
        }
        return typeof value === 'bigint' ? value.toString() : value;
      });
    }

    function containsError(value: unknown): boolean {
      if (value instanceof Error) {
        return true;
      }
      if (value && typeof value === 'object') {
        return Object.values(value).some(containsError);
      }
      return false;
    }

    function expectCleanLogs(): void {
      expect(logCalls.length).toBeGreaterThan(0);
      const text = serialisedLogs();
      expect(text).not.toContain(ADDRESS);
      expect(text).not.toContain('@example.test');
      expect(text).not.toContain(SENTINEL);
      expect(logCalls.some(call => call.some(containsError))).toBe(false);
    }

    function reading(percentageUsed: number): DiskUsageStats {
      return { totalBytes: BigInt(1000), usedBytes: BigInt(950), freeBytes: BigInt(50), percentageUsed, path: '/backups' };
    }

    it('a per-recipient transport error is logged by name and code only', async () => {
      sendEmailStub.rejects(leakyError('EENVELOPE'));

      await service.sendDiskCritical(95, 90);

      expectCleanLogs();
      const warnings = logCalls.filter(([level]) => level === 'warn');
      expect(warnings.map(call => call[1])).toContainEqual({ error: { name: 'Error', code: 'EENVELOPE' } });
    });

    it('a per-recipient template render error is logged by name and code only', async () => {
      renderFailure.error = leakyError('ERENDER');

      await service.sendDiskWarning(85, 80);

      expectCleanLogs();
      const warnings = logCalls.filter(([level]) => level === 'warn');
      expect(warnings.map(call => call[1])).toContainEqual({ error: { name: 'Error', code: 'ERENDER' } });
    });

    it('a failed administrator lookup is logged by name and code only', async () => {
      getAdminsStub.rejects(leakyError('ECONNREFUSED'));

      expect(await service.sendDiskCritical(95, 90)).toBe(0);

      expectCleanLogs();
      expect(logCalls.filter(([level]) => level === 'error').map(call => call[1])).toContainEqual(
        { error: { name: 'Error', code: 'ECONNREFUSED' } },
      );
    });

    it('a failed state read or write is logged by name and code only', async () => {
      const snapshots = new DiskSnapshotService();
      sandbox.stub(snapshots, 'getAlertState').rejects(leakyError('SQLITE_BUSY'));
      sandbox.stub(snapshots, 'setAlertState').rejects(leakyError('SQLITE_BUSY'));
      service = new AlertsService(mockEmailInterface, mockAccountsInterface, snapshots);

      await expect(service.processDiskReading(reading(95), THRESHOLDS, NOW)).resolves.toBeUndefined();

      expectCleanLogs();
    });

    describe('backup failed alert', () => {
      const send = () => service.sendBackupFailed('scheduled', 'backup.tar.gz', 'disk full', NOW);

      it('a per-recipient transport error is logged by name and code only', async () => {
        sendEmailStub.rejects(leakyError('EENVELOPE'));

        await send();

        expectCleanLogs();
        const warnings = logCalls.filter(([level]) => level === 'warn');
        expect(warnings.map(call => call[1])).toContainEqual({ error: { name: 'Error', code: 'EENVELOPE' } });
      });

      it('a failed administrator lookup is logged by name and code only', async () => {
        getAdminsStub.rejects(leakyError('ECONNREFUSED'));

        await expect(send()).resolves.toBeUndefined();

        expectCleanLogs();
        const warnings = logCalls.filter(([level]) => level === 'warn');
        expect(warnings.map(call => call[1])).toContainEqual({ error: { name: 'Error', code: 'ECONNREFUSED' } });
      });
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
      expect(calls[0].args[0].to).toBe('admin1@example.test');
      expect(calls[1].args[0].to).toBe('admin2@example.test');
      expect(calls[2].args[0].to).toBe('admin3@example.test');

      // Verify each admin's email was rendered in their preferred language
      expect(backupFailedEmailBuildMessageCalls).toEqual(['en', 'es', 'fr']);
    });

    it('should pass backupType, filename, errorMessage, and occurredAt to the email model', async () => {
      await service.sendBackupFailed(backupType, filename, errorMessage, occurredAt);

      // Constructor called once per admin (3 admins)
      expect(backupFailedEmailConstructorCalls.length).toBe(3);

      // Each constructor call should carry the same backup details (and admin email)
      const expectedOccurredAt = occurredAt.toISOString();
      const adminEmails = ['admin1@example.test', 'admin2@example.test', 'admin3@example.test'];
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
      expect(calls[1].args[0].to).toBe('admin2@example.test');
      expect(calls[2].args[0].to).toBe('admin3@example.test');
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
