import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import config from 'config';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { logError } from '@/server/common/helper/error-logger';

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
   * Executes a binary with an explicit arguments array (no shell).
   *
   * Using execFile instead of exec prevents shell injection: arguments are passed
   * directly to the OS without shell interpretation, so metacharacters in DB
   * credentials cannot break out of the argument context.
   *
   * Exposed as a protected method so tests can spy on it without needing to
   * mock Node.js built-in modules (which are non-configurable in ESM environments).
   *
   * @param file - The binary to execute
   * @param args - Arguments passed directly to the binary (no shell expansion)
   * @param env  - Environment for the child process (defaults to process.env)
   */
  protected async executeCommand(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
    const execFileAsync = promisify(execFile);
    await execFileAsync(file, args, { env: env ?? process.env });
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
      // Build pg_dump arguments or write a stub file for SQLite environments
      const pgArgs = this.buildPgDumpArgs(fullPath);

      if (pgArgs === null) {
        // SQLite test environment: write a stub file directly (no child process needed)
        fs.writeFileSync(fullPath, 'test backup');
      }
      else {
        await this.executeCommand(pgArgs.file, pgArgs.args, pgArgs.env);
      }
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
      logError(error, '[Housekeeping] Failed to create backup');
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
   * Builds pg_dump arguments for the execFile call.
   *
   * Arguments are returned as a structured object so each value is passed as a
   * discrete array element — never interpolated into a shell string. PGPASSWORD
   * is delivered through the child process environment rather than the command
   * line, keeping credentials out of process listings and shell history.
   *
   * Returns null for SQLite environments (caller writes a stub file directly).
   *
   * @param outputPath - Full path for backup file (-f argument to pg_dump)
   * @returns execFile arguments, or null for SQLite environments
   */
  private buildPgDumpArgs(outputPath: string): { file: string; args: string[]; env: NodeJS.ProcessEnv } | null {
    const dbConfig = config.get<DatabaseConfig>('database');

    // SQLite environments don't use pg_dump; caller handles the stub write
    if (dbConfig.dialect === 'sqlite' || dbConfig.storage) {
      return null;
    }

    const host = dbConfig.host || 'localhost';
    const port = dbConfig.port || 5432;
    const database = dbConfig.database;
    const username = dbConfig.username || dbConfig.user || 'postgres';
    const password = dbConfig.password || '';

    return {
      file: 'pg_dump',
      // -f writes the output file directly; avoids shell redirection (>)
      args: ['-Fc', '-h', host, '-p', String(port), '-U', username, '-d', database, '-f', outputPath],
      // Spread process.env so the child inherits PATH, locale, etc.
      // PGPASSWORD is set here rather than on the command line to avoid
      // exposing credentials in process listings.
      env: { ...process.env, PGPASSWORD: password },
    };
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
      logError(error, '[Housekeeping] Backup verification error');
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
