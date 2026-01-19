import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';

describe('DiskMonitorService', () => {
  let service: DiskMonitorService;

  beforeEach(() => {
    service = new DiskMonitorService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkDiskUsage', () => {
    it('should calculate disk usage percentage correctly', async () => {
      // Mock fs.statfs to return controlled values
      const mockStats = {
        blocks: BigInt(1000000),  // Total blocks
        bsize: BigInt(4096),      // Block size
        bavail: BigInt(200000),   // Available blocks (20% free)
        bfree: BigInt(250000),    // Free blocks
        type: BigInt(0),
        files: BigInt(0),
        ffree: BigInt(0),
      };

      vi.spyOn(fs, 'statfs').mockResolvedValue(mockStats as any);

      const result = await service.checkDiskUsage('/backups');

      // 1000000 blocks - 250000 free blocks = 750000 used blocks
      // 750000 / 1000000 = 0.75 = 75% used
      expect(result.percentageUsed).toBeCloseTo(75, 1);
      expect(result.totalBytes).toBe(BigInt(1000000) * BigInt(4096));
      expect(result.usedBytes).toBe(BigInt(750000) * BigInt(4096));
      expect(result.freeBytes).toBe(BigInt(200000) * BigInt(4096));
      expect(result.path).toBe('/backups');
    });

    it('should handle zero percent usage', async () => {
      const mockStats = {
        blocks: BigInt(1000000),
        bsize: BigInt(4096),
        bavail: BigInt(1000000),  // All blocks available
        bfree: BigInt(1000000),
        type: BigInt(0),
        files: BigInt(0),
        ffree: BigInt(0),
      };

      vi.spyOn(fs, 'statfs').mockResolvedValue(mockStats as any);

      const result = await service.checkDiskUsage('/backups');

      expect(result.percentageUsed).toBe(0);
    });

    it('should handle 100 percent usage', async () => {
      const mockStats = {
        blocks: BigInt(1000000),
        bsize: BigInt(4096),
        bavail: BigInt(0),      // No blocks available
        bfree: BigInt(0),
        type: BigInt(0),
        files: BigInt(0),
        ffree: BigInt(0),
      };

      vi.spyOn(fs, 'statfs').mockResolvedValue(mockStats as any);

      const result = await service.checkDiskUsage('/backups');

      expect(result.percentageUsed).toBe(100);
    });

    it('should throw error if statfs fails', async () => {
      vi.spyOn(fs, 'statfs').mockRejectedValue(new Error('Path not found'));

      await expect(service.checkDiskUsage('/invalid/path')).rejects.toThrow('Path not found');
    });
  });

  describe('isWarningThreshold', () => {
    it('should return true when usage equals warning threshold', () => {
      expect(service.isWarningThreshold(80, 80)).toBe(true);
    });

    it('should return true when usage exceeds warning threshold', () => {
      expect(service.isWarningThreshold(85, 80)).toBe(true);
    });

    it('should return false when usage is below warning threshold', () => {
      expect(service.isWarningThreshold(79.9, 80)).toBe(false);
    });

    it('should return false when at critical level', () => {
      expect(service.isWarningThreshold(90, 80)).toBe(false);
    });
  });

  describe('isCriticalThreshold', () => {
    it('should return true when usage equals critical threshold', () => {
      expect(service.isCriticalThreshold(90, 90)).toBe(true);
    });

    it('should return true when usage exceeds critical threshold', () => {
      expect(service.isCriticalThreshold(95, 90)).toBe(true);
    });

    it('should return false when usage is below critical threshold', () => {
      expect(service.isCriticalThreshold(89.9, 90)).toBe(false);
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(service.formatBytes(BigInt(0))).toBe('0.0 B');
      expect(service.formatBytes(BigInt(1024))).toBe('1.0 KB');
      expect(service.formatBytes(BigInt(1048576))).toBe('1.0 MB');
      expect(service.formatBytes(BigInt(1073741824))).toBe('1.0 GB');
      expect(service.formatBytes(BigInt(1099511627776))).toBe('1.0 TB');
    });

    it('should format fractional bytes correctly', () => {
      expect(service.formatBytes(BigInt(1536))).toBe('1.5 KB');
      expect(service.formatBytes(BigInt(5368709120))).toBe('5.0 GB');
    });
  });
});
