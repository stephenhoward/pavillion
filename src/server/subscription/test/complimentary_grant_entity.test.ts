import { describe, test, expect, beforeEach } from 'vitest';
import { ComplimentaryGrantEntity } from '@/server/subscription/entity/complimentary_grant';

describe('ComplimentaryGrantEntity', () => {
  let sampleData: any;

  beforeEach(() => {
    sampleData = {
      id: 'grant-123',
      account_id: 'account-456',
      expires_at: new Date('2024-12-31'),
      reason: 'Beta tester reward',
      granted_by: 'admin-789',
      revoked_at: null,
      revoked_by: null,
      created_at: new Date('2024-01-01'),
    };
  });

  test('creates entity with all fields', () => {
    const entity = ComplimentaryGrantEntity.build(sampleData);

    expect(entity.id).toBe(sampleData.id);
    expect(entity.account_id).toBe(sampleData.account_id);
    expect(entity.expires_at).toEqual(sampleData.expires_at);
    expect(entity.reason).toBe(sampleData.reason);
    expect(entity.granted_by).toBe(sampleData.granted_by);
    expect(entity.revoked_at).toBeNull();
    expect(entity.revoked_by).toBeNull();
    expect(entity.created_at).toEqual(sampleData.created_at);
  });

  test('creates entity with null optional fields', () => {
    const minimalData = {
      id: 'grant-123',
      account_id: 'account-456',
      expires_at: null,
      reason: null,
      granted_by: 'admin-789',
      revoked_at: null,
      revoked_by: null,
      created_at: new Date('2024-01-01'),
    };

    const entity = ComplimentaryGrantEntity.build(minimalData);

    expect(entity.id).toBe(minimalData.id);
    expect(entity.account_id).toBe(minimalData.account_id);
    expect(entity.expires_at).toBeNull();
    expect(entity.reason).toBeNull();
    expect(entity.revoked_at).toBeNull();
    expect(entity.revoked_by).toBeNull();
  });

  test('handles revoked grant with revoked_at and revoked_by', () => {
    const revokedData = {
      ...sampleData,
      revoked_at: new Date('2024-06-15'),
      revoked_by: 'admin-999',
    };

    const entity = ComplimentaryGrantEntity.build(revokedData);

    expect(entity.revoked_at).toEqual(revokedData.revoked_at);
    expect(entity.revoked_by).toBe(revokedData.revoked_by);
  });

  test('converts entity to model correctly', () => {
    const entity = ComplimentaryGrantEntity.build(sampleData);
    const model = entity.toModel();

    expect(model.id).toBe(sampleData.id);
    expect(model.accountId).toBe(sampleData.account_id);
    expect(model.expiresAt).toEqual(sampleData.expires_at);
    expect(model.reason).toBe(sampleData.reason);
    expect(model.grantedBy).toBe(sampleData.granted_by);
    expect(model.revokedAt).toBeNull();
    expect(model.revokedBy).toBeNull();
  });

  test('creates entity from model correctly', () => {
    // Create a minimal model object structure since the actual model doesn't exist yet
    const modelData = {
      id: 'grant-123',
      accountId: 'account-456',
      expiresAt: new Date('2024-12-31'),
      reason: 'Beta tester reward',
      grantedBy: 'admin-789',
      revokedAt: null,
      revokedBy: null,
    };

    const entity = ComplimentaryGrantEntity.fromModel(modelData as any);

    expect(entity.id).toBe(modelData.id);
    expect(entity.account_id).toBe(modelData.accountId);
    expect(entity.expires_at).toEqual(modelData.expiresAt);
    expect(entity.reason).toBe(modelData.reason);
    expect(entity.granted_by).toBe(modelData.grantedBy);
    expect(entity.revoked_at).toBeNull();
    expect(entity.revoked_by).toBeNull();
  });

  test('round-trip conversion preserves data integrity', () => {
    const originalData = {
      id: 'grant-123',
      accountId: 'account-456',
      expiresAt: new Date('2024-12-31'),
      reason: 'Beta tester reward',
      grantedBy: 'admin-789',
      revokedAt: null,
      revokedBy: null,
    };

    // Model -> Entity
    const entity = ComplimentaryGrantEntity.fromModel(originalData as any);

    // Entity -> Model
    const convertedModel = entity.toModel();

    expect(convertedModel.id).toBe(originalData.id);
    expect(convertedModel.accountId).toBe(originalData.accountId);
    expect(convertedModel.expiresAt).toEqual(originalData.expiresAt);
    expect(convertedModel.reason).toBe(originalData.reason);
    expect(convertedModel.grantedBy).toBe(originalData.grantedBy);
    expect(convertedModel.revokedAt).toBeNull();
    expect(convertedModel.revokedBy).toBeNull();
  });

  test('converts revoked grant to model correctly', () => {
    const revokedData = {
      ...sampleData,
      revoked_at: new Date('2024-06-15'),
      revoked_by: 'admin-999',
    };

    const entity = ComplimentaryGrantEntity.build(revokedData);
    const model = entity.toModel();

    expect(model.revokedAt).toEqual(revokedData.revoked_at);
    expect(model.revokedBy).toBe(revokedData.revoked_by);
  });
});
