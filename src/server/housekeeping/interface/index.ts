import config from 'config';
import { DateTime } from 'luxon';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import BackupService from '@/server/housekeeping/service/backup';
import StorageService from '@/server/housekeeping/service/storage';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

/**
 * Status information returned by getStatus method
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
  };
  alerts: string[];
  retentionStats: {
    daily: { current: number; target: number };
    weekly: { current: number; target: number };
    monthly: { current: number; target: number };
  };
}

/**
 * Housekeeping domain interface for cross-domain communication.
 *
 * Provides access to housekeeping functionality such as backup management,
 * disk monitoring, and system maintenance tasks.
 */
export default class HousekeepingInterface {
  private emailInterface: EmailInterface;
  private accountsInterface: AccountsInterface;
  private backupService: BackupService;
  private storageService: StorageService;
  private diskMonitor: DiskMonitorService;

  constructor(emailInterface: EmailInterface, accountsInterface: AccountsInterface) {
    this.emailInterface = emailInterface;
    this.accountsInterface = accountsInterface;
    this.backupService = new BackupService();
    this.storageService = new StorageService();
    this.diskMonitor = new DiskMonitorService();
  }

  /**
   * Gets the status of the housekeeping system.
   * Used by dashboard and API endpoints.
   *
   * @returns Status information including backups, disk usage, and alerts
   */
  async getStatus(): Promise<HousekeepingStatus> {
    // Get last backup
    const lastBackupInfo = await this.getLastBackupInfo();

    // Get next scheduled backup time
    const nextBackupTime = this.getNextBackupTime();

    // Get disk usage
    const diskUsageInfo = await this.getDiskUsageInfo();

    // Determine alert states
    const alerts = this.getAlerts(diskUsageInfo.percentageUsed);

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
      console.error('[Housekeeping Interface] Error calculating next backup time:', error);
      return null;
    }
  }

  /**
   * Gets disk usage information for the backup volume.
   *
   * @returns Disk usage statistics
   */
  private async getDiskUsageInfo(): Promise<{
    percentageUsed: number;
    totalBytes: string;
    freeBytes: string;
  }> {
    const backupPath = config.get<string>('housekeeping.backup.path');
    const usage = await this.diskMonitor.checkDiskUsage(backupPath);

    return {
      percentageUsed: usage.percentageUsed,
      totalBytes: usage.totalBytes.toString(),
      freeBytes: usage.freeBytes.toString(),
    };
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
    const dailyCount = await BackupEntity.count({ where: { category: 'daily' } });
    const weeklyCount = await BackupEntity.count({ where: { category: 'weekly' } });
    const monthlyCount = await BackupEntity.count({ where: { category: 'monthly' } });

    const dailyTarget = config.get<number>('housekeeping.backup.retention.daily');
    const weeklyTarget = config.get<number>('housekeeping.backup.retention.weekly');
    const monthlyTarget = config.get<number>('housekeeping.backup.retention.monthly');

    return {
      daily: { current: dailyCount, target: dailyTarget },
      weekly: { current: weeklyCount, target: weeklyTarget },
      monthly: { current: monthlyCount, target: monthlyTarget },
    };
  }

  /**
   * Gets the email interface for sending alerts.
   *
   * @returns EmailInterface instance
   */
  getEmailInterface(): EmailInterface {
    return this.emailInterface;
  }

  /**
   * Gets the accounts interface for querying admin users.
   *
   * @returns AccountsInterface instance
   */
  getAccountsInterface(): AccountsInterface {
    return this.accountsInterface;
  }
}
