import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import BackupService from '@/server/housekeeping/service/backup';
import RetentionService from '@/server/housekeeping/service/retention';
import AlertsService from '@/server/housekeeping/service/alerts';
import IpCleanupService from '@/server/moderation/service/ip-cleanup';
import NotificationService from '@/server/notifications/service/notification';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import { BackupCreateError } from '@/common/exceptions/housekeeping';
import { JobHandler, JobMeta } from '@/server/housekeeping/service/job-queue';
import { registerJobHandlers } from '@/server/worker';

/**
 * Captures handlers registered with `subscribe` and `schedule` so they can be
 * invoked directly with simulated retry metadata. Stands in for a real
 * `JobQueueService` but performs no I/O.
 */
class FakeJobQueueService {
  public handlers: Record<string, JobHandler<any>> = {};

  async subscribe<T>(jobName: string, handler: JobHandler<T>): Promise<void> {
    this.handlers[jobName] = handler;
  }

  async schedule<T>(jobName: string, _cron: string, handler: JobHandler<T>): Promise<void> {
    this.handlers[jobName] = handler;
  }
}

describe('Worker backup-job retry-storm alerting', () => {
  let sandbox: sinon.SinonSandbox;
  let createBackupStub: sinon.SinonStub;
  let enforceRetentionStub: sinon.SinonStub;
  let sendBackupFailedStub: sinon.SinonStub;
  let queue: FakeJobQueueService;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Stub BackupService.createBackup; tests will override the rejection per-call
    createBackupStub = sandbox.stub(BackupService.prototype, 'createBackup');

    // Retention should never be reached on the failure path, but stub it
    // defensively so the test does not accidentally hit the real DB if the
    // failure path ever changes.
    enforceRetentionStub = sandbox.stub(RetentionService.prototype, 'enforceRetention').resolves();

    // Track sendBackupFailed calls
    sendBackupFailedStub = sandbox.stub(AlertsService.prototype, 'sendBackupFailed').resolves();

    // Stub other handlers so registerJobHandlers can run without side effects
    sandbox.stub(IpCleanupService.prototype, 'cleanupExpiredIpData').resolves({ hashCleared: 0, subnetCleared: 0 });
    sandbox.stub(NotificationService.prototype, 'deleteOldNotifications').resolves();
    sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage').resolves({
      totalBytes: 1,
      usedBytes: 0,
      freeBytes: 1,
      percentageUsed: 0,
    });

    queue = new FakeJobQueueService();
    await registerJobHandlers(queue as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('backup:daily handler', () => {
    it('should dispatch sendBackupFailed exactly once across a 3-attempt retry storm and re-throw each time', async () => {
      const handler = queue.handlers['backup:daily'];
      expect(handler).toBeDefined();

      const failure = new BackupCreateError(
        'Failed to create backup file: pavillion-backup-2026-05-06_02-00-00.sql.gz',
        'pavillion-backup-2026-05-06_02-00-00.sql.gz',
        new Error('disk full'),
      );
      createBackupStub.rejects(failure);

      // Simulate three retry attempts: retryCount 0, 1, 2 with retryLimit 2
      const attempts: JobMeta[] = [
        { retryCount: 0, retryLimit: 2 },
        { retryCount: 1, retryLimit: 2 },
        { retryCount: 2, retryLimit: 2 },
      ];

      for (const meta of attempts) {
        await expect(handler({}, meta)).rejects.toBe(failure);
      }

      // Alert dispatched only on the final attempt
      expect(sendBackupFailedStub.callCount).toBe(1);

      const [backupType, filename, errorMessage, occurredAt] = sendBackupFailedStub.firstCall.args;
      expect(backupType).toBe('scheduled');
      expect(filename).toBe('pavillion-backup-2026-05-06_02-00-00.sql.gz');
      expect(errorMessage).toBe('disk full');
      expect(occurredAt).toBeInstanceOf(Date);

      // Retention is never reached on the failure path
      expect(enforceRetentionStub.callCount).toBe(0);
    });

    it('should not dispatch sendBackupFailed on non-final attempts (retryCount < retryLimit)', async () => {
      const handler = queue.handlers['backup:daily'];
      const failure = new BackupCreateError('boom', 'f.sql.gz', new Error('x'));
      createBackupStub.rejects(failure);

      await expect(handler({}, { retryCount: 0, retryLimit: 2 })).rejects.toBe(failure);
      await expect(handler({}, { retryCount: 1, retryLimit: 2 })).rejects.toBe(failure);

      expect(sendBackupFailedStub.callCount).toBe(0);
    });

    it('should use "unknown" filename and the error\'s own message when the failure is not a BackupCreateError', async () => {
      const handler = queue.handlers['backup:daily'];
      const failure = new Error('something else broke');
      createBackupStub.rejects(failure);

      await expect(handler({}, { retryCount: 2, retryLimit: 2 })).rejects.toBe(failure);

      expect(sendBackupFailedStub.callCount).toBe(1);
      const [, filename, errorMessage] = sendBackupFailedStub.firstCall.args;
      expect(filename).toBe('unknown');
      expect(errorMessage).toBe('something else broke');
    });
  });

  describe('backup:create handler', () => {
    it('should dispatch sendBackupFailed exactly once across a 3-attempt retry storm and re-throw each time', async () => {
      const handler = queue.handlers['backup:create'];
      expect(handler).toBeDefined();

      const failure = new BackupCreateError(
        'Failed to create backup file: pavillion-backup-manual.sql.gz',
        'pavillion-backup-manual.sql.gz',
        new Error('permission denied'),
      );
      createBackupStub.rejects(failure);

      const attempts: JobMeta[] = [
        { retryCount: 0, retryLimit: 2 },
        { retryCount: 1, retryLimit: 2 },
        { retryCount: 2, retryLimit: 2 },
      ];

      for (const meta of attempts) {
        await expect(handler({ type: 'manual' }, meta)).rejects.toBe(failure);
      }

      expect(sendBackupFailedStub.callCount).toBe(1);

      const [backupType, filename, errorMessage, occurredAt] = sendBackupFailedStub.firstCall.args;
      expect(backupType).toBe('manual');
      expect(filename).toBe('pavillion-backup-manual.sql.gz');
      expect(errorMessage).toBe('permission denied');
      expect(occurredAt).toBeInstanceOf(Date);
    });

    it('should forward data.type as the backupType when set to "scheduled"', async () => {
      const handler = queue.handlers['backup:create'];
      const failure = new BackupCreateError('boom', 'f.sql.gz', new Error('x'));
      createBackupStub.rejects(failure);

      await expect(handler({ type: 'scheduled' }, { retryCount: 2, retryLimit: 2 })).rejects.toBe(failure);

      expect(sendBackupFailedStub.callCount).toBe(1);
      expect(sendBackupFailedStub.firstCall.args[0]).toBe('scheduled');
    });

    it('should not dispatch sendBackupFailed on non-final attempts (retryCount < retryLimit)', async () => {
      const handler = queue.handlers['backup:create'];
      const failure = new BackupCreateError('boom', 'f.sql.gz', new Error('x'));
      createBackupStub.rejects(failure);

      await expect(handler({ type: 'manual' }, { retryCount: 0, retryLimit: 2 })).rejects.toBe(failure);
      await expect(handler({ type: 'manual' }, { retryCount: 1, retryLimit: 2 })).rejects.toBe(failure);

      expect(sendBackupFailedStub.callCount).toBe(0);
    });
  });
});
