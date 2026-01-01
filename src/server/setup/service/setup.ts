import { v4 as uuidv4 } from 'uuid';
import { scryptSync, randomBytes } from 'crypto';

import { AccountEntity, AccountRoleEntity, AccountSecretsEntity } from '@/server/common/entity/account';
import ServiceSettings from '@/server/configuration/service/settings';
import { validatePassword } from '@/common/validation/password';

/**
 * Service for managing first-run setup operations.
 *
 * Handles detection of setup mode and initial admin account creation.
 */
export default class SetupService {
  /**
   * Cache for setup mode status to avoid repeated database queries.
   * Set to null when cache needs to be invalidated.
   */
  private static setupModeCache: boolean | null = null;

  /**
   * Checks if setup mode is active (no admin account exists).
   *
   * @returns Promise resolving to true if setup is required, false otherwise
   */
  async isSetupModeActive(): Promise<boolean> {
    // Return cached value if available
    if (SetupService.setupModeCache !== null) {
      return SetupService.setupModeCache;
    }

    // Query for any account with admin role
    const adminRole = await AccountRoleEntity.findOne({
      where: { role: 'admin' },
    });

    // Cache the result
    SetupService.setupModeCache = adminRole === null;

    return SetupService.setupModeCache;
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
    // Validate password using shared utility
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      throw new Error(`Invalid password: ${passwordValidation.errors.join(', ')}`);
    }

    // Create the admin account
    const accountEntity = AccountEntity.build({
      id: uuidv4(),
      email: email,
      username: '',
    });
    await accountEntity.save();

    // Create account secrets and set password
    const accountSecretsEntity = AccountSecretsEntity.build({
      account_id: accountEntity.id,
    });
    await accountSecretsEntity.save();

    // Hash and save the password
    const salt = randomBytes(16).toString('hex');
    const hashedPassword = scryptSync(password, salt, 64).toString('hex');
    accountSecretsEntity.salt = salt;
    accountSecretsEntity.password = hashedPassword;
    await accountSecretsEntity.save();

    // Assign admin role
    const roleEntity = AccountRoleEntity.build({
      account_id: accountEntity.id,
      role: 'admin',
    });
    await roleEntity.save();

    // Save settings
    const settings = await ServiceSettings.getInstance();
    await settings.set('siteTitle', siteTitle);
    await settings.set('registrationMode', registrationMode);
    await settings.set('defaultLanguage', defaultLanguage);

    // Invalidate the setup mode cache
    SetupService.clearCache();

    return true;
  }

  /**
   * Clears the setup mode cache.
   * Should be called after admin account creation.
   */
  static clearCache(): void {
    SetupService.setupModeCache = null;
  }
}
