import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import config from 'config';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

const execAsync = promisify(exec);

/**
 * Backup metadata returned after backup creation
 */
export interface BackupMetadata {
  id: string;
  filename: string;
  size_bytes: number;
  created_at: Date;
  type: 'manual' | 'scheduled';
  category: 'daily' | 'weekly' | 'monthly';
  verified: boolean;
  storage_location: string;
}

/**
 * Database configuration interface
 */
interface DatabaseConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  username?: string;
  password?: string;
  dialect?: string;
  storage?: string;
}

/**
 * Backup service for creating and managing PostgreSQL database backups.
 *
 * Uses pg_dump with custom format (-Fc) for compression and selective restore support.
 * Categorizes backups based on GFS retention policy (daily, weekly, monthly).
 */
export default class BackupService {
  private backupPath: string;
  private minBackupSize: number = 1024; // 1KB minimum

  constructor() {
    this.backupPath = config.get('housekeeping.backup.path');
  }

  /**
   * Creates a database backup using pg_dump.
   *
   * @param type - Type of backup ('manual' or 'scheduled')
   * @returns Backup metadata
   */
  async createBackup(type: 'manual' | 'scheduled'): Promise<BackupMetadata> {
    const timestamp = DateTime.now();
    const filename = this.generateFilename(timestamp, type);
    const fullPath = path.join(this.backupPath, filename);

    console.log(`[Backup] Creating ${type} backup: ${filename}`);

    try {
      // Construct pg_dump command
      const command = this.buildPgDumpCommand(fullPath);

      // Execute backup
      await execAsync(command);
      console.log(`[Backup] pg_dump completed successfully`);

      // Verify backup
      const verification = this.verifyBackup(fullPath);

      // Determine category for GFS retention
      const category = this.categorizeBackup(timestamp);

      // Create metadata
      const metadata: BackupMetadata = {
        id: uuidv4(),
        filename,
        size_bytes: verification.size,
        created_at: timestamp.toJSDate(),
        type,
        category,
        verified: verification.verified,
        storage_location: this.backupPath,
      };

      // Save metadata to database
      await BackupEntity.create({
        id: metadata.id,
        filename: metadata.filename,
        size_bytes: metadata.size_bytes,
        created_at: metadata.created_at,
        type: metadata.type,
        category: metadata.category,
        verified: metadata.verified,
        storage_location: metadata.storage_location,
      });

      console.log(`[Backup] Backup created: ${filename} (${verification.size} bytes, ${category}, verified: ${verification.verified})`);

      // Check for optional S3 upload configuration
      this.checkS3Upload();

      return metadata;
    }
    catch (error) {
      console.error(`[Backup] Failed to create backup:`, error);
      throw error;
    }
  }

  /**
   * Checks if S3 upload is configured and logs appropriate message.
   *
   * This is a placeholder for future S3 upload functionality.
   */
  private checkS3Upload(): void {
    try {
      // Check if S3 configuration exists
      if (config.has('housekeeping.backup.s3')) {
        const s3Config = config.get('housekeeping.backup.s3');

        // Check if S3 is enabled (would be set via environment variables in production)
        if (s3Config && typeof s3Config === 'object' && 's3Enabled' in s3Config && s3Config.s3Enabled) {
          console.log('[Backup] S3 upload configured but not yet implemented (future enhancement)');
          console.log('[Backup] Backup stored locally only at this time');
        }
      }
    }
    catch (error) {
      // Config doesn't exist, which is fine - S3 is optional
    }
  }

  /**
   * Generates backup filename with timestamp and type.
   *
   * Format: pavillion_YYYYMMDD_HHMMSS_<type>.dump
   *
   * @param timestamp - Timestamp for backup
   * @param type - Backup type
   * @returns Filename
   */
  private generateFilename(timestamp: DateTime, type: string): string {
    const dateStr = timestamp.toFormat('yyyyMMdd_HHmmss');
    return `pavillion_${dateStr}_${type}.dump`;
  }

  /**
   * Builds pg_dump command with database credentials.
   *
   * Uses custom format (-Fc) for compression and selective restore.
   *
   * @param outputPath - Full path for backup file
   * @returns pg_dump command string
   */
  private buildPgDumpCommand(outputPath: string): string {
    const dbConfig = config.get<DatabaseConfig>('database');

    // For SQLite (testing), skip actual pg_dump
    if (dbConfig.dialect === 'sqlite' || dbConfig.storage) {
      return `echo "test backup" > ${outputPath}`;
    }

    const host = dbConfig.host || 'localhost';
    const port = dbConfig.port || 5432;
    const database = dbConfig.database;
    const username = dbConfig.username || dbConfig.user || 'postgres';
    const password = dbConfig.password || '';

    // Build command with PGPASSWORD environment variable
    // Using -Fc for custom format (compressed)
    const command = `PGPASSWORD="${password}" pg_dump -Fc -h ${host} -p ${port} -U ${username} -d ${database} > ${outputPath}`;

    return command;
  }

  /**
   * Verifies backup file exists and has minimum size.
   *
   * @param filePath - Full path to backup file
   * @returns Verification result with size and status
   */
  private verifyBackup(filePath: string): { verified: boolean; size: number } {
    try {
      // Check file exists
      if (!fs.existsSync(filePath)) {
        console.warn(`[Backup] Verification failed: file does not exist`);
        return { verified: false, size: 0 };
      }

      // Check file size
      const stats = fs.statSync(filePath);
      const size = stats.size;

      if (size < this.minBackupSize) {
        console.warn(`[Backup] Verification failed: file size (${size} bytes) below minimum (${this.minBackupSize} bytes)`);
        return { verified: false, size };
      }

      return { verified: true, size };
    }
    catch (error) {
      console.error(`[Backup] Verification error:`, error);
      return { verified: false, size: 0 };
    }
  }

  /**
   * Categorizes backup based on date for GFS retention policy.
   *
   * Monthly: 1st of month
   * Weekly: Sunday (day 7 in Luxon)
   * Daily: All others
   *
   * @param timestamp - Backup timestamp
   * @returns Category for retention
   */
  categorizeBackup(timestamp: DateTime): 'daily' | 'weekly' | 'monthly' {
    // Monthly: 1st of month (highest priority)
    if (timestamp.day === 1) {
      return 'monthly';
    }

    // Weekly: Sunday (weekday 7 in Luxon)
    if (timestamp.weekday === 7) {
      return 'weekly';
    }

    // Daily: everything else
    return 'daily';
  }
}
