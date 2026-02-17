import { PrimaryModel } from '@/common/model/model';

/**
 * Represents a complimentary grant that gives an account free access
 * to gated subscription features.
 *
 * Uses soft-delete pattern: a grant is considered revoked when revoked_at is set.
 */
class ComplimentaryGrant extends PrimaryModel {
  accountId: string = '';
  accountEmail?: string;
  expiresAt: Date | null = null;
  reason: string | null = null;
  grantedBy: string = '';
  grantedByEmail?: string;
  revokedAt: Date | null = null;
  revokedBy: string | null = null;
  createdAt?: Date;

  constructor(id?: string) {
    super(id);
  }

  /**
   * Determines if the grant is currently active.
   * A grant is active when it has not been revoked and has not expired.
   *
   * @returns {boolean} True if the grant is currently active
   */
  get isActive(): boolean {
    if (this.revokedAt !== null) {
      return false;
    }
    if (this.expiresAt !== null && this.expiresAt < new Date()) {
      return false;
    }
    return true;
  }

  /**
   * Converts the grant to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the grant
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      accountId: this.accountId,
      accountEmail: this.accountEmail,
      expiresAt: this.expiresAt,
      reason: this.reason,
      grantedBy: this.grantedBy,
      grantedByEmail: this.grantedByEmail,
      revokedAt: this.revokedAt,
      revokedBy: this.revokedBy,
      createdAt: this.createdAt,
    };
  }

  /**
   * Creates a ComplimentaryGrant from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing grant data
   * @returns {ComplimentaryGrant} A new ComplimentaryGrant instance
   */
  static fromObject(obj: Record<string, any>): ComplimentaryGrant {
    const grant = new ComplimentaryGrant(obj.id);
    grant.accountId = obj.accountId;
    grant.accountEmail = obj.accountEmail ?? undefined;
    grant.expiresAt = obj.expiresAt ?? null;
    grant.reason = obj.reason ?? null;
    grant.grantedBy = obj.grantedBy;
    grant.grantedByEmail = obj.grantedByEmail ?? undefined;
    grant.revokedAt = obj.revokedAt ?? null;
    grant.revokedBy = obj.revokedBy ?? null;
    grant.createdAt = obj.createdAt ?? undefined;
    return grant;
  }
}

export { ComplimentaryGrant };
