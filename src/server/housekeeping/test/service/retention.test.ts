import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import RetentionService from '@/server/housekeeping/service/retention';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import * as fs from 'fs';
import config from 'config';

// Mock modules
vi.mock('fs');
vi.mock('@/server/housekeeping/entity/backup');

describe('RetentionService', () => {
  let service: RetentionService;

  beforeEach(() => {
    service = new RetentionService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('enforceRetention', () => {
    it('should keep only 7 most recent daily backups', async () => {
      // Create 10 daily backups
      const dailyBackups = Array.from({ length: 10 }, (_, i) => {
        const date = DateTime.now().minus({ days: i });
        return {
          id: `daily-${i}`,
          filename: `pavillion_${date.toFormat('yyyyMMdd_HHmmss')}_scheduled.dump`,
          size_bytes: 5000,
          created_at: date.toJSDate(),
          type: 'scheduled' as const,
          category: 'daily' as const,
          verified: true,
          storage_location: '/backups',
          destroy: vi.fn(),
          update: vi.fn(),
        };
      });

      // Mock BackupEntity.findAll to return appropriate data based on category
      vi.mocked(BackupEntity.findAll).mockImplementation((options: any) => {
        if (options.where.category === 'daily') {
          return Promise.resolve(dailyBackups as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      await service.enforceRetention();

      // Verify that 3 oldest backups were deleted (indices 7, 8, 9)
      expect(fs.unlinkSync).toHaveBeenCalledTimes(3);

      // Verify the update method was called for deleted backups
      expect(dailyBackups[7].update).toHaveBeenCalled();
      expect(dailyBackups[8].update).toHaveBeenCalled();
      expect(dailyBackups[9].update).toHaveBeenCalled();

      // Verify newest 7 were not deleted (indices 0-6)
      expect(dailyBackups[0].update).not.toHaveBeenCalled();
      expect(dailyBackups[6].update).not.toHaveBeenCalled();
    });

    it('should keep only 4 most recent weekly backups', async () => {
      // Create 6 weekly backups (Sundays)
      const weeklyBackups = Array.from({ length: 6 }, (_, i) => {
        // Start from a Sunday and go back in weeks
        let sunday = DateTime.now();
        while (sunday.weekday !== 7) {
          sunday = sunday.plus({ days: 1 });
        }
        // Make sure it's not the 1st to avoid monthly categorization
        if (sunday.day === 1) {
          sunday = sunday.plus({ days: 7 });
        }

        const date = sunday.minus({ weeks: i });
        return {
          id: `weekly-${i}`,
          filename: `pavillion_${date.toFormat('yyyyMMdd_HHmmss')}_scheduled.dump`,
          size_bytes: 5000,
          created_at: date.toJSDate(),
          type: 'scheduled' as const,
          category: 'weekly' as const,
          verified: true,
          storage_location: '/backups',
          destroy: vi.fn(),
          update: vi.fn(),
        };
      });

      vi.mocked(BackupEntity.findAll).mockImplementation((options: any) => {
        if (options.where.category === 'weekly') {
          return Promise.resolve(weeklyBackups as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      await service.enforceRetention();

      // Verify that 2 oldest weekly backups were deleted (indices 4, 5)
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
      expect(weeklyBackups[4].update).toHaveBeenCalled();
      expect(weeklyBackups[5].update).toHaveBeenCalled();

      // Verify newest 4 were not deleted (indices 0-3)
      expect(weeklyBackups[0].update).not.toHaveBeenCalled();
      expect(weeklyBackups[3].update).not.toHaveBeenCalled();
    });

    it('should keep only 6 most recent monthly backups', async () => {
      // Create 8 monthly backups (1st of month)
      const monthlyBackups = Array.from({ length: 8 }, (_, i) => {
        const date = DateTime.now().minus({ months: i }).set({ day: 1 });
        return {
          id: `monthly-${i}`,
          filename: `pavillion_${date.toFormat('yyyyMMdd_HHmmss')}_scheduled.dump`,
          size_bytes: 5000,
          created_at: date.toJSDate(),
          type: 'scheduled' as const,
          category: 'monthly' as const,
          verified: true,
          storage_location: '/backups',
          destroy: vi.fn(),
          update: vi.fn(),
        };
      });

      vi.mocked(BackupEntity.findAll).mockImplementation((options: any) => {
        if (options.where.category === 'monthly') {
          return Promise.resolve(monthlyBackups as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      await service.enforceRetention();

      // Verify that 2 oldest monthly backups were deleted (indices 6, 7)
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
      expect(monthlyBackups[6].update).toHaveBeenCalled();
      expect(monthlyBackups[7].update).toHaveBeenCalled();

      // Verify newest 6 were not deleted (indices 0-5)
      expect(monthlyBackups[0].update).not.toHaveBeenCalled();
      expect(monthlyBackups[5].update).not.toHaveBeenCalled();
    });

    it('should delete correct files from filesystem', async () => {
      const backupPath = config.get<string>('housekeeping.backup.path');

      // Create 8 daily backups so that retention will kick in
      const backups = Array.from({ length: 8 }, (_, i) => ({
        id: `old-daily-${i}`,
        filename: `old_backup_${i}.dump`,
        size_bytes: 5000,
        created_at: DateTime.now().minus({ days: i }).toJSDate(),
        type: 'scheduled' as const,
        category: 'daily' as const,
        verified: true,
        storage_location: backupPath,
        destroy: vi.fn(),
        update: vi.fn(),
      }));

      vi.mocked(BackupEntity.findAll).mockImplementation((options: any) => {
        if (options.where.category === 'daily') {
          return Promise.resolve(backups as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      await service.enforceRetention();

      // Verify correct file path was deleted (oldest backup)
      expect(fs.unlinkSync).toHaveBeenCalledWith(`${backupPath}/old_backup_7.dump`);
    });

    it('should run retention after successful backup', async () => {
      // This test verifies the service can be called (integration test in worker will verify automatic triggering)
      vi.mocked(BackupEntity.findAll).mockResolvedValue([]);

      // Should not throw error when called
      await expect(service.enforceRetention()).resolves.not.toThrow();
    });

    it('should handle missing files gracefully', async () => {
      const backups = Array.from({ length: 8 }, (_, i) => ({
        id: `missing-backup-${i}`,
        filename: `missing_${i}.dump`,
        size_bytes: 5000,
        created_at: DateTime.now().minus({ days: i }).toJSDate(),
        type: 'scheduled' as const,
        category: 'daily' as const,
        verified: true,
        storage_location: '/backups',
        destroy: vi.fn(),
        update: vi.fn(),
      }));

      vi.mocked(BackupEntity.findAll).mockImplementation((options: any) => {
        if (options.where.category === 'daily') {
          return Promise.resolve(backups as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.existsSync).mockReturnValue(false); // Files don't exist

      // Should not throw even if file is missing
      await expect(service.enforceRetention()).resolves.not.toThrow();

      // Should still update metadata for deleted backups (oldest one)
      expect(backups[7].update).toHaveBeenCalled();
    });
  });
});
