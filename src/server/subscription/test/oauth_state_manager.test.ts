import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { Op } from 'sequelize';
import db from '@/server/common/entity/db';
import { OAuthStateManager } from '../service/oauth_state_manager';
import { OAuthStateTokenEntity } from '../entity/oauth_state_token';
import { ProviderType } from '@/common/model/subscription';

describe('OAuthStateManager Service', () => {
  const sandbox = sinon.createSandbox();
  let manager: OAuthStateManager;

  beforeAll(async () => {
    // Sync database schema before running tests
    await db.sync({ force: true });
  });

  beforeEach(async () => {
    manager = new OAuthStateManager();
    // Clear database between tests
    await db.sync({ force: true });
  });

  afterEach(async () => {
    sandbox.restore();
  });

  describe('generateToken', () => {
    it('should generate unique cryptographic token strings', async () => {
      const token1 = await manager.generateToken('stripe' as ProviderType);
      const token2 = await manager.generateToken('stripe' as ProviderType);

      // Tokens should be 64-character hex strings (32 bytes)
      expect(token1).toMatch(/^[a-f0-9]{64}$/);
      expect(token2).toMatch(/^[a-f0-9]{64}$/);

      // Tokens should be unique
      expect(token1).not.toBe(token2);
    });

    it('should create token with 15-minute expiration', async () => {
      const beforeGeneration = new Date();
      const token = await manager.generateToken('paypal' as ProviderType);
      const afterGeneration = new Date();

      // Retrieve the token from database
      const entity = await OAuthStateTokenEntity.findOne({ where: { token } });
      expect(entity).not.toBeNull();

      if (!entity) return;

      // Check expiration is approximately 15 minutes from now
      const expirationTime = entity.expires_at.getTime();
      const expectedMin = beforeGeneration.getTime() + (15 * 60 * 1000);
      const expectedMax = afterGeneration.getTime() + (15 * 60 * 1000);

      expect(expirationTime).toBeGreaterThanOrEqual(expectedMin);
      expect(expirationTime).toBeLessThanOrEqual(expectedMax);
    });

    it('should store provider type with token', async () => {
      const token = await manager.generateToken('stripe' as ProviderType);

      const entity = await OAuthStateTokenEntity.findOne({ where: { token } });
      expect(entity).not.toBeNull();
      expect(entity?.provider_type).toBe('stripe');
    });
  });

  describe('validateToken', () => {
    it('should correctly identify valid tokens', async () => {
      const token = await manager.generateToken('stripe' as ProviderType);

      const result = await manager.validateToken(token, 'stripe' as ProviderType);

      expect(result).toBe(true);
    });

    it('should reject invalid tokens', async () => {
      const invalidToken = 'invalid_token_that_does_not_exist_in_database_1234567890abcdef';

      const result = await manager.validateToken(invalidToken, 'stripe' as ProviderType);

      expect(result).toBe(false);
    });

    it('should reject expired tokens', async () => {
      // Create an expired token
      const token = 'expired_token_1234567890abcdef1234567890abcdef1234567890abcdef12';
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago

      await OAuthStateTokenEntity.create({
        id: 'test-expired-id',
        token,
        provider_type: 'stripe' as ProviderType,
        expires_at: expiredDate,
      });

      const result = await manager.validateToken(token, 'stripe' as ProviderType);

      expect(result).toBe(false);
    });

    it('should reject tokens with mismatched provider type', async () => {
      const token = await manager.generateToken('stripe' as ProviderType);

      // Try to validate with wrong provider type
      const result = await manager.validateToken(token, 'paypal' as ProviderType);

      expect(result).toBe(false);
    });

    it('should delete token after successful validation (single use)', async () => {
      const token = await manager.generateToken('paypal' as ProviderType);

      // First validation should succeed
      const result1 = await manager.validateToken(token, 'paypal' as ProviderType);
      expect(result1).toBe(true);

      // Token should be deleted from database
      const entity = await OAuthStateTokenEntity.findOne({ where: { token } });
      expect(entity).toBeNull();

      // Second validation should fail (token no longer exists)
      const result2 = await manager.validateToken(token, 'paypal' as ProviderType);
      expect(result2).toBe(false);
    });
  });

  describe('cleanupExpired', () => {
    it('should remove expired tokens from database', async () => {
      // Create some expired tokens
      const expiredDate = new Date(Date.now() - 60000); // 1 minute ago

      await OAuthStateTokenEntity.create({
        id: 'expired-1',
        token: 'expired_token_1_' + 'a'.repeat(48),
        provider_type: 'stripe' as ProviderType,
        expires_at: expiredDate,
      });

      await OAuthStateTokenEntity.create({
        id: 'expired-2',
        token: 'expired_token_2_' + 'b'.repeat(48),
        provider_type: 'paypal' as ProviderType,
        expires_at: expiredDate,
      });

      // Create a valid token
      await manager.generateToken('stripe' as ProviderType);

      // Cleanup expired tokens
      const deletedCount = await manager.cleanupExpired();

      expect(deletedCount).toBe(2);

      // Verify expired tokens are deleted (using proper Sequelize operators)
      const expiredTokens = await OAuthStateTokenEntity.findAll({
        where: {
          expires_at: {
            [Op.lt]: new Date()
          }
        },
      });

      expect(expiredTokens.length).toBe(0);

      // Verify valid token still exists
      const validTokens = await OAuthStateTokenEntity.findAll({
        where: {
          expires_at: {
            [Op.gt]: new Date()
          }
        },
      });

      expect(validTokens.length).toBe(1);
    });

    it('should return 0 when no expired tokens exist', async () => {
      // Create only valid tokens
      await manager.generateToken('stripe' as ProviderType);
      await manager.generateToken('paypal' as ProviderType);

      const deletedCount = await manager.cleanupExpired();

      expect(deletedCount).toBe(0);
    });
  });
});
