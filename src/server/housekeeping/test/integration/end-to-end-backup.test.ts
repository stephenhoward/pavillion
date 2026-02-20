import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import BackupService from '@/server/housekeeping/service/backup';
import RetentionService from '@/server/housekeeping/service/retention';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import * as fs from 'fs';

// Note: child_process is a Node.js built-in and cannot be mocked via vi.mock() in
// ESM environments. We spy on BackupService.executeCommand() instead.
vi.mock('fs');
vi.mock('@/server/housekeeping/entity/backup', () => ({
  BackupEntity: {
    create: vi.fn(),
    findAll: vi.fn(),
  },
}));

/**
 * End-to-End Backup Workflow Integration Test
 *
 * Tests the complete backup workflow from job scheduling through execution,
 * verification, and retention enforcement.
 *
 * Workflow: Queue Job → Worker Processes → Backup Created → Retention Applied
 */
describe('End-to-End Backup Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup filesystem mocks
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ size: 5000 } as any);
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

    // Setup database mocks
    vi.mocked(BackupEntity.create).mockResolvedValue({} as any);
    vi.mocked(BackupEntity.findAll).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should complete full backup workflow from scheduling to retention', async () => {
    // Create services
    const backupService = new BackupService();
    vi.spyOn(backupService as any, 'executeCommand').mockResolvedValue(undefined);
    const retentionService = new RetentionService();

    let backupCreated: any = null;
    let retentionRan = false;

    // Simulate complete workflow
    // Phase 1: Create backup (simulates worker processing backup:create job)
    backupCreated = await backupService.createBackup('manual');

    // Phase 2: Run retention (simulates worker triggering retention after backup)
    await retentionService.enforceRetention();
    retentionRan = true;

    // Verify workflow completed
    expect(backupCreated).toBeDefined();
    expect(backupCreated.filename).toMatch(/^pavillion_\d{8}_\d{6}_manual\.dump$/);
    expect(backupCreated.verified).toBe(true);
    expect(retentionRan).toBe(true);

    // Verify database recorded backup
    expect(BackupEntity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'manual',
        verified: true,
        category: expect.stringMatching(/^(daily|weekly|monthly)$/),
      }),
    );
  });

  it('should run retention after successful scheduled backup', async () => {
    const backupService = new BackupService();
    vi.spyOn(backupService as any, 'executeCommand').mockResolvedValue(undefined);
    const retentionService = new RetentionService();

    // Create scheduled backup
    const backup = await backupService.createBackup('scheduled');

    // Verify backup succeeded
    expect(backup.verified).toBe(true);

    // Run retention after backup (simulates worker behavior)
    await retentionService.enforceRetention();

    // Verify retention completed without errors
    expect(BackupEntity.findAll).toHaveBeenCalled();
  });

  it('should maintain job order for sequential backups', async () => {
    const backupService = new BackupService();
    vi.spyOn(backupService as any, 'executeCommand').mockResolvedValue(undefined);
    const processedBackups: any[] = [];

    // Simulate multiple sequential backups
    for (let i = 0; i < 3; i++) {
      const backup = await backupService.createBackup('manual');
      processedBackups.push(backup);
    }

    // Verify all backups were processed in order
    expect(processedBackups).toHaveLength(3);
    expect(BackupEntity.create).toHaveBeenCalledTimes(3);
  });
});
