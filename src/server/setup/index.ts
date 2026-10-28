import { Application } from 'express';
import SetupInterface from './interface';
import SetupApiV1 from './api/v1';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Setup Domain entry point.
 *
 * Manages first-run setup detection and admin account creation.
 */
export default class SetupDomain {
  public readonly interface: SetupInterface;

  constructor(configInterface: ConfigurationInterface) {
    this.interface = new SetupInterface(configInterface);
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

  /**
   * Issues the setup token while no admin exists, logging it for the
   * operator. Runs at boot once the database is ready — not in initialize(),
   * which runs before the schema exists.
   */
  public async issueSetupToken(): Promise<void> {
    await this.interface.issueSetupToken();
  }
}
