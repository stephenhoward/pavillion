import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import config from 'config';
import StatusService from '@/server/housekeeping/service/status';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

vi.mock('@/server/housekeeping/entity/backup');

const healthyDiskUsage = {
  totalBytes: BigInt(100000000000),
  usedBytes: BigInt(50000000000),
  freeBytes: BigInt(50000000000),
  percentageUsed: 50.0,
  path: '/backups',
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
    vi.spyOn(DiskMonitorService.prototype, 'checkDiskUsage').mockResolvedValue(healthyDiskUsage);

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

  it('reports a null disk usage and an ok alert when the backup path is unreadable', async () => {
    vi.mocked(BackupEntity.findOne).mockResolvedValue(null);
    vi.mocked(BackupEntity.count).mockResolvedValue(0);
    vi.spyOn(DiskMonitorService.prototype, 'checkDiskUsage')
      .mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const status = await service.getStatus();

    expect(status.diskUsage).toBeNull();
    expect(status.alerts).toEqual(['ok']);
    expect(status.retentionStats.weekly.current).toBe(0);
  });

  it('reports a null last backup when the backup lookup fails', async () => {
    vi.mocked(BackupEntity.findOne).mockRejectedValue(new Error('connection refused'));
    vi.mocked(BackupEntity.count).mockResolvedValue(0);
    vi.spyOn(DiskMonitorService.prototype, 'checkDiskUsage').mockResolvedValue(healthyDiskUsage);

    const status = await service.getStatus();

    expect(status.lastBackup).toBeNull();
    expect(status.diskUsage).not.toBeNull();
  });

  it('falls back to zeroed retention counts when the count query fails', async () => {
    vi.mocked(BackupEntity.findOne).mockResolvedValue(null);
    vi.mocked(BackupEntity.count).mockRejectedValue(new Error('connection refused'));
    vi.spyOn(DiskMonitorService.prototype, 'checkDiskUsage').mockResolvedValue(healthyDiskUsage);

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
    vi.spyOn(DiskMonitorService.prototype, 'checkDiskUsage').mockResolvedValue({
      ...healthyDiskUsage,
      usedBytes: BigInt(92000000000),
      freeBytes: BigInt(8000000000),
      percentageUsed: 92.0,
    });

    const status = await service.getStatus();

    expect(status.alerts).toEqual(['critical']);
  });
});
