import SetupService from '@/server/setup/service/setup';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Interface for the Setup domain.
 *
 * Provides cross-domain access to setup mode status and setup operations.
 */
export default class SetupInterface {
  private setupService: SetupService;

  constructor(configInterface: ConfigurationInterface) {
    this.setupService = new SetupService(configInterface);
  }

  /**
   * Checks if setup mode is active (no admin account exists).
   *
   * @returns Promise resolving to true if setup is required, false otherwise
   */
  async isSetupModeActive(): Promise<boolean> {
    return this.setupService.isSetupModeActive();
  }

  /**
   * Issues a fresh setup token if no admin exists and logs it for the
   * operator. Called once at boot, after the database is ready.
   *
   * @returns The issued token, or null when setup is already complete
   */
  async issueSetupToken(): Promise<string | null> {
    return SetupService.issueSetupToken();
  }

  /**
   * Completes the initial setup by creating an admin account and saving settings.
   *
   * @param email - Email address for the admin account
   * @param password - Password for the admin account
   * @param siteTitle - Title for the site
   * @param registrationMode - Registration mode (open, apply, invitation)
   * @param defaultLanguage - Default UI language code (e.g., 'en', 'es')
   * @param setupToken - The token issued at boot and logged for the operator
   * @returns Promise resolving to true if setup completed successfully
   */
  async completeSetup(
    email: string,
    password: string,
    siteTitle: string,
    registrationMode: string,
    defaultLanguage: string,
    setupToken: string,
  ): Promise<boolean> {
    return this.setupService.completeSetup(email, password, siteTitle, registrationMode, defaultLanguage, setupToken);
  }

  /**
   * Clears the setup mode cache, forcing a fresh database query.
   * Used primarily in test environments to ensure setup state is re-evaluated.
   */
  clearCache(): void {
    SetupService.clearCache();
  }
}
