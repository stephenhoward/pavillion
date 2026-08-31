import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import db from '@/server/common/entity/db';
import { DiskUsageSnapshotEntity } from '@/server/housekeeping/entity/disk-snapshot';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import AlertsService from '@/server/housekeeping/service/alerts';
import IpCleanupService from '@/server/moderation/service/ip-cleanup';
import NotificationRetentionCleanupService from '@/server/notifications/service/retention-cleanup';
import BackupService from '@/server/housekeeping/service/backup';
import RetentionService from '@/server/housekeeping/service/retention';
import { JobHandler } from '@/server/housekeeping/service/job-queue';
import { registerJobHandlers } from '@/server/worker';

/**
 * Captures the handlers the worker registers so the disk:check job can be run
 * directly against a real database, without pg-boss.
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

describe('Worker disk snapshot write', () => {
  let sandbox: sinon.SinonSandbox;
  let queue: FakeJobQueueService;

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Other job handlers must be able to register without side effects.
    sandbox.stub(BackupService.prototype, 'createBackup').resolves({} as any);
    sandbox.stub(RetentionService.prototype, 'enforceRetention').resolves();
    sandbox.stub(AlertsService.prototype, 'sendDiskWarning').resolves();
    sandbox.stub(AlertsService.prototype, 'sendDiskCritical').resolves();
    sandbox.stub(IpCleanupService.prototype, 'cleanupExpiredIpData').resolves({ hashCleared: 0, subnetCleared: 0 });
    sandbox.stub(NotificationRetentionCleanupService.prototype, 'cleanupExpiredNotifications').resolves({
      recipientsDeleted: 0,
      activitiesDeleted: 0,
    });

    await DiskUsageSnapshotEntity.destroy({ where: {}, truncate: true });

    queue = new FakeJobQueueService();
    await registerJobHandlers(queue as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('persists the measured backup-volume usage when disk:check runs', async () => {
    sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage').resolves({
      totalBytes: BigInt(1000),
      usedBytes: BigInt(400),
      freeBytes: BigInt(600),
      percentageUsed: 40,
      path: '/backups',
    });

    await queue.handlers['disk:check']({}, undefined);

    const snapshot = await new DiskSnapshotService().getSnapshot(BACKUP_PATH_STAT_KEY);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.path).toBe('/backups');
    expect(snapshot!.totalBytes).toBe(1000);
    expect(snapshot!.usedBytes).toBe(400);
    expect(snapshot!.freeBytes).toBe(600);
    expect(snapshot!.percentageUsed).toBe(40);
    expect(snapshot!.writtenAt).toBeInstanceOf(Date);
  });

  it('overwrites the previous row rather than appending a second one', async () => {
    const checkStub = sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage');
    checkStub.onFirstCall().resolves({
      totalBytes: BigInt(1000), usedBytes: BigInt(400), freeBytes: BigInt(600), percentageUsed: 40, path: '/backups',
    });
    checkStub.onSecondCall().resolves({
      totalBytes: BigInt(1000), usedBytes: BigInt(700), freeBytes: BigInt(300), percentageUsed: 70, path: '/backups',
    });

    await queue.handlers['disk:check']({}, undefined);
    await queue.handlers['disk:check']({}, undefined);

    expect(await DiskUsageSnapshotEntity.count()).toBe(1);
    const snapshot = await new DiskSnapshotService().getSnapshot(BACKUP_PATH_STAT_KEY);
    expect(snapshot!.percentageUsed).toBe(70);
  });

  it('leaves no snapshot behind when the filesystem cannot be measured', async () => {
    sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage').rejects(new Error('ENOENT: /backups'));

    // The handler swallows the failure so hourly monitoring continues.
    await queue.handlers['disk:check']({}, undefined);

    expect(await new DiskSnapshotService().getSnapshot(BACKUP_PATH_STAT_KEY)).toBeNull();
  });
});
