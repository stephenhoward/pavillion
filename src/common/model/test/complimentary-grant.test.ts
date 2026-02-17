import { describe, it, expect } from 'vitest';

import { ComplimentaryGrant } from '@/common/model/complimentary_grant';

describe('ComplimentaryGrant Model', () => {

  describe('constructor and properties', () => {

    it('should create a ComplimentaryGrant with default values', () => {
      const grant = new ComplimentaryGrant('grant-1');

      expect(grant.id).toBe('grant-1');
      expect(grant.accountId).toBe('');
      expect(grant.expiresAt).toBeNull();
      expect(grant.reason).toBeNull();
      expect(grant.grantedBy).toBe('');
      expect(grant.revokedAt).toBeNull();
      expect(grant.revokedBy).toBeNull();
    });

    it('should create a ComplimentaryGrant without an id', () => {
      const grant = new ComplimentaryGrant();

      expect(grant.id).toBe('');
    });
  });

  describe('isActive', () => {

    it('should return true for an active grant with no expiration', () => {
      const grant = new ComplimentaryGrant('grant-1');
      grant.accountId = 'account-1';
      grant.grantedBy = 'admin-1';
      grant.revokedAt = null;
      grant.expiresAt = null;

      expect(grant.isActive).toBe(true);
    });

    it('should return true for an active grant with a future expiration', () => {
      const grant = new ComplimentaryGrant('grant-2');
      grant.accountId = 'account-1';
      grant.grantedBy = 'admin-1';
      grant.revokedAt = null;

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      grant.expiresAt = futureDate;

      expect(grant.isActive).toBe(true);
    });

    it('should return false for a revoked grant', () => {
      const grant = new ComplimentaryGrant('grant-3');
      grant.accountId = 'account-1';
      grant.grantedBy = 'admin-1';
      grant.revokedAt = new Date('2024-01-01');
      grant.revokedBy = 'admin-2';
      grant.expiresAt = null;

      expect(grant.isActive).toBe(false);
    });

    it('should return false for an expired grant (not revoked)', () => {
      const grant = new ComplimentaryGrant('grant-4');
      grant.accountId = 'account-1';
      grant.grantedBy = 'admin-1';
      grant.revokedAt = null;

      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);
      grant.expiresAt = pastDate;

      expect(grant.isActive).toBe(false);
    });

    it('should return false for a revoked grant that has not expired', () => {
      const grant = new ComplimentaryGrant('grant-5');
      grant.accountId = 'account-1';
      grant.grantedBy = 'admin-1';
      grant.revokedAt = new Date('2024-06-01');
      grant.revokedBy = 'admin-2';

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      grant.expiresAt = futureDate;

      expect(grant.isActive).toBe(false);
    });

    it('should return false for a revoked grant that has also expired', () => {
      const grant = new ComplimentaryGrant('grant-6');
      grant.accountId = 'account-1';
      grant.grantedBy = 'admin-1';
      grant.revokedAt = new Date('2023-01-01');
      grant.revokedBy = 'admin-2';

      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);
      grant.expiresAt = pastDate;

      expect(grant.isActive).toBe(false);
    });
  });

  describe('toObject() serialization', () => {

    it('should serialize all properties to a plain object', () => {
      const grant = new ComplimentaryGrant('grant-1');
      grant.accountId = 'account-abc';
      grant.reason = 'Test reason';
      grant.grantedBy = 'admin-xyz';

      const futureDate = new Date('2027-01-01');
      grant.expiresAt = futureDate;

      const obj = grant.toObject();

      expect(obj.id).toBe('grant-1');
      expect(obj.accountId).toBe('account-abc');
      expect(obj.reason).toBe('Test reason');
      expect(obj.grantedBy).toBe('admin-xyz');
      expect(obj.expiresAt).toBe(futureDate);
      expect(obj.revokedAt).toBeNull();
      expect(obj.revokedBy).toBeNull();
    });

    it('should serialize null date fields correctly', () => {
      const grant = new ComplimentaryGrant('grant-2');
      grant.accountId = 'account-1';
      grant.grantedBy = 'admin-1';

      const obj = grant.toObject();

      expect(obj.expiresAt).toBeNull();
      expect(obj.revokedAt).toBeNull();
      expect(obj.revokedBy).toBeNull();
      expect(obj.reason).toBeNull();
    });

    it('should serialize revoked grant with all revocation fields', () => {
      const grant = new ComplimentaryGrant('grant-3');
      grant.accountId = 'account-1';
      grant.grantedBy = 'admin-1';
      const revokedDate = new Date('2025-06-15');
      grant.revokedAt = revokedDate;
      grant.revokedBy = 'admin-2';

      const obj = grant.toObject();

      expect(obj.revokedAt).toBe(revokedDate);
      expect(obj.revokedBy).toBe('admin-2');
    });
  });

  describe('fromObject() deserialization', () => {

    it('should deserialize a plain object into a ComplimentaryGrant', () => {
      const expiresAt = new Date('2027-12-31');
      const obj = {
        id: 'grant-1',
        accountId: 'account-abc',
        expiresAt,
        reason: 'Test reason',
        grantedBy: 'admin-xyz',
        revokedAt: null,
        revokedBy: null,
      };

      const grant = ComplimentaryGrant.fromObject(obj);

      expect(grant.id).toBe('grant-1');
      expect(grant.accountId).toBe('account-abc');
      expect(grant.expiresAt).toBe(expiresAt);
      expect(grant.reason).toBe('Test reason');
      expect(grant.grantedBy).toBe('admin-xyz');
      expect(grant.revokedAt).toBeNull();
      expect(grant.revokedBy).toBeNull();
    });

    it('should default optional fields to null when not provided', () => {
      const obj = {
        id: 'grant-2',
        accountId: 'account-1',
        grantedBy: 'admin-1',
      };

      const grant = ComplimentaryGrant.fromObject(obj);

      expect(grant.expiresAt).toBeNull();
      expect(grant.reason).toBeNull();
      expect(grant.revokedAt).toBeNull();
      expect(grant.revokedBy).toBeNull();
    });

    it('should deserialize a revoked grant with all revocation fields', () => {
      const revokedAt = new Date('2025-03-20');
      const obj = {
        id: 'grant-3',
        accountId: 'account-1',
        grantedBy: 'admin-1',
        revokedAt,
        revokedBy: 'admin-2',
      };

      const grant = ComplimentaryGrant.fromObject(obj);

      expect(grant.revokedAt).toBe(revokedAt);
      expect(grant.revokedBy).toBe('admin-2');
      expect(grant.isActive).toBe(false);
    });

    it('should round-trip correctly through toObject and fromObject', () => {
      const original = new ComplimentaryGrant('grant-rt');
      original.accountId = 'account-rt';
      original.reason = 'Round-trip test';
      original.grantedBy = 'admin-rt';
      const futureDate = new Date('2028-06-01');
      original.expiresAt = futureDate;

      const obj = original.toObject();
      const restored = ComplimentaryGrant.fromObject(obj);

      expect(restored.id).toBe(original.id);
      expect(restored.accountId).toBe(original.accountId);
      expect(restored.reason).toBe(original.reason);
      expect(restored.grantedBy).toBe(original.grantedBy);
      expect(restored.expiresAt).toBe(original.expiresAt);
      expect(restored.revokedAt).toBeNull();
      expect(restored.revokedBy).toBeNull();
      expect(restored.isActive).toBe(true);
    });
  });
});
