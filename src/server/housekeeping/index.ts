import { Application } from 'express';
import { EventEmitter } from 'events';
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
  private jobQueueService: JobQueueService | null = null;

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
   *
   * Sets up API routes, event handlers, and a publish-only JobQueueService
   * so other domains can enqueue background jobs through
   * `HousekeepingInterface.publishJob`. The actual job consumers run in the
   * separate worker process (`src/server/worker.ts`).
   *
   * In sqlite test mode `JobQueueService.start()` is a no-op so the wire-up
   * still completes without a live pg-boss server.
   *
   * @param app - Express application instance
   */
  public async initialize(app: Application): Promise<void> {
    this.installAPI(app);
    this.installEventHandlers();
    await this.installJobPublisher();
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

  /**
   * Starts a publish-only pg-boss connection and wires it into the interface
   * so other domains can publish jobs. The worker process owns its own
   * separate JobQueueService instance for consumption; this one is publisher-
   * only and never calls subscribe(). If pg-boss fails to start (e.g. the
   * database is briefly unreachable on boot) we log and continue — calls to
   * `publishJob` will then throw a clear wiring error rather than silently
   * dropping jobs.
   */
  private async installJobPublisher(): Promise<void> {
    try {
      this.jobQueueService = new JobQueueService();
      await this.jobQueueService.start();
      this.interface.setJobQueueService(this.jobQueueService);
      logger.info('Job publisher wired into housekeeping interface');
    }
    catch (error) {
      logError(error, '[Housekeeping] Failed to start job publisher; publishJob will throw until restart');
      this.jobQueueService = null;
    }
  }
}
