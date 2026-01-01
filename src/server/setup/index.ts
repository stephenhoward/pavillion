import { Application } from 'express';
import SetupInterface from './interface';
import SetupApiV1 from './api/v1';

/**
 * Setup Domain entry point.
 *
 * Manages first-run setup detection and admin account creation.
 */
export default class SetupDomain {
  public readonly interface: SetupInterface;

  constructor() {
    this.interface = new SetupInterface();
  }

  /**
   * Initializes the Setup domain by installing API routes.
   *
   * @param app - Express application
   */
  public initialize(app: Application): void {
    this.installAPI(app);
  }

  /**
   * Installs the Setup API routes on the Express app.
   *
   * @param app - Express application
   */
  public installAPI(app: Application): void {
    SetupApiV1.install(app, this.interface);
  }
}
