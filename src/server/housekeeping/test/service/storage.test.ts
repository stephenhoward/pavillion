import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import StorageService from '@/server/housekeeping/service/storage';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import * as fs from 'fs';

// Mock modules
vi.mock('fs');
vi.mock('@/server/housekeeping/entity/backup');

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listBackups', () => {
    it('should return all backup metadata', async () => {
      const mockBackups = [
        {
          id: 'backup-1',
          filename: 'backup1.dump',
          size_bytes: 5000,
          created_at: new Date(),
          type: 'manual',
          category: 'daily',
          verified: true,
          storage_location: '/backups',
        },
        {
          id: 'backup-2',
          filename: 'backup2.dump',
          size_bytes: 10000,
          created_at: new Date(),
          type: 'scheduled',
          category: 'weekly',
          verified: true,
          storage_location: '/backups',
        },
      ];

      vi.mocked(BackupEntity.findAll).mockResolvedValue(mockBackups as any);

      const result = await service.listBackups();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('backup-1');
      expect(result[1].id).toBe('backup-2');
      expect(BackupEntity.findAll).toHaveBeenCalledWith({
        order: [['created_at', 'DESC']],
      });
    });

    it('should return empty array when no backups exist', async () => {
      vi.mocked(BackupEntity.findAll).mockResolvedValue([]);

      const result = await service.listBackups();

      expect(result).toHaveLength(0);
    });
  });

  describe('getBackup', () => {
    it('should return single backup details by ID', async () => {
      const mockBackup = {
        id: 'backup-1',
        filename: 'backup1.dump',
        size_bytes: 5000,
        created_at: new Date(),
        type: 'manual',
        category: 'daily',
        verified: true,
        storage_location: '/backups',
      };

      vi.mocked(BackupEntity.findByPk).mockResolvedValue(mockBackup as any);

      const result = await service.getBackup('backup-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('backup-1');
      expect(result?.filename).toBe('backup1.dump');
      expect(BackupEntity.findByPk).toHaveBeenCalledWith('backup-1');
    });

    it('should return null when backup not found', async () => {
      vi.mocked(BackupEntity.findByPk).mockResolvedValue(null);

      const result = await service.getBackup('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('deleteBackupFile', () => {
    it('should delete file from filesystem', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      await service.deleteBackupFile('/backups/test.dump');

      expect(fs.existsSync).toHaveBeenCalledWith('/backups/test.dump');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/backups/test.dump');
    });

    it('should handle missing file gracefully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Should not throw error
      await expect(service.deleteBackupFile('/backups/missing.dump')).resolves.not.toThrow();

      // Should not attempt to delete
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should throw error on filesystem failure', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.deleteBackupFile('/backups/test.dump')).rejects.toThrow('Permission denied');
    });
  });

  describe('getStorageStats', () => {
    it('should return total size, count, and free space', async () => {
      const mockBackups = [
        {
          id: 'backup-1',
          filename: 'backup1.dump',
          size_bytes: 5000,
          created_at: new Date(),
          type: 'manual',
          category: 'daily',
          verified: true,
          storage_location: '/backups',
        },
        {
          id: 'backup-2',
          filename: 'backup2.dump',
          size_bytes: 10000,
          created_at: new Date(),
          type: 'scheduled',
          category: 'weekly',
          verified: true,
          storage_location: '/backups',
        },
      ];

      vi.mocked(BackupEntity.findAll).mockResolvedValue(mockBackups as any);

      // Mock filesystem stats
      vi.mocked(fs.statfsSync).mockReturnValue({
        blocks: 1000000, // Total blocks
        bfree: 500000,   // Free blocks
        bsize: 4096,     // Block size (4KB)
      } as any);

      const stats = await service.getStorageStats();

      expect(stats.totalSize).toBe(15000); // 5000 + 10000
      expect(stats.count).toBe(2);
      expect(stats.freeSpace).toBeGreaterThan(0);
      expect(stats.totalSpace).toBeGreaterThan(0);
    });

    it('should handle empty backup list', async () => {
      vi.mocked(BackupEntity.findAll).mockResolvedValue([]);
      vi.mocked(fs.statfsSync).mockReturnValue({
        blocks: 1000000,
        bfree: 500000,
        bsize: 4096,
      } as any);

      const stats = await service.getStorageStats();

      expect(stats.totalSize).toBe(0);
      expect(stats.count).toBe(0);
      expect(stats.freeSpace).toBeGreaterThan(0);
    });

    it('should calculate free space percentage correctly', async () => {
      vi.mocked(BackupEntity.findAll).mockResolvedValue([]);
      vi.mocked(fs.statfsSync).mockReturnValue({
        blocks: 100,   // Total blocks
        bfree: 20,     // Free blocks (20% free)
        bsize: 1024,
      } as any);

      const stats = await service.getStorageStats();

      expect(stats.freeSpacePercent).toBeCloseTo(20, 1);
    });
  });
});
