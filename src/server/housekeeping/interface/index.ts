import config from 'config';
import { DateTime } from 'luxon';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import BackupService from '@/server/housekeeping/service/backup';
import StorageService, { StorageStats } from '@/server/housekeeping/service/storage';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import JobQueueService, { JobPublishOptions } from '@/server/housekeeping/service/job-queue';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { createLogger } from '@/server/common/helper/logger';

// Re-exported so other domains set a job's retry/expiry policy via the
// housekeeping boundary without reaching into the pg-boss adapter directly.
export type { JobPublishOptions } from '@/server/housekeeping/service/job-queue';

// Re-exported so callers (e.g. the management CLI) can type backup storage
// stats without importing the StorageService internal.
export type { StorageStats } from '@/server/housekeeping/service/storage';

const logger = createLogger('housekeeping');

/**
 * Backup metadata exposed across the housekeeping domain boundary.
 *
 * A plain DTO projection of {@link BackupEntity} so callers (e.g. the
 * management CLI) can read backup records without importing the Sequelize
 * entity directly (DEC-003 domain boundary).
 */
export interface BackupRecord {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: Date;
  type: 'manual' | 'scheduled';
  category: 'daily' | 'weekly' | 'monthly';
  verified: boolean;
  storageLocation: string;
}

/**
 * Projects a BackupEntity onto the boundary-safe {@link BackupRecord} DTO.
 * BIGINT `size_bytes` arrives as a string from some drivers, so it is coerced
 * to a number here once rather than at every call site.
 */
function toBackupRecord(entity: BackupEntity): BackupRecord {
  return {
    id: entity.id,
    filename: entity.filename,
    sizeBytes: Number(entity.size_bytes),
    createdAt: entity.created_at,
    type: entity.type,
    category: entity.category,
    verified: entity.verified,
    storageLocation: entity.storage_location,
  };
}

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
  private jobQueueService: JobQueueService | null = null;

  constructor(emailInterface: EmailInterface, accountsInterface: AccountsInterface) {
    this.emailInterface = emailInterface;
    this.accountsInterface = accountsInterface;
    this.backupService = new BackupService();
    this.storageService = new StorageService();
    this.diskMonitor = new DiskMonitorService();
  }

  /**
   * Wires a started JobQueueService into the interface so other domains can
   * publish background jobs through `publishJob`. Set once by
   * `HousekeepingDomain.initialize()` in the web process. Worker and CLI
   * processes own their own JobQueueService directly and do not call this.
   */
  setJobQueueService(queue: JobQueueService): void {
    this.jobQueueService = queue;
  }

  /**
   * Publishes a background job through the housekeeping-owned pg-boss queue.
   * Other domains call this rather than importing JobQueueService directly,
   * keeping the queue infrastructure encapsulated inside the housekeeping
   * domain (DEC-003 domain boundary).
   *
   * @param jobName - pg-boss queue name (e.g. `activitypub:follow:backfill`)
   * @param data - JSON-serialisable job payload
   * @param options - Optional per-job retry/expiry policy (domain-neutral;
   *   see {@link JobPublishOptions}). Omit to inherit the queue defaults.
   * @throws Error if the queue has not been wired in via setJobQueueService.
   *   In production this should never happen — `HousekeepingDomain.initialize`
   *   wires the queue before AP handlers can fire. The throw exists so
   *   miswiring fails loudly rather than silently dropping jobs.
   */
  async publishJob<T = any>(jobName: string, data: T, options?: JobPublishOptions): Promise<void> {
    if (!this.jobQueueService) {
      throw new Error(
        `HousekeepingInterface.publishJob('${jobName}') called before a JobQueueService was wired in. ` +
        'This indicates a server-startup ordering bug — housekeeping must initialize before any domain that publishes jobs.',
      );
    }
    await this.jobQueueService.publish(jobName, data, options);
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
      logger.error({ err: error }, 'Error calculating next backup time');
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

  /**
   * Lists all recorded backups, newest first.
   *
   * Used by the management CLI's `backup list` command so it can render the
   * backup inventory without importing the StorageService internal.
   *
   * @returns Backup records ordered by creation date descending
   */
  async listBackups(): Promise<BackupRecord[]> {
    const backups = await this.storageService.listBackups();
    return backups.map(toBackupRecord);
  }

  /**
   * Gets a single backup by id.
   *
   * Used by the management CLI's `backup restore` command to look up the
   * backup to restore.
   *
   * @param id - Backup id
   * @returns The backup record, or null if no backup has that id
   */
  async getBackup(id: string): Promise<BackupRecord | null> {
    const backup = await this.storageService.getBackup(id);
    return backup ? toBackupRecord(backup) : null;
  }

  /**
   * Gets the most recent verified backup.
   *
   * Used by the management CLI's `backup status` command. Distinct from the
   * private `getLastBackupInfo` (which returns the trimmed shape the admin
   * dashboard needs) — the CLI needs the full record.
   *
   * @returns The latest verified backup record, or null if none exist
   */
  async getLastVerifiedBackup(): Promise<BackupRecord | null> {
    const lastBackup = await BackupEntity.findOne({
      where: { verified: true },
      order: [['created_at', 'DESC']],
    });
    return lastBackup ? toBackupRecord(lastBackup) : null;
  }

  /**
   * Gets storage statistics for the backup volume.
   *
   * Used by the management CLI's `backup status` command.
   *
   * @returns Storage statistics including total size, count, and free space
   */
  async getStorageStats(): Promise<StorageStats> {
    return this.storageService.getStorageStats();
  }

  /**
   * Queues a one-off manual backup job and returns its id.
   *
   * Used by the management CLI's `backup create` command. Self-contained: it
   * owns a short-lived JobQueueService for the publish rather than the
   * long-lived queue wired in by `setJobQueueService`, because CLI invocations
   * are separate processes that don't go through `HousekeepingDomain.initialize`.
   * The queue is always stopped afterwards so the CLI process can exit cleanly.
   *
   * @returns The published job's id, or null if pg-boss returns none
   */
  async queueManualBackup(): Promise<string | null> {
    const queue = new JobQueueService();
    await queue.start();
    try {
      return await queue.publish('backup:create', { type: 'manual' });
    }
    finally {
      await queue.stop();
    }
  }
}
