import * as fs from 'fs';
import * as path from 'path';
import config from 'config';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { Op } from 'sequelize';

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
    console.log('[Retention] Enforcing GFS retention policy');
    console.log(`[Retention] Limits: ${this.retentionLimits.daily} daily, ${this.retentionLimits.weekly} weekly, ${this.retentionLimits.monthly} monthly`);

    try {
      // Enforce retention for each category
      await this.enforceRetentionForCategory('daily', this.retentionLimits.daily);
      await this.enforceRetentionForCategory('weekly', this.retentionLimits.weekly);
      await this.enforceRetentionForCategory('monthly', this.retentionLimits.monthly);

      console.log('[Retention] Retention enforcement completed');
    }
    catch (error) {
      console.error('[Retention] Failed to enforce retention policy:', error);
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
      console.log(`[Retention] ${category}: ${backups.length} backups (within limit of ${limit})`);
      return;
    }

    // Identify excess backups (beyond retention limit)
    const excessBackups = backups.slice(limit);
    console.log(`[Retention] ${category}: Deleting ${excessBackups.length} excess backups (${backups.length} total, limit ${limit})`);

    // Delete excess backup files
    for (const backup of excessBackups) {
      await this.deleteBackup(backup);
    }
  }

  /**
   * Deletes a backup file from filesystem and updates metadata.
   *
   * @param backup - BackupEntity to delete
   */
  private async deleteBackup(backup: BackupEntity): Promise<void> {
    const fullPath = path.join(backup.storage_location, backup.filename);

    try {
      // Delete file from filesystem
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`[Retention] Deleted backup file: ${backup.filename}`);
      }
      else {
        console.warn(`[Retention] Backup file not found, skipping deletion: ${backup.filename}`);
      }

      // Update metadata to mark as deleted
      await backup.update({
        verified: false, // Mark as no longer verified since file is gone
      });

      console.log(`[Retention] Updated metadata for deleted backup: ${backup.id}`);
    }
    catch (error) {
      console.error(`[Retention] Failed to delete backup ${backup.filename}:`, error);
      throw error;
    }
  }
}
