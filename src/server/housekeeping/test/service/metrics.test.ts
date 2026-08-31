import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';

import db from '@/server/common/entity/db';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import MetricsService, { MONITORED_QUEUES, FAILED_JOB_WINDOW_HOURS } from '@/server/housekeeping/service/metrics';

/**
 * Unit coverage for the metric collector's two absence causes and its failure
 * isolation. The rule under test: a family with no data and a family whose
 * source threw both yield null, and neither can take a sibling down with it.
 */
describe('MetricsService', () => {
  let sandbox: sinon.SinonSandbox;
  let configStub: sinon.SinonStub;

  /** Makes every source report "no data" so a test can enable one at a time. */
  function stubAllSourcesEmpty() {
    sandbox.stub(BackupEntity, 'findOne').resolves(null);
    sandbox.stub(DiskSnapshotService.prototype, 'getSnapshot').resolves(null);
    sandbox.stub(db, 'query').resolves([[], {}] as any);
    sandbox.stub(JobQueueService.prototype, 'getQueueStats').resolves([]);
    configStub.withArgs('media.storage.driver').returns('s3');
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Only the media keys are intercepted; everything else falls through to
    // the real configuration so the test does not have to restate it.
    const realGet = config.get.bind(config);
    configStub = sandbox.stub(config, 'get').callsFake((key: any) => realGet(key));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('omits every family when nothing has data yet', async () => {
    stubAllSourcesEmpty();

    const metrics = await new MetricsService().collect();

    expect(metrics.backup).toBeNull();
    expect(metrics.backupVolume).toBeNull();
    expect(metrics.databaseSizeBytes).toBeNull();
    expect(metrics.mediaVolume).toBeNull();
    // The queue query succeeded and found no rows, which is a real zero.
    expect(metrics.queues).toHaveLength(MONITORED_QUEUES.length);
    expect(metrics.queues!.every((queue) => queue.depth === 0 && queue.failedJobs === 0)).toBe(true);
  });

  it('reports the last verified backup as unix seconds and bytes', async () => {
    stubAllSourcesEmpty();
    (BackupEntity.findOne as sinon.SinonStub).resolves({
      created_at: new Date('2026-08-30T02:00:00.000Z'),
      size_bytes: '5242880',
    });

    const metrics = await new MetricsService().collect();

    expect(metrics.backup).toEqual({
      lastSuccessTimestampSeconds: Math.floor(Date.parse('2026-08-30T02:00:00.000Z') / 1000),
      lastSuccessSizeBytes: 5242880,
    });
  });

  it('reports backup-volume usage and the snapshot write time', async () => {
    stubAllSourcesEmpty();
    (DiskSnapshotService.prototype.getSnapshot as sinon.SinonStub).resolves({
      statKey: BACKUP_PATH_STAT_KEY,
      path: '/backups',
      totalBytes: 1000,
      freeBytes: 600,
      usedBytes: 400,
      percentageUsed: 40,
      writtenAt: new Date('2026-08-31T09:00:00.000Z'),
    });

    const metrics = await new MetricsService().collect();

    expect(metrics.backupVolume).toEqual({
      totalBytes: 1000,
      freeBytes: 600,
      usedBytes: 400,
      snapshotTimestampSeconds: Math.floor(Date.parse('2026-08-31T09:00:00.000Z') / 1000),
    });
  });

  it('omits media volume usage when media lives in object storage', async () => {
    stubAllSourcesEmpty();
    const statfs = sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage');

    const metrics = await new MetricsService().collect();

    expect(metrics.mediaVolume).toBeNull();
    // No local volume exists to measure, so nothing should be attempted.
    expect(statfs.called).toBe(false);
  });

  it('measures the media volume for local-storage deployments', async () => {
    stubAllSourcesEmpty();
    configStub.withArgs('media.storage.driver').returns('local');
    configStub.withArgs('media.storage.basePath').returns('/app/storage/media');
    const statfs = sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage').resolves({
      totalBytes: BigInt(500),
      usedBytes: BigInt(200),
      freeBytes: BigInt(300),
      percentageUsed: 40,
      path: '/app/storage/media',
    });

    const metrics = await new MetricsService().collect();

    expect(statfs.calledWith('/app/storage/media')).toBe(true);
    expect(metrics.mediaVolume).toEqual({ totalBytes: 500, freeBytes: 300, usedBytes: 200 });
  });

  it('omits only the failing family and leaves its siblings intact', async () => {
    stubAllSourcesEmpty();
    (BackupEntity.findOne as sinon.SinonStub).resolves({
      created_at: new Date('2026-08-30T02:00:00.000Z'),
      size_bytes: '10',
    });
    (DiskSnapshotService.prototype.getSnapshot as sinon.SinonStub).rejects(new Error('table missing'));
    (db.query as sinon.SinonStub).rejects(new Error('no such function: pg_database_size'));
    (JobQueueService.prototype.getQueueStats as sinon.SinonStub).rejects(new Error('connection refused'));

    const metrics = await new MetricsService().collect();

    expect(metrics.backupVolume).toBeNull();
    expect(metrics.databaseSizeBytes).toBeNull();
    expect(metrics.queues).toBeNull();
    // The one healthy source still reports.
    expect(metrics.backup?.lastSuccessSizeBytes).toBe(10);
  });

  it('counts failed jobs over a 24 hour window ending at the reference time', async () => {
    stubAllSourcesEmpty();
    const queueStats = JobQueueService.prototype.getQueueStats as sinon.SinonStub;
    const now = new Date('2026-08-31T12:00:00.000Z');

    await new MetricsService().collect(now);

    const [queueNames, failedSince] = queueStats.firstCall.args;
    expect(queueNames).toEqual([...MONITORED_QUEUES]);
    expect(FAILED_JOB_WINDOW_HOURS).toBe(24);
    expect(failedSince.toISOString()).toBe('2026-08-30T12:00:00.000Z');
  });
});
