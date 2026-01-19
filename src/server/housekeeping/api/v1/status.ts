import express, { Request, Response } from 'express';
import config from 'config';
import { DateTime } from 'luxon';
import ExpressHelper from '@/server/common/helper/express';
import HousekeepingInterface from '@/server/housekeeping/interface';
import BackupService from '@/server/housekeeping/service/backup';
import StorageService from '@/server/housekeeping/service/storage';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

/**
 * Route handlers for housekeeping status API.
 *
 * Provides status information for the admin dashboard widget including
 * backup status, disk usage, and alert states.
 */
export default class HousekeepingStatusRoutes {
  private housekeepingInterface: HousekeepingInterface;
  private backupService: BackupService;
  private storageService: StorageService;
  private diskMonitor: DiskMonitorService;

  constructor(housekeepingInterface: HousekeepingInterface) {
    this.housekeepingInterface = housekeepingInterface;
    this.backupService = new BackupService();
    this.storageService = new StorageService();
    this.diskMonitor = new DiskMonitorService();
  }

  /**
   * Installs route handlers for housekeeping status endpoints.
   *
   * @param app - Express application instance
   * @param routePrefix - Route prefix (e.g., '/api/v1/admin/housekeeping')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/status', ExpressHelper.adminOnly, this.getStatus.bind(this));
    app.use(routePrefix, router);
  }

  /**
   * Gets housekeeping system status for admin dashboard.
   *
   * Returns:
   * - Last backup information (date, size, type)
   * - Next scheduled backup time
   * - Disk usage statistics
   * - Alert states (warning/critical)
   * - Retention policy statistics
   *
   * @param req - Express request
   * @param res - Express response
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
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

      res.json({
        lastBackup: lastBackupInfo,
        nextBackup: nextBackupTime,
        diskUsage: diskUsageInfo,
        alerts,
        retentionStats,
      });
    }
    catch (error) {
      console.error('[Housekeeping Status API] Error getting status:', error);
      res.status(500).json({ error: 'Failed to get housekeeping status' });
    }
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
   * Uses the configured backup schedule (default: "0 2 * * *" - 2 AM daily)
   * to determine when the next backup will run.
   *
   * @returns ISO date string of next backup time or null
   */
  private getNextBackupTime(): string | null {
    try {
      // Get backup schedule from config (cron format: "0 2 * * *")
      const schedule = config.get<string>('housekeeping.backup.schedule');

      // Parse simple daily schedule (assumes "0 2 * * *" format)
      // For a more robust implementation, could use a cron parser library
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
      console.error('[Housekeeping Status API] Error calculating next backup time:', error);
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
}
