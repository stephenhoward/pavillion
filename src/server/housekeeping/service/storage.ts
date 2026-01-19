import * as fs from 'fs';
import config from 'config';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

/**
 * Storage statistics for backup storage volume
 */
export interface StorageStats {
  totalSize: number;      // Total size of all backups in bytes
  count: number;          // Number of backups
  freeSpace: number;      // Free space on volume in bytes
  totalSpace: number;     // Total space on volume in bytes
  freeSpacePercent: number; // Free space as percentage
}

/**
 * Storage service for managing backup files and storage statistics.
 *
 * Provides operations for listing, retrieving, and deleting backup files,
 * as well as monitoring storage usage on the backup volume.
 */
export default class StorageService {
  private backupPath: string;

  constructor() {
    this.backupPath = config.get<string>('housekeeping.backup.path');
  }

  /**
   * Lists all backup metadata, sorted by creation date descending.
   *
   * @returns Array of backup entities
   */
  async listBackups(): Promise<BackupEntity[]> {
    return await BackupEntity.findAll({
      order: [['created_at', 'DESC']],
    });
  }

  /**
   * Gets details for a single backup by ID.
   *
   * @param id - Backup ID
   * @returns Backup entity or null if not found
   */
  async getBackup(id: string): Promise<BackupEntity | null> {
    return await BackupEntity.findByPk(id);
  }

  /**
   * Deletes a backup file from the filesystem.
   *
   * This is a low-level operation that only handles file deletion.
   * Metadata updates should be handled by the caller.
   *
   * @param filename - Full path to backup file
   */
  async deleteBackupFile(filename: string): Promise<void> {
    try {
      if (fs.existsSync(filename)) {
        fs.unlinkSync(filename);
        console.log(`[Storage] Deleted backup file: ${filename}`);
      }
      else {
        console.warn(`[Storage] Backup file not found, skipping deletion: ${filename}`);
      }
    }
    catch (error) {
      console.error(`[Storage] Failed to delete backup file ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Gets storage statistics for the backup volume.
   *
   * @returns Storage statistics including total size, count, and free space
   */
  async getStorageStats(): Promise<StorageStats> {
    try {
      // Get all backups to calculate total size
      const backups = await BackupEntity.findAll();

      const totalSize = backups.reduce((sum, backup) => sum + Number(backup.size_bytes), 0);
      const count = backups.length;

      // Get filesystem stats for the backup path
      const stats = fs.statfsSync(this.backupPath);

      // Calculate space in bytes
      const totalSpace = stats.blocks * stats.bsize;
      const freeSpace = stats.bfree * stats.bsize;
      const freeSpacePercent = (freeSpace / totalSpace) * 100;

      return {
        totalSize,
        count,
        freeSpace,
        totalSpace,
        freeSpacePercent,
      };
    }
    catch (error) {
      console.error('[Storage] Failed to get storage stats:', error);
      throw error;
    }
  }
}
