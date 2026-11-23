/**
 * Pavillion CLI Implementation
 *
 * Command-line interface for backup management and housekeeping operations.
 */

import { Command } from 'commander';
import config from 'config';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import db from '../common/entity/db.js';
import HousekeepingInterface from '../housekeeping/interface/index.js';
import { formatDrillStatus } from './drill-status.js';
import EmailInterface from '../email/interface/index.js';
import AccountsInterface from '../accounts/interface/index.js';
import * as readline from 'readline';
import Table from 'cli-table3';
import { DateTime } from 'luxon';
import {
  checkDumpMigrations,
  dumpMigrationsInvocation,
  formatRestoreTarget,
  listCodeMigrations,
  parseDumpMigrations,
  pgRestoreInvocation,
  printable,
  resolveRestoreConnection,
  restoreUsageError,
} from './restore.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Lazily-constructed housekeeping interface — the boundary the CLI uses for all
 * backup and job-queue operations (DEC-003). The CLI does not reach into
 * housekeeping services or entities directly.
 */
let housekeeping: HousekeepingInterface | null = null;

function getHousekeeping(): HousekeepingInterface {
  if (!housekeeping) {
    housekeeping = new HousekeepingInterface(new EmailInterface(), new AccountsInterface());
  }
  return housekeeping;
}

/**
 * Initializes the database connection for CLI commands.
 *
 * Uses the shared `db` singleton (as the worker and the import:sync command do)
 * so every entity's `addModels()` self-registration is picked up. SQL logging
 * is already disabled via the `database.logging` config.
 */
async function initDatabase(): Promise<void> {
  try {
    await db.authenticate();
    console.log(chalk.green('[CLI] Database connected'));
  }
  catch (error) {
    console.error(chalk.red('[CLI] Failed to connect to database:'), error);
    throw error;
  }
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

    const jobId = await getHousekeeping().queueManualBackup();

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

    const backups = await getHousekeeping().listBackups();

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
      const date = DateTime.fromJSDate(backup.createdAt).toFormat('yyyy-MM-dd HH:mm:ss');
      const size = formatBytes(backup.sizeBytes);
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

    const housekeepingInterface = getHousekeeping();
    const stats = await housekeepingInterface.getStorageStats();

    // Get last successful backup
    const lastBackup = await housekeepingInterface.getLastVerifiedBackup();

    // Get last successful restore drill — the only proof a backup restores
    const lastDrill = await housekeepingInterface.getLastSuccessfulDrill();

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
      const date = DateTime.fromJSDate(lastBackup.createdAt).toFormat('yyyy-MM-dd HH:mm:ss');
      console.log(`  Date: ${date}`);
      console.log(`  Size: ${formatBytes(lastBackup.sizeBytes)}`);
      console.log(`  Type: ${lastBackup.type}`);
      console.log(`  Category: ${lastBackup.category}`);
      console.log(`  Verified: ${lastBackup.verified ? chalk.green('✓') : chalk.red('✗')}`);
    }
    else {
      console.log(chalk.yellow('  No backups found'));
    }

    // Last restore drill
    console.log('\n' + formatDrillStatus(lastDrill).join('\n'));

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
 * Handles backup restore command: a backup ID, or `--file <path>`.
 *
 * The usage check runs first and touches nothing. Then the restore is
 * interactive only: the confirmation must come from a person at a terminal,
 * never from text piped in (`echo yes | docker exec -i ...`), so a non-TTY
 * stdin is refused before anything is touched, on both paths.
 */
async function handleBackupRestore(backupId: string | undefined, file: string | undefined) {
  const usageError = restoreUsageError(backupId, file);
  if (usageError) {
    console.error(chalk.red(`[Restore] ${usageError}`));
    process.exit(1);
  }

  if (!process.stdin.isTTY) {
    console.error(chalk.red('[Restore] Restore must be run from an interactive terminal; refusing to read confirmation from piped input.'));
    process.exit(1);
  }

  if (file) {
    await handleBackupRestoreFromFile(file);
  }
  else {
    await handleBackupRestoreById(backupId as string);
  }
}

/**
 * Restores the backup a metadata row names, into the database that holds the
 * row. For rolling back a running instance.
 */
async function handleBackupRestoreById(backupId: string) {
  try {
    await initDatabase();

    const backup = await getHousekeeping().getBackup(backupId);

    if (!backup) {
      console.error(chalk.red(`[Backup] Backup not found: ${backupId}`));
      process.exit(1);
    }

    // Display backup details
    console.log(chalk.bold('\n⚠️  Database Restore Warning\n'));
    console.log('This operation will replace the current database with the selected backup.');
    console.log(chalk.red('ALL CURRENT DATA WILL BE LOST!\n'));

    const conn = resolveRestoreConnection(config.get('database'));
    console.log(formatRestoreTarget(conn) + '\n');

    const date = DateTime.fromJSDate(backup.createdAt).toFormat('yyyy-MM-dd HH:mm:ss');
    console.log(chalk.cyan('Backup Details:'));
    console.log(`  ID: ${backup.id}`);
    console.log(`  Date: ${date}`);
    console.log(`  Size: ${formatBytes(backup.sizeBytes)}`);
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

    const backupPath = path.join(backup.storageLocation, backup.filename);

    // Clean database first, then restore. No shell: the password goes in the
    // child's environment, never in its arguments.
    const { args, env } = pgRestoreInvocation(conn, backupPath);
    await execFileAsync('pg_restore', args, { env });

    console.log(chalk.green('\n[Restore] ✓ Database restored successfully'));
    console.log('\n' + chalk.yellow('Please restart the application for changes to take effect.'));
  }
  catch (error) {
    console.error(chalk.red('\n[Restore] Failed to restore backup:'), error);
    process.exit(1);
  }
}

/**
 * Reads a dump's migration record without a database or a shell.
 *
 * @returns The names, or null when the file is not a dump pg_restore can read
 *   or has no SequelizeMeta data. A missing pg_restore binary is rethrown:
 *   it says nothing about the file.
 */
async function readDumpMigrations(dumpPath: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync('pg_restore', dumpMigrationsInvocation(dumpPath).args);
    return parseDumpMigrations(stdout);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw error;
    }
    return null;
  }
}

/**
 * Restores a dump file named on the command line, for recovery onto an
 * empty server after total loss.
 *
 * Reads no table before pg_restore runs: there is no backup record to look
 * up, and the target may hold nothing at all. The file and its migration
 * record are checked before any connection is opened.
 */
async function handleBackupRestoreFromFile(file: string) {
  try {
    const dumpPath = path.resolve(file);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(dumpPath);
    }
    catch {
      stat = null;
    }
    if (!stat?.isFile()) {
      console.error(chalk.red(`[Restore] Not a regular file: ${printable(dumpPath)}`));
      process.exit(1);
    }

    const check = checkDumpMigrations(
      listCodeMigrations(path.join(process.cwd(), 'migrations')),
      await readDumpMigrations(dumpPath),
    );
    if (!check.ok) {
      console.error(chalk.red(check.lines.join('\n')));
      process.exit(1);
    }

    // Proves only that the target is reachable; reads no table.
    await initDatabase();

    console.log(chalk.bold('\n⚠️  Database Restore Warning\n'));
    console.log('This operation will replace the current database with the dump file.');
    console.log(chalk.red('ALL CURRENT DATA WILL BE LOST!\n'));

    const conn = resolveRestoreConnection(config.get('database'));
    console.log(formatRestoreTarget(conn) + '\n');

    console.log(chalk.cyan('Dump file:'));
    console.log(`  File: ${printable(path.basename(dumpPath))}`);
    console.log(`  Size: ${formatBytes(stat.size)}`);
    console.log(check.lines.join('\n') + '\n');

    const confirmed = await confirm('Are you absolutely sure you want to restore this dump?');

    if (!confirmed) {
      console.log(chalk.yellow('Restore cancelled.'));
      process.exit(0);
    }

    console.log(chalk.blue('\n[Restore] Starting database restore...'));

    // No shell: the operator's path is one argument after `--`, and the
    // password goes in the child's environment, never in its arguments.
    const { args, env } = pgRestoreInvocation(conn, dumpPath);
    await execFileAsync('pg_restore', args, { env });

    console.log(chalk.green('\n[Restore] ✓ Database restored successfully'));
    console.log('\n' + chalk.yellow('Start the stack with: docker compose up -d'));
  }
  catch (error) {
    console.error(chalk.red('\n[Restore] Failed to restore dump:'), error);
    process.exit(1);
  }
}

/**
 * Handles the backup record-drill command.
 *
 * Called by scripts/restore-drill.sh (via `docker exec`) once a drill has
 * completed, because the drill is a host-side shell script with no database
 * access of its own. This single append is the drill's only write to the live
 * database; the restore and verification it performs happen inside a throwaway
 * container that cannot reach this one.
 *
 * Deliberately shares nothing with handleBackupRestore: no child process, no
 * credential on a command line. It is one insert through the housekeeping
 * domain interface.
 */
async function handleBackupRecordDrill(options: { file: string; result: string; detail?: string }) {
  // commander does not constrain an option's value, so the verdict is validated
  // here. Anything other than the two documented words is a caller bug, and
  // recording a drill under a third verdict would quietly corrupt the signal.
  if (options.result !== 'pass' && options.result !== 'fail') {
    console.error(chalk.red(`[Drill] --result must be 'pass' or 'fail', got: ${options.result}`));
    process.exit(1);
  }

  try {
    await initDatabase();

    await getHousekeeping().recordDrillResult({
      backupFilename: options.file,
      passed: options.result === 'pass',
      detail: options.detail ?? null,
    });

    console.log(chalk.green(`[Drill] ✓ Recorded ${options.result} for ${options.file}`));
  }
  catch (error) {
    // The message only, never the error object: a Sequelize error carries .sql
    // and the bound parameters of the failed insert, and this output goes to the
    // drill's cron log. Same serialization the import:sync handler below uses.
    console.error(chalk.red('[Drill] Failed to record drill result:'), error instanceof Error ? error.message : String(error));
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
 * Handles the ICS import:sync command.
 *
 * Thin shell around {@link runImportSync} — responsible only for wiring the
 * runtime dependencies (calendar interface, accounts service, sync service)
 * and forwarding the exit code back to the process. All logic / output lives
 * in the adapter module so it can be unit-tested without spawning a process.
 *
 * @see bead pv-1qcp.2.5
 */
async function handleImportSync(options: { sourceId?: string; calendarId?: string }): Promise<void> {
  try {
    // Use the shared db singleton so every entity's addModels() self-registration
    // is picked up. Imported dynamically here (rather than reusing the top-level
    // `db` import) alongside the calendar entity modules below, so the import:sync
    // path pulls in only what it needs.
    const dbModule = await import('../common/entity/db.js');
    await dbModule.default.authenticate();
    // Touch the import_source / import_run / calendar / event modules so their
    // static `db.addModels([...])` side effects run before the sync service
    // queries them.
    await Promise.all([
      import('../calendar/entity/import_source.js'),
      import('../calendar/entity/import_run.js'),
      import('../calendar/entity/calendar.js'),
      import('../calendar/entity/event.js'),
    ]);

    const { runImportSync, buildImportSyncDeps } = await import('../calendar/cli/import-sync.js');

    const eventBus = new EventEmitter();
    const deps = await buildImportSyncDeps(eventBus);

    const result = await runImportSync(options, deps);

    if (result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  }
  catch (error) {
    console.error(chalk.red('[ImportSync] Failed:'), error instanceof Error ? error.message : String(error));
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
    .description('Replace the database with a backup (by ID) or a dump file (--file)')
    .argument('[id]', 'Backup ID to restore')
    .option('--file <path>', 'Dump file to restore, for recovery onto an empty server; no backup record is looked up')
    .action(async (id: string | undefined, opts: { file?: string }) => {
      await handleBackupRestore(id, opts.file);
    });

  backupCommand
    .command('record-drill')
    .description('Record the outcome of a restore drill (written by scripts/restore-drill.sh; not intended for hand invocation)')
    .requiredOption('--file <filename>', 'Backup filename the drill ran against')
    .requiredOption('--result <result>', 'pass or fail')
    .option('--detail <text>', 'Short failure reason (never credentials)')
    .action(async (opts: { file: string; result: string; detail?: string }) => {
      await handleBackupRecordDrill(opts);
    });

  // Housekeeping commands
  program
    .command('housekeeping')
    .description('View housekeeping system status')
    .action(async () => {
      await handleHousekeepingStatus();
    });

  // ICS import commands (pv-1qcp — dogfooding entry point for manual sync)
  program
    .command('import:sync')
    .description('Manually sync an ICS import source (or all verified sources for a calendar)')
    .option('--source-id <id>', 'Import source UUID to sync')
    .option('--calendar-id <id>', 'Calendar UUID — sync all verified sources for this calendar')
    .action(async (opts: { sourceId?: string; calendarId?: string }) => {
      await handleImportSync(opts);
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
    // Cleanup resources. close() is a no-op if the connection was never
    // opened (e.g. for --help / --version), so it is safe to call
    // unconditionally. The job queue used by `backup create` owns its own
    // lifecycle inside HousekeepingInterface.queueManualBackup.
    await db.close();
  }
}

// Run main program
main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
