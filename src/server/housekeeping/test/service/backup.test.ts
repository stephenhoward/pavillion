import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import BackupService from '@/server/housekeeping/service/backup';
import config from 'config';
import * as fs from 'fs';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

// Mock fs (a non-built-in wrapper that can be mocked) and the database entity.
// Note: child_process is a Node.js built-in and cannot be mocked via vi.mock() in
// ESM environments. Instead, we spy on BackupService.executeCommand() directly,
// which is a protected method exposed for exactly this purpose.
vi.mock('fs');
vi.mock('@/server/housekeeping/entity/backup', () => ({
  BackupEntity: {
    create: vi.fn(),
  },
}));

describe('BackupService', () => {
  let service: BackupService;

  beforeEach(() => {
    service = new BackupService();
    vi.clearAllMocks();

    // Spy on the protected executeCommand method to prevent real execFile calls.
    // This avoids the need to mock the Node.js child_process built-in module, which
    // is non-configurable in ESM environments and cannot be replaced via vi.mock().
    // In the SQLite test environment this spy is not invoked (writeFileSync is used
    // instead), but it guards against accidental pg_dump invocations.
    vi.spyOn(service as any, 'executeCommand').mockResolvedValue(undefined);

    // Stub writeFileSync so the SQLite stub-file write is a no-op in tests
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ size: 5000 } as any);
    vi.mocked(BackupEntity.create).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createBackup', () => {
    it('should write stub file for SQLite without calling executeCommand', async () => {
      const execSpy = vi.spyOn(service as any, 'executeCommand').mockResolvedValue(undefined);

      const result = await service.createBackup('manual');

      // SQLite path: executeCommand (pg_dump) must never be invoked
      expect(execSpy).not.toHaveBeenCalled();
      // A stub file must be written directly via fs.writeFileSync
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\.dump$/),
        'test backup',
      );
      expect(result.filename).toMatch(/^pavillion_\d{8}_\d{6}_manual\.dump$/);
      expect(result.type).toBe('manual');
    });

    it('should generate filename with timestamp and type', async () => {
      const result = await service.createBackup('scheduled');

      // Verify filename format: pavillion_YYYYMMDD_HHMMSS_<type>.dump
      expect(result.filename).toMatch(/^pavillion_\d{8}_\d{6}_scheduled\.dump$/);

      // Should be today's date
      const now = DateTime.now();
      const datePrefix = now.toFormat('yyyyMMdd');
      expect(result.filename).toContain(datePrefix);
    });

    it('should categorize backup correctly based on date', async () => {
      // Test monthly (1st of month)
      const now = DateTime.now().set({ day: 1, hour: 12 });
      const category = service.categorizeBackup(now);
      expect(category).toBe('monthly');
    });

    it('should verify backup file exists and has minimum size', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ size: 5000 } as any);

      const result = await service.createBackup('manual');
      expect(result.verified).toBe(true);
      expect(result.size_bytes).toBe(5000);
    });

    it('should mark as unverified if file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await service.createBackup('manual');
      expect(result.verified).toBe(false);
    });

    it('should mark as unverified if file size is below minimum threshold', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ size: 500 } as any); // Below 1KB minimum

      const result = await service.createBackup('manual');
      expect(result.verified).toBe(false);
    });

    it('should record backup metadata', async () => {
      const result = await service.createBackup('manual');

      // Verify metadata structure
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('filename');
      expect(result).toHaveProperty('size_bytes');
      expect(result).toHaveProperty('created_at');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('verified');
      expect(result).toHaveProperty('storage_location');

      expect(result.type).toBe('manual');
      expect(result.storage_location).toBe(config.get('housekeeping.backup.path'));

      // Verify database save was called
      expect(BackupEntity.create).toHaveBeenCalledWith({
        id: expect.any(String),
        filename: expect.stringMatching(/^pavillion_\d{8}_\d{6}_manual\.dump$/),
        size_bytes: 5000,
        created_at: expect.any(Date),
        type: 'manual',
        category: expect.stringMatching(/^(daily|weekly|monthly)$/),
        verified: true,
        storage_location: config.get('housekeeping.backup.path'),
      });
    });
  });

  describe('categorizeBackup', () => {
    it('should categorize as monthly on 1st of month', () => {
      const firstOfMonth = DateTime.now().set({ day: 1 });
      const category = service.categorizeBackup(firstOfMonth);
      expect(category).toBe('monthly');
    });

    it('should categorize as weekly on Sunday', () => {
      // Find next Sunday
      let sunday = DateTime.now();
      while (sunday.weekday !== 7) { // 7 is Sunday in Luxon
        sunday = sunday.plus({ days: 1 });
      }

      // Make sure it's not the 1st (which would be monthly)
      if (sunday.day !== 1) {
        const category = service.categorizeBackup(sunday);
        expect(category).toBe('weekly');
      }
      else {
        // If Sunday is the 1st, test with next Sunday
        const nextSunday = sunday.plus({ days: 7 });
        const category = service.categorizeBackup(nextSunday);
        expect(category).toBe('weekly');
      }
    });

    it('should categorize as daily for regular days', () => {
      // Find a day that's not Sunday and not 1st of month
      let regularDay = DateTime.now();
      while (regularDay.weekday === 7 || regularDay.day === 1) {
        regularDay = regularDay.plus({ days: 1 });
      }

      const category = service.categorizeBackup(regularDay);
      expect(category).toBe('daily');
    });
  });
});
