import { PrimaryModel } from '@/common/model/model';

/**
 * Represents a blocked reporter email in the moderation system.
 * Administrators can block email addresses (stored as hashes) to prevent
 * abusive reporters from submitting new event reports.
 */
class BlockedReporter extends PrimaryModel {
  emailHash: string = '';
  blockedBy: string = '';
  reason: string = '';
  createdAt: Date = new Date();

  /**
   * Constructor for BlockedReporter.
   *
   * @param {string} [id] - Unique identifier for the blocked reporter record
   */
  constructor(id?: string) {
    super(id);
  }

  /**
   * Converts the blocked reporter to a plain JavaScript object.
   * Date fields are serialized to ISO strings.
   *
   * @returns {Record<string, any>} Plain object representation
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      emailHash: this.emailHash,
      blockedBy: this.blockedBy,
      reason: this.reason,
      createdAt: this.createdAt.toISOString(),
    };
  }

  /**
   * Creates a BlockedReporter from a plain object.
   * Date fields are parsed from ISO strings.
   *
   * @param {Record<string, any>} obj - Plain object containing blocked reporter data
   * @returns {BlockedReporter} A new BlockedReporter instance
   */
  static fromObject(obj: Record<string, any>): BlockedReporter {
    const blockedReporter = new BlockedReporter(obj.id);
    blockedReporter.emailHash = obj.emailHash ?? '';
    blockedReporter.blockedBy = obj.blockedBy ?? '';
    blockedReporter.reason = obj.reason ?? '';
    blockedReporter.createdAt = obj.createdAt ? new Date(obj.createdAt) : new Date();
    return blockedReporter;
  }
}

export { BlockedReporter };
