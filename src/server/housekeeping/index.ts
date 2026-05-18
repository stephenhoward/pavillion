import { Application } from 'express';
import { EventEmitter } from 'events';
import config from 'config';
import HousekeepingInterface from './interface';
import HousekeepingStatusRoutes from './api/v1/status';
import JobQueueService from './service/job-queue';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/**
 * Housekeeping domain for automated server maintenance.
 *
 * Handles:
 * - Database backups with GFS retention
 * - Disk space monitoring and alerts
 * - Background job processing
 */
export default class HousekeepingDomain {
  public readonly interface: HousekeepingInterface;
  private readonly eventBus: EventEmitter;

  constructor(
    eventBus: EventEmitter,
    emailInterface: EmailInterface,
    accountsInterface: AccountsInterface,
  ) {
    this.eventBus = eventBus;
    this.interface = new HousekeepingInterface(emailInterface, accountsInterface);
  }

  /**
   * Initializes the housekeeping domain.
   * Sets up API routes, event handlers, and wires the pg-boss-backed
   * JobQueueService into the interface so other domains can publish
   * background jobs via `publishJob`. The worker process owns its own
   * JobQueueService and does not go through this path.
   *
   * SQLite (e2e/unit test) installs skip the pg-boss wiring — the test
   * configs use an in-memory SQLite database that pg-boss cannot drive,
   * and tests that depend on `publishJob` stub the interface directly.
   *
   * @param app - Express application instance
   */
  public async initialize(app: Application): Promise<void> {
    this.installAPI(app);
    this.installEventHandlers();
    await this.wireJobQueue();
  }

  /**
   * Starts a JobQueueService and binds it into the interface. Logs and
   * rethrows on failure — startup-time queue connectivity is a hard
   * dependency for federation follow-backfill and other publishers, so a
   * silent boot with a missing queue would leave AP handlers throwing on
   * every Accept.
   */
  private async wireJobQueue(): Promise<void> {
    const dialect = config.get<string>('database.dialect');
    if (dialect === 'sqlite') {
      logger.info('Skipping JobQueueService wiring for sqlite dialect');
      return;
    }

    try {
      const queue = new JobQueueService();
      await queue.start();
      this.interface.setJobQueueService(queue);
      logger.info('JobQueueService wired into HousekeepingInterface');
    }
    catch (error) {
      logError(error, '[Housekeeping] Failed to wire JobQueueService');
      throw error;
    }
  }

  /**
   * Installs API routes for housekeeping endpoints.
   *
   * @param app - Express application instance
   */
  public installAPI(app: Application): void {
    // Install status API routes for admin dashboard
    const statusRoutes = new HousekeepingStatusRoutes(this.interface);
    statusRoutes.installHandlers(app, '/api/v1/admin/housekeeping');

    logger.info('API routes initialized');
  }

  /**
   * Installs event handlers for housekeeping events.
   */
  public installEventHandlers(): void {
    // Event handlers will be implemented as needed
    logger.info('Event handlers initialized');
  }
}
