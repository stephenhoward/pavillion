import { PrimaryModel } from '@/common/model/model';

/**
 * Represents a blocked ActivityPub instance in the federation network.
 * Instance administrators can block domains that violate policies or
 * community standards. Blocked instances cannot federate events or interact
 * with the local instance.
 */
class BlockedInstance extends PrimaryModel {
  domain: string = '';
  reason: string = '';
  blockedAt: Date = new Date();
  blockedBy: string = '';

  /**
   * Constructor for BlockedInstance.
   *
   * @param {string} [id] - Unique identifier for the blocked instance record
   */
  constructor(id?: string) {
    super(id);
  }

  /**
   * Converts the blocked instance to a plain JavaScript object.
   * Date fields are serialized to ISO strings.
   *
   * @returns {Record<string, any>} Plain object representation
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      domain: this.domain,
      reason: this.reason,
      blockedAt: this.blockedAt.toISOString(),
      blockedBy: this.blockedBy,
    };
  }

  /**
   * Creates a BlockedInstance from a plain object.
   * Date fields are parsed from ISO strings.
   *
   * @param {Record<string, any>} obj - Plain object containing blocked instance data
   * @returns {BlockedInstance} A new BlockedInstance instance
   */
  static fromObject(obj: Record<string, any>): BlockedInstance {
    const blockedInstance = new BlockedInstance(obj.id);
    blockedInstance.domain = obj.domain ?? '';
    blockedInstance.reason = obj.reason ?? '';
    blockedInstance.blockedAt = obj.blockedAt ? new Date(obj.blockedAt) : new Date();
    blockedInstance.blockedBy = obj.blockedBy ?? '';
    return blockedInstance;
  }
}

export { BlockedInstance };
