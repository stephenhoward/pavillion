import config from 'config';
import { DateTime } from 'luxon';
import db from '@/server/common/entity/db';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import BackupService from '@/server/housekeeping/service/backup';
import RetentionService from '@/server/housekeeping/service/retention';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import AlertsService from '@/server/housekeeping/service/alerts';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';

/**
 * Worker mode entrypoint for Pavillion.
 *
 * This file initializes the worker container which processes background jobs
 * from the pg-boss queue. Unlike the web container, this does not start an
 * HTTP server and focuses solely on job processing.
 */

let jobQueue: JobQueueService | null = null;

/**
 * Registers job handlers for scheduled tasks.
 *
 * @param queue - JobQueueService instance
 */
async function registerJobHandlers(queue: JobQueueService): Promise<void> {
  const backupService = new BackupService();
  const retentionService = new RetentionService();
  const diskMonitorService = new DiskMonitorService();
  const emailInterface = new EmailInterface();
  const accountsInterface = new AccountsInterface();
  const alertsService = new AlertsService(emailInterface, accountsInterface);

  // Manual backup job handler (triggered via API/CLI)
  await queue.subscribe('backup:create', async (data: any) => {
    console.log('[Worker] Executing manual backup job');
    try {
      const type = data?.type || 'manual';
      const metadata = await backupService.createBackup(type);
      console.log(`[Worker] Manual backup completed: ${metadata.filename}`);

      // Trigger retention enforcement after successful manual backup
      console.log('[Worker] Triggering retention enforcement');
      await retentionService.enforceRetention();
    }
    catch (error) {
      console.error('[Worker] Manual backup failed:', error);
      throw error;
    }
  });

  // Backup job handler (scheduled daily at 2 AM)
  await queue.schedule('backup:daily', '0 2 * * *', async (data) => {
    console.log('[Worker] Executing backup:daily job');
    try {
      const metadata = await backupService.createBackup('scheduled');
      console.log(`[Worker] Backup completed: ${metadata.filename}`);

      // Trigger retention enforcement after successful backup
      console.log('[Worker] Triggering retention enforcement');
      await retentionService.enforceRetention();
    }
    catch (error) {
      console.error('[Worker] Backup failed:', error);
      throw error;
    }
  });

  // Disk check job handler (runs hourly)
  await queue.schedule('disk:check', '0 * * * *', async (data) => {
    console.log('[Worker] Executing disk:check job');
    try {
      // Get configuration
      const backupPath = config.get<string>('housekeeping.backup.path');
      const warningThreshold = config.get<number>('housekeeping.monitoring.disk.warning_threshold');
      const criticalThreshold = config.get<number>('housekeeping.monitoring.disk.critical_threshold');

      // Check disk usage
      const usage = await diskMonitorService.checkDiskUsage(backupPath);

      console.log(`[Worker] Disk usage check: ${usage.percentageUsed.toFixed(1)}% used at ${backupPath}`);
      console.log(`[Worker] Free space: ${diskMonitorService.formatBytes(usage.freeBytes)}`);

      // Check thresholds and send alerts
      if (diskMonitorService.isCriticalThreshold(usage.percentageUsed, criticalThreshold)) {
        console.log(`[Worker] CRITICAL threshold exceeded (${criticalThreshold}%)`);
        await alertsService.sendDiskCritical(
          usage.percentageUsed,
          criticalThreshold,
          backupPath,
          diskMonitorService.formatBytes(usage.usedBytes),
          diskMonitorService.formatBytes(usage.totalBytes),
        );
      }
      else if (diskMonitorService.isWarningThreshold(usage.percentageUsed, warningThreshold, criticalThreshold)) {
        console.log(`[Worker] Warning threshold exceeded (${warningThreshold}%)`);
        await alertsService.sendDiskWarning(
          usage.percentageUsed,
          warningThreshold,
          backupPath,
          diskMonitorService.formatBytes(usage.usedBytes),
          diskMonitorService.formatBytes(usage.totalBytes),
        );
      }
      else {
        console.log('[Worker] Disk usage within normal limits');
      }
    }
    catch (error) {
      console.error('[Worker] Disk check failed:', error);
      // Don't throw - allow monitoring to continue on next scheduled check
    }
  });
}

/**
 * Calculates next run time for a cron expression (approximate).
 *
 * @param cronExpression - Cron expression string
 * @returns Human-readable next run time
 */
function getNextRunTime(cronExpression: string): string {
  // Simple approximation based on cron patterns
  if (cronExpression === '0 2 * * *') {
    const next = DateTime.now().plus({ days: 1 }).set({ hour: 2, minute: 0, second: 0 });
    return next.toFormat('MMM dd, yyyy h:mm a');
  }
  else if (cronExpression === '0 * * * *') {
    const next = DateTime.now().plus({ hours: 1 }).set({ minute: 0, second: 0 });
    return next.toFormat('MMM dd, yyyy h:mm a');
  }
  return 'scheduled';
}

/**
 * Logs prominent startup messages showing worker mode and registered jobs.
 */
function logStartupMessages(): void {
  console.log('[Pavillion] Starting in worker mode');
  console.log('[Pavillion] pg-boss queue: connected');
  console.log('[Pavillion] Scheduled jobs registered:');
  console.log(`  - backup:daily at 2:00 AM (next: ${getNextRunTime('0 2 * * *')})`);
  console.log(`  - disk:check hourly (next: ${getNextRunTime('0 * * * *')})`);
  console.log('  - backup:create (manual backups via CLI/API)');
  console.log('[Pavillion] Worker ready, processing jobs...');
}

/**
 * Handles graceful shutdown of worker process.
 */
async function handleShutdown(signal: string): Promise<void> {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

  if (jobQueue) {
    await jobQueue.stop();
  }

  await db.close();
  console.log('[Worker] Shutdown complete');
  process.exit(0);
}

/**
 * Main worker initialization function.
 */
async function startWorker(): Promise<void> {
  try {
    // Initialize database connection
    console.log('[Worker] Connecting to database...');
    await db.authenticate();
    console.log('[Worker] Database connected');

    // Initialize pg-boss in processing mode
    jobQueue = new JobQueueService();
    await jobQueue.start();

    // Register job handlers
    await registerJobHandlers(jobQueue);

    // Log startup messages
    logStartupMessages();

    // Register shutdown handlers
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }
  catch (error) {
    console.error('[Worker] Failed to start:', error);
    process.exit(1);
  }
}

// Start the worker
startWorker();

export { startWorker, registerJobHandlers };
