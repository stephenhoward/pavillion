import { Application } from 'express';
import { EventEmitter } from 'events';
import HousekeepingInterface from './interface';
import HousekeepingStatusRoutes from './api/v1/status';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';

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
   * Sets up API routes and event handlers.
   *
   * @param app - Express application instance
   */
  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
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

    console.log('[Housekeeping] API routes initialized');
  }

  /**
   * Installs event handlers for housekeeping events.
   */
  public installEventHandlers(): void {
    // Event handlers will be implemented as needed
    console.log('[Housekeeping] Event handlers initialized');
  }
}
