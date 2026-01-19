/**
 * Pavillion CLI Implementation
 *
 * Command-line interface for backup management and housekeeping operations.
 */

import { Command } from 'commander';
import { Sequelize } from 'sequelize-typescript';
import config from 'config';
import chalk from 'chalk';
import { BackupEntity } from '../housekeeping/entity/backup.js';
import JobQueueService from '../housekeeping/service/job-queue.js';
import StorageService from '../housekeeping/service/storage.js';
import BackupService from '../housekeeping/service/backup.js';
import * as readline from 'readline';
import Table from 'cli-table3';
import { DateTime } from 'luxon';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

// Global resources for cleanup
let sequelize: Sequelize | null = null;
let jobQueue: JobQueueService | null = null;

/**
 * Initializes database connection for CLI commands.
 */
async function initDatabase(): Promise<Sequelize> {
  try {
    const dbConfig: any = config.get('database');

    const sequelizeInstance = new Sequelize({
      ...dbConfig,
      logging: false, // Disable SQL logging in CLI
    });

    sequelizeInstance.addModels([BackupEntity]);
    await sequelizeInstance.authenticate();
    console.log(chalk.green('[CLI] Database connected'));

    return sequelizeInstance;
  }
  catch (error) {
    console.error(chalk.red('[CLI] Failed to connect to database:'), error);
    throw error;
  }
}

/**
 * Initializes job queue service for CLI commands.
 */
async function initJobQueue(): Promise<JobQueueService> {
  const jobQueueService = new JobQueueService();
  await jobQueueService.start();
  return jobQueueService;
}

/**
 * Formats bytes to human-readable size.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Prompts user for confirmation.
 */
function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Handles backup create command.
 */
async function handleBackupCreate() {
  try {
    console.log(chalk.blue('[Backup] Queueing manual backup job...'));

    await initDatabase();
    const queue = await initJobQueue();

    const jobId = await queue.publish('backup:create', { type: 'manual' });

    console.log(chalk.green('[Backup] ✓ Backup job queued successfully'));
    console.log(`Job ID: ${jobId}`);
    console.log('\nThe backup will be processed by the worker container.');
    console.log('Use "pavillion backup status" to check backup progress.');
  }
  catch (error) {
    console.error(chalk.red('[Backup] Failed to queue backup:'), error);
    process.exit(1);
  }
}

/**
 * Handles backup list command.
 */
async function handleBackupList() {
  try {
    await initDatabase();

    const storageService = new StorageService();
    const backups = await storageService.listBackups();

    if (backups.length === 0) {
      console.log(chalk.yellow('No backups found.'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Date'),
        chalk.cyan('Size'),
        chalk.cyan('Type'),
        chalk.cyan('Category'),
        chalk.cyan('Verified'),
      ],
      colWidths: [38, 22, 12, 12, 12, 12],
    });

    for (const backup of backups) {
      const date = DateTime.fromJSDate(backup.created_at).toFormat('yyyy-MM-dd HH:mm:ss');
      const size = formatBytes(backup.size_bytes);
      const verified = backup.verified ? chalk.green('✓') : chalk.red('✗');

      table.push([
        backup.id.substring(0, 36),
        date,
        size,
        backup.type,
        backup.category,
        verified,
      ]);
    }

    console.log(table.toString());
    console.log(`\nTotal: ${backups.length} backup(s)`);
  }
  catch (error) {
    console.error(chalk.red('[Backup] Failed to list backups:'), error);
    process.exit(1);
  }
}

/**
 * Handles backup status command.
 */
async function handleBackupStatus() {
  try {
    await initDatabase();

    const storageService = new StorageService();
    const stats = await storageService.getStorageStats();

    // Get last successful backup
    const lastBackup = await BackupEntity.findOne({
      where: { verified: true },
      order: [['created_at', 'DESC']],
    });

    console.log(chalk.bold('\n📊 Backup System Status\n'));

    // Storage statistics
    console.log(chalk.cyan('Storage:'));
    console.log(`  Total backups: ${stats.count}`);
    console.log(`  Total size: ${formatBytes(stats.totalSize)}`);
    console.log(`  Free space: ${formatBytes(stats.freeSpace)} (${stats.freeSpacePercent.toFixed(1)}%)`);

    const usedPercent = 100 - stats.freeSpacePercent;
    if (usedPercent > 90) {
      console.log(chalk.red(`  ⚠️  WARNING: Disk usage at ${usedPercent.toFixed(1)}%`));
    }
    else if (usedPercent > 80) {
      console.log(chalk.yellow(`  ⚠️  NOTICE: Disk usage at ${usedPercent.toFixed(1)}%`));
    }

    // Last backup
    console.log('\n' + chalk.cyan('Last Backup:'));
    if (lastBackup) {
      const date = DateTime.fromJSDate(lastBackup.created_at).toFormat('yyyy-MM-dd HH:mm:ss');
      console.log(`  Date: ${date}`);
      console.log(`  Size: ${formatBytes(lastBackup.size_bytes)}`);
      console.log(`  Type: ${lastBackup.type}`);
      console.log(`  Category: ${lastBackup.category}`);
      console.log(`  Verified: ${lastBackup.verified ? chalk.green('✓') : chalk.red('✗')}`);
    }
    else {
      console.log(chalk.yellow('  No backups found'));
    }

    // Retention policy
    console.log('\n' + chalk.cyan('Retention Policy:'));
    const retentionConfig = config.get('housekeeping.backup.retention');
    console.log(`  Daily: ${retentionConfig.daily} backups`);
    console.log(`  Weekly: ${retentionConfig.weekly} backups`);
    console.log(`  Monthly: ${retentionConfig.monthly} backups`);

    // Next scheduled backup
    console.log('\n' + chalk.cyan('Scheduled Backup:'));
    const backupSchedule = config.get('housekeeping.backup.schedule');
    console.log(`  Schedule: ${backupSchedule} (daily at 2:00 AM)`);
    console.log(`  ${chalk.dim('(Processed by worker container)')}`);

    console.log('');
  }
  catch (error) {
    console.error(chalk.red('[Backup] Failed to get status:'), error);
    process.exit(1);
  }
}

/**
 * Handles backup restore command.
 */
async function handleBackupRestore(backupId: string) {
  try {
    await initDatabase();

    const storageService = new StorageService();
    const backup = await storageService.getBackup(backupId);

    if (!backup) {
      console.error(chalk.red(`[Backup] Backup not found: ${backupId}`));
      process.exit(1);
    }

    // Display backup details
    console.log(chalk.bold('\n⚠️  Database Restore Warning\n'));
    console.log('This operation will replace the current database with the selected backup.');
    console.log(chalk.red('ALL CURRENT DATA WILL BE LOST!\n'));

    const date = DateTime.fromJSDate(backup.created_at).toFormat('yyyy-MM-dd HH:mm:ss');
    console.log(chalk.cyan('Backup Details:'));
    console.log(`  ID: ${backup.id}`);
    console.log(`  Date: ${date}`);
    console.log(`  Size: ${formatBytes(backup.size_bytes)}`);
    console.log(`  Type: ${backup.type}`);
    console.log(`  Verified: ${backup.verified ? chalk.green('✓') : chalk.red('✗')}\n`);

    if (!backup.verified) {
      console.log(chalk.red('⚠️  WARNING: This backup has not been verified!\n'));
    }

    // Confirmation prompt
    const confirmed = await confirm('Are you absolutely sure you want to restore this backup?');

    if (!confirmed) {
      console.log(chalk.yellow('Restore cancelled.'));
      process.exit(0);
    }

    // Perform restore
    console.log(chalk.blue('\n[Restore] Starting database restore...'));

    const backupPath = path.join(backup.storage_location, backup.filename);
    const dbConfig: any = config.get('database');

    // Build pg_restore command
    const host = dbConfig.host || 'localhost';
    const port = dbConfig.port || 5432;
    const database = dbConfig.database;
    const username = dbConfig.username || dbConfig.user || 'postgres';
    const password = dbConfig.password || '';

    // Clean database first, then restore
    const command = `PGPASSWORD="${password}" pg_restore -c -h ${host} -p ${port} -U ${username} -d ${database} ${backupPath}`;

    await execAsync(command);

    console.log(chalk.green('\n[Restore] ✓ Database restored successfully'));
    console.log('\n' + chalk.yellow('Please restart the application for changes to take effect.'));
  }
  catch (error) {
    console.error(chalk.red('\n[Restore] Failed to restore backup:'), error);
    process.exit(1);
  }
}

/**
 * Handles housekeeping status command.
 */
async function handleHousekeepingStatus() {
  try {
    console.log(chalk.bold('\n🔧 Housekeeping Status\n'));

    console.log(chalk.cyan('Scheduled Jobs:'));

    const backupSchedule = config.get('housekeeping.backup.schedule');
    console.log(`  ${chalk.green('✓')} backup:daily`);
    console.log(`    Schedule: ${backupSchedule} (daily at 2:00 AM)`);
    console.log(`    ${chalk.dim('Runs automated database backups')}\n`);

    const diskCheckInterval = config.get('housekeeping.monitoring.disk.check_interval');
    console.log(`  ${chalk.green('✓')} disk:check`);
    console.log(`    Schedule: ${diskCheckInterval} (hourly)`);
    console.log(`    ${chalk.dim('Monitors disk space and sends alerts')}\n`);

    console.log(`  ${chalk.green('✓')} backup:cleanup`);
    console.log(`    Trigger: After each backup`);
    console.log(`    ${chalk.dim('Enforces GFS retention policy')}\n`);

    console.log(chalk.cyan('Configuration:'));
    const housekeepingEnabled = config.get('housekeeping.enabled');
    console.log(`  Housekeeping: ${housekeepingEnabled ? chalk.green('enabled') : chalk.red('disabled')}`);

    const diskEnabled = config.get('housekeeping.monitoring.disk.enabled');
    console.log(`  Disk monitoring: ${diskEnabled ? chalk.green('enabled') : chalk.red('disabled')}`);

    const warningThreshold = config.get('housekeeping.monitoring.disk.warning_threshold');
    const criticalThreshold = config.get('housekeeping.monitoring.disk.critical_threshold');
    console.log(`  Warning threshold: ${warningThreshold}%`);
    console.log(`  Critical threshold: ${criticalThreshold}%`);

    console.log('\n' + chalk.dim('Note: Jobs are processed by the worker container.'));
    console.log(chalk.dim('Check worker logs for execution history.\n'));
  }
  catch (error) {
    console.error(chalk.red('[Housekeeping] Failed to get status:'), error);
    process.exit(1);
  }
}

/**
 * Main CLI program.
 */
async function main() {
  const program = new Command();

  program
    .name('pavillion')
    .description('Pavillion instance management CLI')
    .version('1.0.0');

  // Backup commands
  const backupCommand = program
    .command('backup')
    .description('Backup management commands');

  backupCommand
    .command('create')
    .description('Queue an immediate backup job')
    .action(async () => {
      await handleBackupCreate();
    });

  backupCommand
    .command('list')
    .description('List all available backups')
    .action(async () => {
      await handleBackupList();
    });

  backupCommand
    .command('status')
    .description('Show backup system health and statistics')
    .action(async () => {
      await handleBackupStatus();
    });

  backupCommand
    .command('restore')
    .description('Restore database from a backup')
    .argument('<id>', 'Backup ID to restore')
    .action(async (id: string) => {
      await handleBackupRestore(id);
    });

  // Housekeeping commands
  program
    .command('housekeeping')
    .description('View housekeeping system status')
    .action(async () => {
      await handleHousekeepingStatus();
    });

  // Global error handler
  program.exitOverride();

  try {
    await program.parseAsync(process.argv);
  }
  catch (error: any) {
    if (error.code !== 'commander.help' && error.code !== 'commander.version') {
      console.error(chalk.red('\nCLI Error:'), error.message);
      process.exit(1);
    }
  }
  finally {
    // Cleanup resources
    if (jobQueue) {
      await jobQueue.stop();
    }
    if (sequelize) {
      await sequelize.close();
    }
  }
}

// Run main program
main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
