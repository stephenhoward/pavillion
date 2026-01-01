import SetupService from '@/server/setup/service/setup';

/**
 * Interface for the Setup domain.
 *
 * Provides cross-domain access to setup mode status and setup operations.
 */
export default class SetupInterface {
  private setupService: SetupService;

  constructor() {
    this.setupService = new SetupService();
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
   * Completes the initial setup by creating an admin account and saving settings.
   *
   * @param email - Email address for the admin account
   * @param password - Password for the admin account
   * @param siteTitle - Title for the site
   * @param registrationMode - Registration mode (open, apply, invitation)
   * @param defaultLanguage - Default UI language code (e.g., 'en', 'es')
   * @returns Promise resolving to true if setup completed successfully
   */
  async completeSetup(
    email: string,
    password: string,
    siteTitle: string,
    registrationMode: string,
    defaultLanguage: string,
  ): Promise<boolean> {
    return this.setupService.completeSetup(email, password, siteTitle, registrationMode, defaultLanguage);
  }
}
