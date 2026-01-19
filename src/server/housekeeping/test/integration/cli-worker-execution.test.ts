import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageService from '@/server/housekeeping/service/storage';
import BackupService from '@/server/housekeeping/service/backup';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import * as child_process from 'child_process';
import * as fs from 'fs';

// Mock modules
vi.mock('child_process');
vi.mock('fs');
vi.mock('@/server/housekeeping/entity/backup', () => ({
  BackupEntity: {
    create: vi.fn(),
    findAll: vi.fn(),
    findByPk: vi.fn(),
  },
}));

/**
 * CLI to Worker Execution Integration Test
 *
 * Tests that CLI commands correctly interact with services that workers would execute.
 *
 * Workflow: CLI Query/Command → Service Layer → Database/Filesystem → Result
 */
describe('CLI to Worker Execution Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock filesystem
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ size: 5000 } as any);
    vi.mocked(fs.statfsSync).mockReturnValue({
      blocks: 1000000,
      bfree: 500000,
      bsize: 4096,
    } as any);

    // Mock pg_dump
    vi.mocked(child_process.exec).mockImplementation((cmd, callback: any) => {
      callback(null, '', '');
      return {} as any;
    });

    // Mock database
    vi.mocked(BackupEntity.create).mockResolvedValue({
      id: 'backup-123',
      filename: 'test_backup.dump',
      size_bytes: 5000,
      created_at: new Date(),
      type: 'manual',
      category: 'daily',
      verified: true,
      storage_location: '/backups',
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute backup service layer that worker would call', async () => {
    const backupService = new BackupService();

    // Simulate worker executing backup (what would happen after CLI queues job)
    const backup = await backupService.createBackup('manual');

    // Verify backup execution
    expect(backup).toBeDefined();
    expect(backup.filename).toMatch(/^pavillion_\d{8}_\d{6}_manual\.dump$/);
    expect(backup.verified).toBe(true);

    // Verify database save
    expect(BackupEntity.create).toHaveBeenCalled();
  });

  it('should return backup list when CLI queries storage', async () => {
    const storageService = new StorageService();

    // Mock existing backups in database
    const mockBackups = [
      {
        id: 'backup-1',
        filename: 'pavillion_20260112_020000_scheduled.dump',
        size_bytes: 1024000,
        created_at: new Date('2026-01-12T02:00:00Z'),
        type: 'scheduled',
        category: 'daily',
        verified: true,
        storage_location: '/backups',
      },
      {
        id: 'backup-2',
        filename: 'pavillion_20260111_020000_scheduled.dump',
        size_bytes: 2048000,
        created_at: new Date('2026-01-11T02:00:00Z'),
        type: 'scheduled',
        category: 'weekly',
        verified: true,
        storage_location: '/backups',
      },
    ];

    vi.mocked(BackupEntity.findAll).mockResolvedValue(mockBackups as any);

    // CLI command: `pavillion backup list`
    const backups = await storageService.listBackups();

    // Verify CLI receives correct backup list
    expect(backups).toHaveLength(2);
    expect(backups[0].id).toBe('backup-1');
    expect(backups[0].type).toBe('scheduled');
    expect(backups[1].category).toBe('weekly');
  });

  it('should provide status information when CLI queries system', async () => {
    const storageService = new StorageService();

    // Mock backup statistics
    const mockBackups = Array.from({ length: 5 }, (_, i) => ({
      id: `backup-${i}`,
      filename: `backup_${i}.dump`,
      size_bytes: 1000000,
      created_at: new Date(),
      type: 'scheduled',
      category: 'daily',
      verified: true,
      storage_location: '/backups',
    }));

    vi.mocked(BackupEntity.findAll).mockResolvedValue(mockBackups as any);

    // CLI command: `pavillion backup status`
    const stats = await storageService.getStorageStats();

    // Verify CLI receives system status
    expect(stats.count).toBe(5);
    expect(stats.totalSize).toBe(5000000); // 5 backups × 1MB
    expect(stats.freeSpacePercent).toBeGreaterThan(0);
  });

  it('should retrieve backup details before restore operation', async () => {
    const storageService = new StorageService();

    const mockBackup = {
      id: 'restore-backup-123',
      filename: 'pavillion_20260112_140530_manual.dump',
      size_bytes: 1024000,
      created_at: new Date('2026-01-12T14:05:30Z'),
      type: 'manual',
      category: 'daily',
      verified: true,
      storage_location: '/backups',
    };

    vi.mocked(BackupEntity.findByPk).mockResolvedValue(mockBackup as any);

    // CLI command: `pavillion backup restore restore-backup-123`
    // Step 1: Retrieve backup details for confirmation prompt
    const backup = await storageService.getBackup('restore-backup-123');

    // Verify CLI can show backup details to user
    expect(backup).toBeDefined();
    expect(backup!.id).toBe('restore-backup-123');
    expect(backup!.verified).toBe(true);
    expect(backup!.filename).toContain('manual');
  });
});
