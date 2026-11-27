import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import { Account } from '@/common/model/account';
import { MailData } from '@/server/common/email/types';
import DiskWarningEmail from '@/server/housekeeping/model/disk-warning-email';
import DiskCriticalEmail from '@/server/housekeeping/model/disk-critical-email';
import BackupFailedEmail from '@/server/housekeeping/model/backup-failed-email';
import DiskMonitorService, { DiskUsageStats } from '@/server/housekeeping/service/disk-monitor';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import {
  decideDiskAlert,
  DiskAlertLevel,
  DiskAlertState,
  DiskLevel,
} from '@/server/housekeeping/service/disk-alert-decision';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/** Warning and critical disk usage thresholds, as percentages. */
export interface DiskThresholds {
  warning: number;
  critical: number;
}

/**
 * Describes an error for the disk alert logs by its class and code only.
 *
 * A mail transport error's message and fields (`response`, `rejected`,
 * `envelope`) carry recipient addresses, so the alert flow never logs the raw
 * error or its message — only this.
 *
 * @param err - Anything a catch received
 * @returns The error's name and, when it has one, its code (`code`, else the
 *   SMTP `responseCode`)
 */
export function describeSendError(err: unknown): { name: string; code?: string | number } {
  if (typeof err !== 'object' || err === null) {
    return { name: typeof err };
  }

  const { name, code, responseCode } = err as { name?: unknown; code?: unknown; responseCode?: unknown };
  const described: { name: string; code?: string | number } = {
    name: typeof name === 'string' ? name : 'unknown',
  };
  const anyCode = code ?? responseCode;
  if (typeof anyCode === 'string' || typeof anyCode === 'number') {
    described.code = anyCode;
  }
  return described;
}

/**
 * Service for sending disk space alert emails.
 *
 * Handles sending warning and critical alerts to administrators when
 * disk usage exceeds configured thresholds. Sends emails to all admin
 * users in their preferred languages. Gracefully handles SMTP
 * configuration issues by logging errors without throwing.
 */
export default class AlertsService {
  private emailInterface: EmailInterface;
  private accountsInterface: AccountsInterface;
  private diskSnapshotService: DiskSnapshotService;
  private diskMonitorService: DiskMonitorService;

  /**
   * Creates an AlertsService instance.
   *
   * @param emailInterface - Email interface for sending notifications
   * @param accountsInterface - Accounts interface for querying admin users
   * @param diskSnapshotService - Where the disk alert state is stored
   * @param diskMonitorService - Classifies readings against the thresholds
   */
  constructor(
    emailInterface: EmailInterface,
    accountsInterface: AccountsInterface,
    diskSnapshotService: DiskSnapshotService = new DiskSnapshotService(),
    diskMonitorService: DiskMonitorService = new DiskMonitorService(),
  ) {
    this.emailInterface = emailInterface;
    this.accountsInterface = accountsInterface;
    this.diskSnapshotService = diskSnapshotService;
    this.diskMonitorService = diskMonitorService;
  }

  /**
   * Alerts the administrators about a backup-volume disk reading, at most once
   * per state.
   *
   * Classifies the reading, reads the alert state stored on the snapshot row,
   * and sends on a change of level or once the resend interval has passed
   * (see decideDiskAlert). State is recorded only when at least one
   * administrator was reached, so a send that reached nobody is retried on
   * the next hourly run. A normal reading clears the state. Never throws:
   * every failure is logged and the next run carries on.
   *
   * Accepted limitations: a partial delivery records state, so administrators
   * it missed are not retried within the interval; a crash between sending
   * and recording resends next run (at-least-once); usage flapping across a
   * threshold sends on each crossing, at most once per run.
   *
   * @param usage - The reading the worker just recorded
   * @param thresholds - Warning and critical thresholds
   * @param now - Time of the reading; defaults to now
   */
  async processDiskReading(usage: DiskUsageStats, thresholds: DiskThresholds, now: Date = new Date()): Promise<void> {
    const level = this.classifyDiskLevel(usage.percentageUsed, thresholds);

    let stored: DiskAlertState;
    try {
      stored = await this.diskSnapshotService.getAlertState(BACKUP_PATH_STAT_KEY);
    }
    catch (error: unknown) {
      // Unknown state is treated as none outstanding: a duplicate alert is
      // better than a missing one.
      logger.error({ error: describeSendError(error) }, 'Could not read disk alert state');
      stored = { level: null, sentAt: null };
    }

    const decision = decideDiskAlert(level, stored, now);

    if (decision === 'clear') {
      logger.info('Disk usage within normal limits');
      if (stored.level !== null || stored.sentAt !== null) {
        await this.recordDiskAlertState(null, null);
      }
      return;
    }

    const alertLevel = level as DiskAlertLevel;
    const threshold = alertLevel === 'critical' ? thresholds.critical : thresholds.warning;
    logger.warn({ alertLevel, threshold }, 'Disk usage threshold exceeded');

    if (decision === 'skip') {
      logger.info({ alertLevel }, 'Disk alert for this level already sent within the resend interval');
      return;
    }

    const usedSpace = this.diskMonitorService.formatBytes(usage.usedBytes);
    const totalSpace = this.diskMonitorService.formatBytes(usage.totalBytes);
    const reached = alertLevel === 'critical'
      ? await this.sendDiskCritical(usage.percentageUsed, threshold, usedSpace, totalSpace)
      : await this.sendDiskWarning(usage.percentageUsed, threshold, usedSpace, totalSpace);

    if (reached > 0) {
      await this.recordDiskAlertState(alertLevel, now);
    }
  }

  /**
   * Sends a warning-level disk space alert to all admin users.
   *
   * Called when disk usage reaches the warning threshold (typically 80%).
   * Queries all admin accounts and sends each admin an email in their
   * preferred language.
   *
   * @param usagePercent - Current disk usage percentage
   * @param threshold - Warning threshold that was exceeded
   * @param usedSpace - Formatted used space string (e.g., "47.2 GB")
   * @param totalSpace - Formatted total space string (e.g., "100.0 GB")
   * @returns How many administrators the alert reached
   */
  async sendDiskWarning(
    usagePercent: number,
    threshold: number,
    usedSpace?: string,
    totalSpace?: string,
  ): Promise<number> {
    return this.sendDiskAlert('warning', usagePercent, (admin) => new DiskWarningEmail(
      usagePercent,
      threshold,
      usedSpace || `${usagePercent.toFixed(1)}%`,
      totalSpace || '100%',
      admin.email,
    ).buildMessage(admin.language || 'en'));
  }

  /**
   * Sends a critical-level disk space alert to all admin users.
   *
   * Called when disk usage reaches the critical threshold (typically 90%).
   * Queries all admin accounts and sends each admin an email in their
   * preferred language with urgent messaging.
   *
   * @param usagePercent - Current disk usage percentage
   * @param threshold - Critical threshold that was exceeded
   * @param usedSpace - Formatted used space string (e.g., "85.5 GB")
   * @param totalSpace - Formatted total space string (e.g., "100.0 GB")
   * @returns How many administrators the alert reached
   */
  async sendDiskCritical(
    usagePercent: number,
    threshold: number,
    usedSpace?: string,
    totalSpace?: string,
  ): Promise<number> {
    return this.sendDiskAlert('critical', usagePercent, (admin) => new DiskCriticalEmail(
      usagePercent,
      threshold,
      usedSpace || `${usagePercent.toFixed(1)}%`,
      totalSpace || '100%',
      admin.email,
    ).buildMessage(admin.language || 'en'));
  }

  /**
   * Sends a disk alert to each administrator, one message apiece.
   *
   * Never throws. A failed lookup, render or send is logged by error class and
   * code only (describeSendError). When nobody is reached — every send failed,
   * or there are no administrators — logs one error naming the level, the
   * usage and how many sends were attempted.
   *
   * @param alertLevel - Level being alerted
   * @param percentageUsed - Usage figure the alert reports
   * @param buildMessage - Renders the alert for one administrator
   * @returns How many administrators the alert reached
   */
  private async sendDiskAlert(
    alertLevel: DiskAlertLevel,
    percentageUsed: number,
    buildMessage: (admin: Account) => MailData,
  ): Promise<number> {
    let admins: Account[] = [];
    try {
      admins = await this.accountsInterface.getAdmins();
    }
    catch (error: unknown) {
      logger.error({ error: describeSendError(error) }, 'Could not look up administrators for the disk alert');
    }

    let reached = 0;
    for (const admin of admins) {
      try {
        await this.emailInterface.sendEmail(buildMessage(admin));
        reached++;
      }
      catch (error: unknown) {
        logger.warn({ error: describeSendError(error) }, 'Disk alert email to an administrator failed');
      }
    }

    const attempted = admins.length;
    if (reached === 0) {
      logger.error({ alertLevel, percentageUsed, attempted }, 'Disk alert reached no administrator');
    }
    else if (reached < attempted) {
      logger.warn({ alertLevel, failed: attempted - reached, attempted }, 'Disk alert did not reach every administrator');
    }
    else {
      logger.info({ alertLevel, reached }, 'Disk alert sent');
    }

    return reached;
  }

  /**
   * Classifies a usage percentage against the thresholds.
   */
  private classifyDiskLevel(percentageUsed: number, thresholds: DiskThresholds): DiskLevel {
    if (this.diskMonitorService.isCriticalThreshold(percentageUsed, thresholds.critical)) {
      return 'critical';
    }
    if (this.diskMonitorService.isWarningThreshold(percentageUsed, thresholds.warning, thresholds.critical)) {
      return 'warning';
    }
    return 'normal';
  }

  /**
   * Records the disk alert state, logging rather than throwing on failure.
   */
  private async recordDiskAlertState(level: DiskAlertLevel | null, sentAt: Date | null): Promise<void> {
    try {
      await this.diskSnapshotService.setAlertState(BACKUP_PATH_STAT_KEY, level, sentAt);
    }
    catch (error: unknown) {
      logger.error({ error: describeSendError(error) }, 'Could not record disk alert state');
    }
  }

  /**
   * Sends a backup-failed alert to all admin users.
   *
   * Called when a manual or scheduled backup job has exhausted its retries
   * and ultimately failed. Queries all admin accounts and sends each admin
   * an email in their preferred language describing the failed job so it
   * can be diagnosed and re-run.
   *
   * @param backupType - Whether the failure was a 'manual' or 'scheduled' backup
   * @param filename - Filename (or intended filename) of the backup artifact
   * @param errorMessage - Final error message from the failed job
   * @param occurredAt - When the failure occurred (Date or pre-formatted string)
   */
  async sendBackupFailed(
    backupType: 'manual' | 'scheduled',
    filename: string,
    errorMessage: string,
    occurredAt: Date | string,
  ): Promise<void> {
    try {
      // Get all admin accounts
      const adminAccounts = await this.accountsInterface.getAdmins();

      if (adminAccounts.length === 0) {
        logger.warn('No admin accounts found, skipping backup failed alert');
        return;
      }

      // Normalize occurredAt to a string for the email model
      const occurredAtString = occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt;

      // Send email to each admin in their preferred language
      let sentCount = 0;
      for (const admin of adminAccounts) {
        try {
          const language = admin.language || 'en';
          const email = new BackupFailedEmail(
            backupType,
            filename,
            errorMessage,
            occurredAtString,
            admin.email,
          );

          const mailData = email.buildMessage(language);
          await this.emailInterface.sendEmail(mailData);
          sentCount++;
        }
        catch (error: any) {
          logger.warn({ err: error, adminEmail: admin.email }, 'Failed to send backup failed alert email');
        }
      }

      logger.info({ sentCount, totalAdmins: adminAccounts.length, backupType, filename }, 'Backup failed alert emails sent');
    }
    catch (error: any) {
      // Gracefully handle email failures - log but don't throw
      // This allows monitoring to continue even if SMTP is not configured
      logger.warn({ err: error }, 'Failed to send backup failed alert');
    }
  }

}
