import config from 'config';
import { DateTime } from 'luxon';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/**
 * Status information returned by {@link StatusService.getStatus}.
 */
export interface HousekeepingStatus {
  lastBackup: {
    date: string;
    size: number;
    type: string;
  } | null;
  nextBackup: string | null;
  diskUsage: {
    percentageUsed: number;
    totalBytes: string;
    freeBytes: string;
  } | null;
  alerts: string[];
  retentionStats: {
    daily: { current: number; target: number };
    weekly: { current: number; target: number };
    monthly: { current: number; target: number };
  };
}

/**
 * Assembles the housekeeping system status shown on the admin dashboard.
 *
 * Combines backup history, the next scheduled backup, disk usage, alert
 * states, and retention policy compliance into a single snapshot.
 */
export default class StatusService {
  private diskMonitor: DiskMonitorService;
  private diskSnapshots: DiskSnapshotService;

  constructor() {
    this.diskMonitor = new DiskMonitorService();
    this.diskSnapshots = new DiskSnapshotService();
  }

  /**
   * Gets the status of the housekeeping system.
   *
   * Each sub-section is fetched independently so that a failure in one
   * (e.g., backup path not found in development) does not prevent the
   * rest of the status from loading.
   *
   * @returns Status information including backups, disk usage, and alerts
   */
  async getStatus(): Promise<HousekeepingStatus> {
    // Get last backup
    const lastBackupInfo = await this.getLastBackupInfo();

    // Get next scheduled backup time
    const nextBackupTime = this.getNextBackupTime();

    // Get disk usage (gracefully handles missing backup path)
    const diskUsageInfo = await this.getDiskUsageInfo();

    // Determine alert states
    const alerts = diskUsageInfo
      ? this.getAlerts(diskUsageInfo.percentageUsed)
      : ['ok'];

    // Get retention statistics
    const retentionStats = await this.getRetentionStats();

    return {
      lastBackup: lastBackupInfo,
      nextBackup: nextBackupTime,
      diskUsage: diskUsageInfo,
      alerts,
      retentionStats,
    };
  }

  /**
   * Gets information about the last successful backup.
   *
   * @returns Last backup info or null if no backups exist
   */
  private async getLastBackupInfo(): Promise<{
    date: string;
    size: number;
    type: string;
  } | null> {
    try {
      const lastBackup = await BackupEntity.findOne({
        where: { verified: true },
        order: [['created_at', 'DESC']],
      });

      if (!lastBackup) {
        return null;
      }

      return {
        date: lastBackup.created_at.toISOString(),
        size: Number(lastBackup.size_bytes),
        type: lastBackup.type,
      };
    }
    catch (error) {
      logger.error({ err: error }, 'Error fetching last backup info');
      return null;
    }
  }

  /**
   * Calculates the next scheduled backup time based on cron schedule.
   *
   * @returns ISO date string of next backup time or null
   */
  private getNextBackupTime(): string | null {
    try {
      // Get backup schedule from config (cron format: "0 2 * * *")
      const schedule = config.get<string>('housekeeping.backup.schedule');

      // Parse simple daily schedule (assumes "0 2 * * *" format)
      const match = schedule.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*/);

      if (match) {
        const minute = parseInt(match[1], 10);
        const hour = parseInt(match[2], 10);

        // Calculate next occurrence
        const now = DateTime.now();
        let next = now.set({ hour, minute, second: 0, millisecond: 0 });

        // If time has passed today, schedule for tomorrow
        if (next < now) {
          next = next.plus({ days: 1 });
        }

        return next.toISO();
      }

      return null;
    }
    catch (error) {
      logger.error({ err: error }, 'Error calculating next backup time');
      return null;
    }
  }

  /**
   * Gets disk usage information for the backup volume.
   *
   * Reads the worker-written snapshot rather than calling statfs here. The
   * backup volume is mounted into the worker container only, so statfs of the
   * backup path always fails in the production compose topology — this panel
   * showed "not configured" on every real deployment. The snapshot is the one
   * read path for backup-volume usage, shared with the metrics endpoint, so
   * the two cannot report different numbers.
   *
   * Returns null when the worker has not written a snapshot yet (a fresh
   * install, before the first hourly disk check), which the dashboard renders
   * as a graceful "not configured" state.
   *
   * @returns Disk usage statistics or null if unavailable
   */
  private async getDiskUsageInfo(): Promise<{
    percentageUsed: number;
    totalBytes: string;
    freeBytes: string;
  } | null> {
    try {
      const snapshot = await this.diskSnapshots.getSnapshot(BACKUP_PATH_STAT_KEY);

      if (!snapshot) {
        return null;
      }

      return {
        percentageUsed: snapshot.percentageUsed,
        totalBytes: snapshot.totalBytes.toString(),
        freeBytes: snapshot.freeBytes.toString(),
      };
    }
    catch (error) {
      logger.warn({ err: error }, 'Disk usage unavailable');
      return null;
    }
  }

  /**
   * Determines alert states based on disk usage.
   *
   * @param percentageUsed - Current disk usage percentage
   * @returns Array of alert states ('ok', 'warning', 'critical')
   */
  private getAlerts(percentageUsed: number): string[] {
    const warningThreshold = config.get<number>('housekeeping.monitoring.disk.warning_threshold');
    const criticalThreshold = config.get<number>('housekeeping.monitoring.disk.critical_threshold');

    const alerts: string[] = [];

    if (this.diskMonitor.isCriticalThreshold(percentageUsed, criticalThreshold)) {
      alerts.push('critical');
    }
    else if (this.diskMonitor.isWarningThreshold(percentageUsed, warningThreshold, criticalThreshold)) {
      alerts.push('warning');
    }
    else {
      alerts.push('ok');
    }

    return alerts;
  }

  /**
   * Gets statistics about backup retention policy compliance.
   *
   * @returns Retention statistics for each category
   */
  private async getRetentionStats(): Promise<{
    daily: { current: number; target: number };
    weekly: { current: number; target: number };
    monthly: { current: number; target: number };
  }> {
    const dailyTarget = config.get<number>('housekeeping.backup.retention.daily');
    const weeklyTarget = config.get<number>('housekeeping.backup.retention.weekly');
    const monthlyTarget = config.get<number>('housekeeping.backup.retention.monthly');

    try {
      const dailyCount = await BackupEntity.count({ where: { category: 'daily' } });
      const weeklyCount = await BackupEntity.count({ where: { category: 'weekly' } });
      const monthlyCount = await BackupEntity.count({ where: { category: 'monthly' } });

      return {
        daily: { current: dailyCount, target: dailyTarget },
        weekly: { current: weeklyCount, target: weeklyTarget },
        monthly: { current: monthlyCount, target: monthlyTarget },
      };
    }
    catch (error) {
      logger.error({ err: error }, 'Error fetching retention stats');
      return {
        daily: { current: 0, target: dailyTarget },
        weekly: { current: 0, target: weeklyTarget },
        monthly: { current: 0, target: monthlyTarget },
      };
    }
  }
}
