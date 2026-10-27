import { v4 as uuidv4 } from 'uuid';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';

import db from '@/server/common/entity/db';
import { AccountEntity, AccountRoleEntity, AccountSecretsEntity } from '@/server/common/entity/account';
import ConfigurationInterface from '@/server/configuration/interface';
import { validatePassword } from '@/common/validation/password';
import { normalizeEmail } from '@/common/validation/email';
import { SetupAlreadyCompletedError, SetupTokenInvalidError } from '@/server/setup/exceptions';
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

  /**
   * The token a setup request must carry, issued at boot while no admin
   * exists and logged for the operator. Held in memory only, so a restart
   * issues a new one; null once setup completes or when none was issued.
   */
  private static setupToken: string | null = null;

  /**
   * Tail of the in-process single-flight chain that serializes setup. The
   * deployment runs one web process, which the cache above already assumes.
   */
  private static setupChain: Promise<unknown> = Promise.resolve();

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
   * Issues a fresh setup token if no admin exists, and logs it once at warn
   * for the operator to read from the server log. Called at boot once the
   * database is ready. Replaces any earlier token; clears it when an admin
   * already exists.
   *
   * Queries the database directly rather than through isSetupModeActive(),
   * so issuing the token never populates the setup-mode cache.
   *
   * @returns The issued token, or null when setup is already complete
   */
  static async issueSetupToken(): Promise<string | null> {
    const existingAdmin = await AccountRoleEntity.findOne({ where: { role: 'admin' } });
    if (existingAdmin) {
      SetupService.setupToken = null;
      return null;
    }

    const token = randomBytes(16).toString('hex');
    SetupService.setupToken = token;
    logger.warn(
      `Setup token: ${token} — enter it on the /setup page to create the administrator account. Restarting the server issues a new token.`,
    );
    return token;
  }

  /**
   * Compares a candidate against the issued setup token in constant time.
   * The length guard runs first because timingSafeEqual throws on unequal
   * lengths; the token's length is fixed, so it reveals nothing.
   */
  private static isSetupTokenValid(candidate: unknown): boolean {
    const expected = SetupService.setupToken;
    if (expected === null || typeof candidate !== 'string') {
      return false;
    }
    const candidateBytes = Buffer.from(candidate);
    const expectedBytes = Buffer.from(expected);
    if (candidateBytes.length !== expectedBytes.length) {
      return false;
    }
    return timingSafeEqual(candidateBytes, expectedBytes);
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
   * @throws SetupTokenInvalidError if the token is missing, wrong or retired
   * @throws SetupAlreadyCompletedError if an admin account already exists
   */
  async completeSetup(
    email: string,
    password: string,
    siteTitle: string,
    registrationMode: string,
    defaultLanguage: string,
    setupToken: string,
  ): Promise<boolean> {
    // Checked first: without the token, nothing else about the request matters.
    if (!SetupService.isSetupTokenValid(setupToken)) {
      throw new SetupTokenInvalidError();
    }

    // Validate password using shared utility. Done before joining the chain
    // so a bad-password request never queues behind a real setup.
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      throw new Error(`Invalid password: ${passwordValidation.errors.join(', ')}`);
    }

    // Single-flight: setups run one at a time in this process. A failed setup
    // is swallowed on the chain so it never blocks the next attempt.
    const run = SetupService.setupChain
      .catch(() => undefined)
      .then(() => this.performSetup(email, password, siteTitle, registrationMode, defaultLanguage));
    SetupService.setupChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Creates the admin account and saves settings. Only ever runs inside the
   * single-flight chain in `completeSetup`.
   *
   * @throws SetupAlreadyCompletedError if an admin account already exists
   */
  private async performSetup(
    email: string,
    password: string,
    siteTitle: string,
    registrationMode: string,
    defaultLanguage: string,
  ): Promise<boolean> {
    // Re-check against the database, never the cached isSetupModeActive():
    // a concurrent request may have created the admin since the route's
    // pre-check populated the cache.
    const existingAdmin = await AccountRoleEntity.findOne({ where: { role: 'admin' } });
    if (existingAdmin) {
      throw new SetupAlreadyCompletedError();
    }

    // The account, its secrets row, the password and the admin role are
    // written in one transaction, so a failed write never leaves an account
    // without the admin role (which would keep setup mode open).
    await db.transaction(async (transaction) => {
      const accountEntity = AccountEntity.build({
        id: uuidv4(),
        email: normalizeEmail(email),
        username: '',
      });
      await accountEntity.save({ transaction });

      const accountSecretsEntity = AccountSecretsEntity.build({
        account_id: accountEntity.id,
      });
      await accountSecretsEntity.save({ transaction });

      const salt = randomBytes(16).toString('hex');
      const hashedPassword = scryptSync(password, salt, 64).toString('hex');
      accountSecretsEntity.salt = salt;
      accountSecretsEntity.password = hashedPassword;
      await accountSecretsEntity.save({ transaction });

      const roleEntity = AccountRoleEntity.build({
        account_id: accountEntity.id,
        role: 'admin',
      });
      await roleEntity.save({ transaction });
    });

    // Settings and the policy seed stay outside the transaction: they cross
    // into the Configuration domain, which may open its own transaction, and
    // SQLite rejects a nested BEGIN.

    // Save settings via ConfigurationInterface (respects DDD domain boundary)
    await this.configInterface.setSetting('siteTitle', siteTitle);
    await this.configInterface.setSetting('registrationMode', registrationMode);
    await this.configInterface.setSetting('defaultLanguage', defaultLanguage);

    // Seed the default instance policy from the bundled markdown stub.
    // This MUST NEVER throw or block setup completion / admin login.
    await this.seedDefaultInstancePolicy();

    // Invalidate the setup mode cache and retire the token
    SetupService.clearCache();
    SetupService.setupToken = null;

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
