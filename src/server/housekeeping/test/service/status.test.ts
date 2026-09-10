import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import config from 'config';
import StatusService from '@/server/housekeeping/service/status';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

vi.mock('@/server/housekeeping/entity/backup');

// Disk usage reaches the dashboard through the worker-written snapshot, not
// through a statfs in this process: the app container does not mount the
// backup volume.
const healthySnapshot = {
  statKey: BACKUP_PATH_STAT_KEY,
  path: '/backups',
  totalBytes: 100000000000,
  usedBytes: 50000000000,
  freeBytes: 50000000000,
  percentageUsed: 50.0,
  writtenAt: new Date('2026-01-13T03:00:00.000Z'),
};

describe('StatusService', () => {
  let service: StatusService;

  beforeEach(() => {
    service = new StatusService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('assembles backup, disk, alert, and retention sections', async () => {
    vi.mocked(BackupEntity.findOne).mockResolvedValue({
      created_at: new Date('2026-01-13T02:00:00.000Z'),
      size_bytes: 1024000,
      type: 'scheduled',
    } as any);
    vi.mocked(BackupEntity.count).mockResolvedValue(3);
    vi.spyOn(DiskSnapshotService.prototype, 'getSnapshot').mockResolvedValue(healthySnapshot);

    const status = await service.getStatus();

    expect(status.lastBackup).toEqual({
      date: '2026-01-13T02:00:00.000Z',
      size: 1024000,
      type: 'scheduled',
    });
    expect(status.diskUsage).toEqual({
      percentageUsed: 50.0,
      totalBytes: '100000000000',
      freeBytes: '50000000000',
    });
    expect(status.alerts).toEqual(['ok']);
    expect(status.retentionStats.daily).toEqual({
      current: 3,
      target: config.get<number>('housekeeping.backup.retention.daily'),
    });
    // Schedule is "0 2 * * *", so the next backup is the next 02:00 boundary.
    expect(status.nextBackup).not.toBeNull();
    expect(status.nextBackup).toMatch(/T02:00:00/);
  });

  it('reports a null disk usage and an ok alert before the worker writes a snapshot', async () => {
    vi.mocked(BackupEntity.findOne).mockResolvedValue(null);
    vi.mocked(BackupEntity.count).mockResolvedValue(0);
    vi.spyOn(DiskSnapshotService.prototype, 'getSnapshot').mockResolvedValue(null);

    const status = await service.getStatus();

    expect(status.diskUsage).toBeNull();
    expect(status.alerts).toEqual(['ok']);
    expect(status.retentionStats.weekly.current).toBe(0);
  });

  it('reports a null last backup when the backup lookup fails', async () => {
    vi.mocked(BackupEntity.findOne).mockRejectedValue(new Error('connection refused'));
    vi.mocked(BackupEntity.count).mockResolvedValue(0);
    vi.spyOn(DiskSnapshotService.prototype, 'getSnapshot').mockResolvedValue(healthySnapshot);

    const status = await service.getStatus();

    expect(status.lastBackup).toBeNull();
    expect(status.diskUsage).not.toBeNull();
  });

  it('falls back to zeroed retention counts when the count query fails', async () => {
    vi.mocked(BackupEntity.findOne).mockResolvedValue(null);
    vi.mocked(BackupEntity.count).mockRejectedValue(new Error('connection refused'));
    vi.spyOn(DiskSnapshotService.prototype, 'getSnapshot').mockResolvedValue(healthySnapshot);

    const status = await service.getStatus();

    expect(status.retentionStats).toEqual({
      daily: { current: 0, target: config.get<number>('housekeeping.backup.retention.daily') },
      weekly: { current: 0, target: config.get<number>('housekeeping.backup.retention.weekly') },
      monthly: { current: 0, target: config.get<number>('housekeeping.backup.retention.monthly') },
    });
  });

  it('raises a critical alert when disk usage passes the critical threshold', async () => {
    vi.mocked(BackupEntity.findOne).mockResolvedValue(null);
    vi.mocked(BackupEntity.count).mockResolvedValue(0);
    vi.spyOn(DiskSnapshotService.prototype, 'getSnapshot').mockResolvedValue({
      ...healthySnapshot,
      usedBytes: 92000000000,
      freeBytes: 8000000000,
      percentageUsed: 92.0,
    });

    const status = await service.getStatus();

    expect(status.alerts).toEqual(['critical']);
  });
});
