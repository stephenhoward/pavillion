import { promises as fs } from 'fs';

/**
 * Disk usage statistics for a filesystem.
 */
export interface DiskUsageStats {
  /** Total bytes on filesystem */
  totalBytes: bigint;
  /** Used bytes on filesystem */
  usedBytes: bigint;
  /** Free bytes available to unprivileged users */
  freeBytes: bigint;
  /** Percentage of disk space used (0-100) */
  percentageUsed: number;
  /** Path that was checked */
  path: string;
}

/**
 * Service for monitoring disk space usage.
 *
 * Uses Node.js native fs.statfs API to check filesystem statistics
 * and calculate disk usage percentages for backup volume monitoring.
 */
export default class DiskMonitorService {
  /**
   * Checks disk usage for a specified path.
   *
   * Uses fs.statfs to retrieve filesystem statistics and calculates
   * the percentage of disk space used. The calculation uses bavail
   * (blocks available to unprivileged users) rather than bfree to
   * account for blocks reserved for privileged users.
   *
   * @param path - Path to check disk usage for (typically /backups)
   * @returns Disk usage statistics including percentage used
   * @throws Error if statfs call fails (path not found, permission denied, etc.)
   */
  async checkDiskUsage(path: string): Promise<DiskUsageStats> {
    const stats = await fs.statfs(path);

    const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize);
    const freeBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
    const usedBytes = totalBytes - (BigInt(stats.bfree) * BigInt(stats.bsize));

    // Calculate percentage used
    const percentageUsed = totalBytes === BigInt(0)
      ? 0
      : Number((usedBytes * BigInt(10000)) / totalBytes) / 100;

    return {
      totalBytes,
      usedBytes,
      freeBytes,
      percentageUsed,
      path,
    };
  }

  /**
   * Checks if disk usage is at warning level.
   *
   * Warning level is when usage meets or exceeds the warning threshold
   * but is still below the critical threshold.
   *
   * @param percentageUsed - Current disk usage percentage
   * @param warningThreshold - Warning threshold percentage (default 80)
   * @param criticalThreshold - Critical threshold percentage (default 90)
   * @returns True if at warning level (not critical)
   */
  isWarningThreshold(
    percentageUsed: number,
    warningThreshold: number = 80,
    criticalThreshold: number = 90,
  ): boolean {
    return percentageUsed >= warningThreshold && percentageUsed < criticalThreshold;
  }

  /**
   * Checks if disk usage is at critical level.
   *
   * Critical level is when usage meets or exceeds the critical threshold.
   *
   * @param percentageUsed - Current disk usage percentage
   * @param criticalThreshold - Critical threshold percentage (default 90)
   * @returns True if at critical level
   */
  isCriticalThreshold(
    percentageUsed: number,
    criticalThreshold: number = 90,
  ): boolean {
    return percentageUsed >= criticalThreshold;
  }

  /**
   * Formats bytes into human-readable string (GB, TB, etc.).
   *
   * @param bytes - Number of bytes
   * @returns Formatted string (e.g., "47.2 GB")
   */
  formatBytes(bytes: bigint): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(bytes);
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }
}
