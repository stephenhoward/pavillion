import http from 'http';
import config from 'config';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import db from '@/server/common/entity/db';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import BackupService from '@/server/housekeeping/service/backup';
import RetentionService from '@/server/housekeeping/service/retention';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import AlertsService from '@/server/housekeeping/service/alerts';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import CalendarInterface from '@/server/calendar/interface';
import IpCleanupService from '@/server/moderation/service/ip-cleanup';
import NotificationRetentionCleanupService from '@/server/notifications/service/retention-cleanup';
import ActivityPubInterface from '@/server/activitypub/interface';
import { FollowBackfillService, BackfillRateLimitError } from '@/server/activitypub/service/backfill';
import { ActivityPubFollowAcceptedPayload } from '@/server/activitypub/events/types';
import { BackupCreateError } from '@/common/exceptions/housekeeping';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('worker');

/**
 * Worker mode entrypoint for Pavillion.
 *
 * This file initializes the worker container which processes background jobs
 * from the pg-boss queue. Unlike the web container, this does not start an
 * Express application server. It does start a minimal HTTP health check server
 * on port 3001 so that container orchestration tools (e.g. Docker healthcheck,
 * autoheal) can verify the worker is alive and processing jobs.
 */

let jobQueue: JobQueueService | null = null;
let healthServer: http.Server | null = null;

const HEALTH_PORT = 3001;

/**
 * Extracts a human-readable error message from a backup failure.
 *
 * For BackupCreateError, prefers the underlying cause's message (so the
 * alert reflects the original failure). BackupService always constructs
 * BackupCreateError with an Error instance as the cause, so the
 * `cause instanceof Error` branch is the live path. For any other error,
 * uses the error's own message or a String coercion.
 *
 * @param error - The error thrown by BackupService.createBackup
 * @returns A string suitable for the alert payload
 */
function backupErrorMessage(error: unknown): string {
  if (error instanceof BackupCreateError && error.cause instanceof Error) {
    return error.cause.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

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
  const ipCleanupService = new IpCleanupService();
  const eventBus = new EventEmitter();
  const calendarInterface = new CalendarInterface(eventBus);
  const activityPubInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);
  const followBackfillService = new FollowBackfillService({
    activityPubInterface,
    calendarInterface,
  });

  // Manual backup job handler (triggered via API/CLI)
  await queue.subscribe('backup:create', async (data: any, meta) => {
    logger.info('Executing manual backup job');
    try {
      const type = data?.type || 'manual';
      const metadata = await backupService.createBackup(type);
      logger.info({ filename: metadata.filename }, 'Manual backup completed');

      // Trigger retention enforcement after successful manual backup
      logger.info('Triggering retention enforcement');
      await retentionService.enforceRetention();
    }
    catch (error) {
      logger.error({ err: error }, 'Manual backup failed');
      // Dispatch alert only on the final retry attempt; otherwise the user
      // would receive one email per attempt during a retry storm.
      if (meta && meta.retryCount >= meta.retryLimit) {
        const backupType: 'manual' | 'scheduled' = data?.type === 'scheduled' ? 'scheduled' : 'manual';
        const filename = error instanceof BackupCreateError ? error.filename : 'unknown';
        const errorMessage = backupErrorMessage(error);
        await alertsService.sendBackupFailed(backupType, filename, errorMessage, new Date());
      }
      throw error;
    }
  });

  // Backup job handler (scheduled daily at 2 AM)
  await queue.schedule('backup:daily', '0 2 * * *', async (data, meta) => {
    logger.info('Executing backup:daily job');
    try {
      const metadata = await backupService.createBackup('scheduled');
      logger.info({ filename: metadata.filename }, 'Backup completed');

      // Trigger retention enforcement after successful backup
      logger.info('Triggering retention enforcement');
      await retentionService.enforceRetention();
    }
    catch (error) {
      logger.error({ err: error }, 'Backup failed');
      // Dispatch alert only on the final retry attempt; otherwise the user
      // would receive one email per attempt during a retry storm.
      if (meta && meta.retryCount >= meta.retryLimit) {
        const filename = error instanceof BackupCreateError ? error.filename : 'unknown';
        const errorMessage = backupErrorMessage(error);
        await alertsService.sendBackupFailed('scheduled', filename, errorMessage, new Date());
      }
      throw error;
    }
  });

  // Disk check job handler (runs hourly)
  await queue.schedule('disk:check', '0 * * * *', async (data) => {
    logger.info('Executing disk:check job');
    try {
      // Get configuration
      const backupPath = config.get<string>('housekeeping.backup.path');
      const warningThreshold = config.get<number>('housekeeping.monitoring.disk.warning_threshold');
      const criticalThreshold = config.get<number>('housekeeping.monitoring.disk.critical_threshold');

      // Check disk usage
      const usage = await diskMonitorService.checkDiskUsage(backupPath);

      logger.info({ percentageUsed: usage.percentageUsed.toFixed(1), backupPath, freeBytes: diskMonitorService.formatBytes(usage.freeBytes) }, 'Disk usage check');

      // Check thresholds and send alerts
      if (diskMonitorService.isCriticalThreshold(usage.percentageUsed, criticalThreshold)) {
        logger.warn({ criticalThreshold }, 'CRITICAL disk threshold exceeded');
        await alertsService.sendDiskCritical(
          usage.percentageUsed,
          criticalThreshold,
          backupPath,
          diskMonitorService.formatBytes(usage.usedBytes),
          diskMonitorService.formatBytes(usage.totalBytes),
        );
      }
      else if (diskMonitorService.isWarningThreshold(usage.percentageUsed, warningThreshold, criticalThreshold)) {
        logger.warn({ warningThreshold }, 'Warning disk threshold exceeded');
        await alertsService.sendDiskWarning(
          usage.percentageUsed,
          warningThreshold,
          backupPath,
          diskMonitorService.formatBytes(usage.usedBytes),
          diskMonitorService.formatBytes(usage.totalBytes),
        );
      }
      else {
        logger.info('Disk usage within normal limits');
      }
    }
    catch (error) {
      logger.error({ err: error }, 'Disk check failed');
      // Don't throw - allow monitoring to continue on next scheduled check
    }
  });

  // IP cleanup job handler (runs daily at 3 AM)
  await queue.schedule('moderation:ip-cleanup', '0 3 * * *', async (data) => {
    logger.info('Executing moderation:ip-cleanup job');
    try {
      // Get retention configuration
      const hashRetentionDays = config.get<number>('moderation.retention.ipHash');
      const subnetRetentionDays = config.get<number>('moderation.retention.ipSubnet');

      logger.info({ hashRetentionDays, subnetRetentionDays }, 'IP cleanup policy');

      // Execute cleanup
      const result = await ipCleanupService.cleanupExpiredIpData(hashRetentionDays, subnetRetentionDays);

      logger.info({ hashCleared: result.hashCleared, subnetCleared: result.subnetCleared }, 'IP cleanup completed');
    }
    catch (error) {
      logger.error({ err: error }, 'IP cleanup failed');
      throw error;
    }
  });

  // Notification retention cleanup job (runs daily at 4 AM). Two-pass
  // delete: drop seen/dismissed recipients older than 7 days, then drop
  // activity rows older than 90 days (FK cascade removes any remaining
  // recipients).
  const notificationRetentionCleanupService = new NotificationRetentionCleanupService();
  await queue.schedule('notifications:cleanup', '0 4 * * *', async () => {
    logger.info('Executing notifications:cleanup job');
    try {
      const result = await notificationRetentionCleanupService.cleanupExpiredNotifications();
      logger.info(
        { recipientsDeleted: result.recipientsDeleted, activitiesDeleted: result.activitiesDeleted },
        'Notification retention cleanup completed',
      );
    }
    catch (error) {
      logger.error({ err: error }, 'Notification cleanup failed');
      throw error;
    }
  });

  // Inbox cleanup job handler (runs daily at 5 AM)
  await queue.schedule(
    'inbox:cleanup',
    config.get<string>('housekeeping.inbox.schedule'),
    async () => {
      logger.info('Executing inbox:cleanup job');
      try {
        const retentionDays = config.get<number>('housekeeping.inbox.retentionDays');
        const batchSize = config.get<number>('housekeeping.inbox.batchSize');
        const count = await activityPubInterface.cleanupProcessedInboxMessages(retentionDays, batchSize);
        logger.info({ count }, 'Inbox cleanup completed');
      }
      catch (error) {
        logger.error({ err: error }, 'Inbox cleanup failed');
        throw error;
      }
    },
  );

  // ActivityPub follow-backfill job handler. Published by
  // ActivityPubEventHandlers#handleFollowAccepted whenever a remote
  // Accept(Follow) confirms a follow the local instance initiated.
  await queue.subscribe(
    'activitypub:follow:backfill',
    async (data: ActivityPubFollowAcceptedPayload) => {
      logger.info(
        { followingCalendarId: data?.followingCalendarId },
        'Executing activitypub:follow:backfill job',
      );
      try {
        await followBackfillService.runBackfill(data);
        logger.info({ followingCalendarId: data?.followingCalendarId }, 'activitypub:follow:backfill job completed');
      }
      catch (error) {
        // A rate-limit pause is expected back-pressure, not a failure: rows
        // persisted before the pause were already drained, and re-throwing
        // lets pg-boss re-queue the job (after the configured retry delay) to
        // walk the remaining outbox pages. Log it at warn, not error.
        if (error instanceof BackfillRateLimitError) {
          logger.warn({ followingCalendarId: data?.followingCalendarId }, 'activitypub:follow:backfill paused on rate limit; will retry');
          throw error;
        }
        logger.error({ err: error, followingCalendarId: data?.followingCalendarId }, 'activitypub:follow:backfill job failed');
        throw error;
      }
    },
  );
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
  else if (cronExpression === '0 3 * * *') {
    const next = DateTime.now().plus({ days: 1 }).set({ hour: 3, minute: 0, second: 0 });
    return next.toFormat('MMM dd, yyyy h:mm a');
  }
  else if (cronExpression === '0 4 * * *') {
    const next = DateTime.now().plus({ days: 1 }).set({ hour: 4, minute: 0, second: 0 });
    return next.toFormat('MMM dd, yyyy h:mm a');
  }
  else if (cronExpression === '0 5 * * *') {
    const next = DateTime.now().plus({ days: 1 }).set({ hour: 5, minute: 0, second: 0 });
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
  logger.info('Starting in worker mode');
  logger.info('pg-boss queue: connected');
  logger.info({
    jobs: {
      'backup:daily': `next: ${getNextRunTime('0 2 * * *')}`,
      'moderation:ip-cleanup': `next: ${getNextRunTime('0 3 * * *')}`,
      'disk:check': `next: ${getNextRunTime('0 * * * *')}`,
      'notifications:cleanup': `next: ${getNextRunTime('0 4 * * *')}`,
      'inbox:cleanup': `next: ${getNextRunTime('0 5 * * *')}`,
      'backup:create': 'manual',
      'activitypub:follow:backfill': 'on-demand',
    },
  }, 'Scheduled jobs registered');
  logger.info('Worker ready, processing jobs...');
}

/**
 * Creates and starts the HTTP health check server.
 *
 * @returns The HTTP server instance
 */
function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const started = jobQueue?.isStarted() ?? false;
    const status = started ? 200 : 503;
    const body = JSON.stringify({ status: started ? 'ok' : 'unavailable' });

    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });

  server.listen(HEALTH_PORT, '127.0.0.1', () => {
    logger.info({ port: HEALTH_PORT }, 'Health check server listening');
  });

  return server;
}

/**
 * Handles graceful shutdown of worker process.
 */
async function handleShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received signal, shutting down gracefully');

  if (healthServer) {
    await new Promise<void>((resolve) => {
      healthServer!.close(() => {
        logger.info('Health check server closed');
        resolve();
      });
      setTimeout(resolve, 5000).unref();
    });
  }

  if (jobQueue) {
    await jobQueue.stop();
  }

  await db.close();
  logger.info('Shutdown complete');
  process.exit(0);
}

/**
 * Main worker initialization function.
 */
async function startWorker(): Promise<void> {
  try {
    // Initialize database connection
    logger.info('Connecting to database...');
    await db.authenticate();
    logger.info('Database connected');

    // Initialize pg-boss in processing mode
    jobQueue = new JobQueueService();
    await jobQueue.start();

    // Start health check server
    healthServer = startHealthServer();

    // Register job handlers
    await registerJobHandlers(jobQueue);

    // Log startup messages
    logStartupMessages();

    // Register shutdown handlers
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }
  catch (error) {
    logger.error({ err: error }, 'Failed to start worker');
    process.exit(1);
  }
}

// In production and dev the worker is launched via app.ts (see
// `bin/entrypoint.sh` and `src/server/app.ts`). app.ts imports this module
// and calls the exported `startWorker` explicitly. This guard remains so that
// running `tsx src/server/worker.ts` directly still boots the worker, while
// test imports of `registerJobHandlers` do not trigger a real database/pg-boss
// connection.
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker();
}

export { startWorker, registerJobHandlers };
