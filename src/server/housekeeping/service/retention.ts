import * as fs from 'fs';
import * as path from 'path';
import config from 'config';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/**
 * Retention service for managing backup lifecycle according to GFS policy.
 *
 * Implements Grandfather-Father-Son (GFS) retention:
 * - 7 daily backups
 * - 4 weekly backups (Sundays)
 * - 6 monthly backups (1st of month)
 *
 * Total: ~17 backups covering approximately 6 months of history.
 */
export default class RetentionService {
  private retentionLimits = {
    daily: config.get<number>('housekeeping.backup.retention.daily'),
    weekly: config.get<number>('housekeeping.backup.retention.weekly'),
    monthly: config.get<number>('housekeeping.backup.retention.monthly'),
  };

  /**
   * Enforces retention policy by identifying and deleting excess backups.
   *
   * Queries backups by category, sorts by creation date, and deletes
   * backups exceeding the configured retention limits.
   */
  async enforceRetention(): Promise<void> {
    logger.info({ limits: this.retentionLimits }, 'Enforcing GFS retention policy');

    try {
      // Enforce retention for each category
      await this.enforceRetentionForCategory('daily', this.retentionLimits.daily);
      await this.enforceRetentionForCategory('weekly', this.retentionLimits.weekly);
      await this.enforceRetentionForCategory('monthly', this.retentionLimits.monthly);

      logger.info('Retention enforcement completed');
    }
    catch (error) {
      logError(error, '[Housekeeping] Failed to enforce retention policy');
      throw error;
    }
  }

  /**
   * Enforces retention for a specific backup category.
   *
   * @param category - Backup category (daily, weekly, monthly)
   * @param limit - Maximum number of backups to retain
   */
  private async enforceRetentionForCategory(
    category: 'daily' | 'weekly' | 'monthly',
    limit: number,
  ): Promise<void> {
    // Query backups by category, sorted by creation date descending
    const backups = await BackupEntity.findAll({
      where: {
        category,
        verified: true, // Only manage verified backups
      },
      order: [['created_at', 'DESC']],
    });

    if (backups.length <= limit) {
      logger.info({ category, count: backups.length, limit }, 'Backups within retention limit');
      return;
    }

    // Identify excess backups (beyond retention limit)
    const excessBackups = backups.slice(limit);
    logger.info({ category, excessCount: excessBackups.length, total: backups.length, limit }, 'Deleting excess backups');

    // Delete excess backup files
    for (const backup of excessBackups) {
      await this.deleteBackup(backup);
    }
  }

  /**
   * Deletes a backup file from filesystem and removes its metadata row.
   *
   * @param backup - BackupEntity to delete
   */
  private async deleteBackup(backup: BackupEntity): Promise<void> {
    const fullPath = path.join(backup.storage_location, backup.filename);

    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        logger.info({ filename: backup.filename }, 'Deleted backup file');
      }
      else {
        logger.warn({ filename: backup.filename }, 'Backup file not found, skipping file deletion');
      }

      // Hard-delete the metadata row. A backup whose file is gone has nothing
      // left to represent; leaving a soft-deleted row behind inflates the
      // dashboard's retention count, which queries every row in the category.
      await backup.destroy();

      logger.info({ backupId: backup.id }, 'Removed metadata for deleted backup');
    }
    catch (error) {
      logError(error, `[Housekeeping] Failed to delete backup ${backup.filename}`);
      throw error;
    }
  }
}
