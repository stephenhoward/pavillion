import { v4 as uuidv4 } from 'uuid';
import { scryptSync, randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';

import { AccountEntity, AccountRoleEntity, AccountSecretsEntity } from '@/server/common/entity/account';
import ConfigurationInterface from '@/server/configuration/interface';
import { validatePassword } from '@/common/validation/password';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('setup');

const DEFAULT_INSTANCE_POLICY_PATH = 'config/defaults/instance-policy.en.md';

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

  private readonly configInterface: ConfigurationInterface;

  constructor(configInterface: ConfigurationInterface) {
    this.configInterface = configInterface;
  }

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

    // Save settings via ConfigurationInterface (respects DDD domain boundary)
    await this.configInterface.setSetting('siteTitle', siteTitle);
    await this.configInterface.setSetting('registrationMode', registrationMode);
    await this.configInterface.setSetting('defaultLanguage', defaultLanguage);

    // Seed the default instance policy from the bundled markdown stub.
    // This MUST NEVER throw or block setup completion / admin login.
    await this.seedDefaultInstancePolicy();

    // Invalidate the setup mode cache
    SetupService.clearCache();

    return true;
  }

  /**
   * Seeds the default instance policy on first-run setup if no policy has
   * been configured for any language yet.
   *
   * Idempotent: the skip-condition (any non-empty policy row exists) means
   * this method can be invoked repeatedly without overwriting operator
   * edits. A missing or unreadable default file is logged as a warning and
   * setup proceeds without seeding.
   *
   * Sanitization: the raw markdown source is passed to
   * `setInstancePolicy`, which dry-renders the value through
   * `isPolicySourceSafe` (marked + DOMPurify) and rejects dangerous
   * input rather than silently downgrading it. Safe markdown is
   * persisted as-is — render-to-HTML happens at view time on the public
   * /policy page, not at save time.
   *
   * Defensive contract: this method MUST NEVER throw, MUST NEVER block
   * setup completion, and MUST NEVER block admin login. All errors are
   * caught and logged.
   */
  async seedDefaultInstancePolicy(): Promise<void> {
    try {
      // Skip-condition: if any language already has a non-empty policy,
      // the operator has either configured it or a previous seeding ran.
      // Either way, do not overwrite.
      const existingPolicies = await this.configInterface.getInstancePolicy();
      const hasAnyPolicy = Object.values(existingPolicies).some(
        (value) => typeof value === 'string' && value !== '',
      );
      if (hasAnyPolicy) {
        return;
      }

      // Path is intentionally hardcoded relative to process.cwd(); the
      // default file ships with the application repository.
      const filePath = path.join(process.cwd(), DEFAULT_INSTANCE_POLICY_PATH);
      let markdownSource: string;
      try {
        markdownSource = await readFile(filePath, 'utf-8');
      }
      catch (err) {
        // A missing or unreadable default file is acceptable — setup
        // proceeds without seeding. Never throw, never block.
        logger.warn(
          { path: filePath, err },
          'Default instance policy file unavailable; skipping seed',
        );
        return;
      }

      // Pass raw markdown to setInstancePolicy. The configuration service
      // dry-renders via isPolicySourceSafe and rejects dangerous input;
      // safe markdown is persisted as-is and rendered at view time.
      await this.configInterface.setInstancePolicy({ en: markdownSource });
    }
    catch (err) {
      // Last-resort safety net. The seed hook must never block setup
      // completion or admin login under any circumstance.
      logger.warn({ err }, 'Failed to seed default instance policy');
    }
  }

  /**
   * Clears the setup mode cache.
   * Should be called after admin account creation.
   */
  static clearCache(): void {
    SetupService.setupModeCache = null;
  }
}
