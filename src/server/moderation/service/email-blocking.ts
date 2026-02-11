import { createHmac } from 'crypto';
import config from 'config';
import { BlockedReporterEntity } from '@/server/moderation/entity/blocked_reporter';
import { BlockedReporter } from '@/common/model/blocked_reporter';
import { Account } from '@/common/model/account';

/**
 * Service for managing email blocking in the moderation system.
 *
 * Provides functionality to block/unblock reporter email addresses,
 * check if an email is blocked, and list all blocked reporters.
 * Email addresses are stored as HMAC-SHA256 hashes for privacy.
 */
class EmailBlockingService {
  /**
   * Checks if an email hash is blocked.
   *
   * @param emailHash - The hashed email address to check
   * @returns True if the email is blocked, false otherwise
   */
  async isEmailBlocked(emailHash: string): Promise<boolean> {
    const blockedReporter = await BlockedReporterEntity.findOne({
      where: { email_hash: emailHash },
    });

    return blockedReporter !== null;
  }

  /**
   * Blocks a reporter email address.
   *
   * Creates a BlockedReporter record with the hashed email,
   * admin who performed the block, and reason for blocking.
   *
   * @param email - The reporter's email address (will be hashed)
   * @param adminAccount - The admin account performing the block
   * @param reason - Reason for blocking the reporter
   * @returns The created BlockedReporter domain model
   */
  async blockReporter(
    email: string,
    adminAccount: Account,
    reason: string,
  ): Promise<BlockedReporter> {
    const emailHash = this.hashEmail(email);

    const entity = await BlockedReporterEntity.create({
      email_hash: emailHash,
      blocked_by: adminAccount.id,
      reason,
      created_at: new Date(),
    });

    return entity.toModel();
  }

  /**
   * Unblocks a reporter email address.
   *
   * Removes the BlockedReporter record for the given email hash.
   * This operation is idempotent - if the email is not blocked,
   * no error is thrown.
   *
   * @param emailHash - The hashed email address to unblock
   */
  async unblockReporter(emailHash: string): Promise<void> {
    await BlockedReporterEntity.destroy({
      where: { email_hash: emailHash },
    });
  }

  /**
   * Lists all blocked reporters.
   *
   * Returns all BlockedReporter records ordered by creation date
   * descending (newest first).
   *
   * @returns Array of BlockedReporter domain models
   */
  async listBlockedReporters(): Promise<BlockedReporter[]> {
    const entities = await BlockedReporterEntity.findAll({
      order: [['created_at', 'DESC']],
    });

    return entities.map(entity => entity.toModel());
  }

  /**
   * Hashes an email address using HMAC-SHA256.
   *
   * Email addresses are normalized (trimmed and lowercased) before hashing
   * to ensure consistent hashes for the same email address regardless of
   * formatting differences.
   *
   * Uses the configured secret from moderation.emailHashSecret.
   *
   * @param email - The email address to hash
   * @returns The HMAC-SHA256 hash as a hex string
   */
  hashEmail(email: string): string {
    const secret = config.get<string>('moderation.emailHashSecret');
    return createHmac('sha256', secret)
      .update(email.toLowerCase().trim())
      .digest('hex');
  }
}

export default EmailBlockingService;
