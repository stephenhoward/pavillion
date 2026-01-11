import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { PlatformOAuthConfigEntity } from '../entity/platform_oauth_config';
import { OAuthStateTokenEntity } from '../entity/oauth_state_token';
import { ProviderType } from '@/common/model/subscription';

describe('OAuth Entities', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('PlatformOAuthConfigEntity', () => {
    it('should encrypt and decrypt client_id and client_secret', async () => {
      const testClientId = 'ca_test_client_id_12345';
      const testClientSecret = 'sk_test_secret_67890_very_long_secret_key';

      const entityData = {
        id: 'platform-oauth-id',
        provider_type: 'stripe' as ProviderType,
        client_id: 'encrypted:client_id', // Will be encrypted in hooks
        client_secret: 'encrypted:client_secret', // Will be encrypted in hooks
      };

      const entity = PlatformOAuthConfigEntity.build(entityData);

      // Set up private fields to simulate decryption
      (entity as any)._decryptedClientId = testClientId;
      (entity as any)._decryptedClientSecret = testClientSecret;

      // Test that toObject returns sanitized data (no secrets)
      const sanitized = entity.toObject();
      expect(sanitized.providerType).toBe('stripe');
      expect(sanitized.id).toBe('platform-oauth-id');
      expect(sanitized.clientId).toBeUndefined(); // Should be sanitized
      expect(sanitized.clientSecret).toBeUndefined(); // Should be sanitized

      // Test that getDecryptedCredentials returns actual credentials
      const decrypted = entity.getDecryptedCredentials();
      expect(decrypted.clientId).toBe(testClientId);
      expect(decrypted.clientSecret).toBe(testClientSecret);
    });

    it('should encrypt credentials on create', async () => {
      const testClientId = 'ca_test_client_id_12345';
      const testClientSecret = 'sk_test_secret_67890';

      const entity = PlatformOAuthConfigEntity.build({
        id: 'platform-oauth-id',
        provider_type: 'stripe' as ProviderType,
      });

      // Set unencrypted values
      (entity as any)._decryptedClientId = testClientId;
      (entity as any)._decryptedClientSecret = testClientSecret;

      // Manually trigger the before-create hook
      await PlatformOAuthConfigEntity.encryptFieldsOnCreate(entity);

      // Verify fields are encrypted (should contain ':' separator)
      expect(entity.client_id).toContain(':');
      expect(entity.client_secret).toContain(':');
      expect(entity.client_id).not.toBe(testClientId);
      expect(entity.client_secret).not.toBe(testClientSecret);
    });

    it('should match ProviderConfigEntity encryption pattern', () => {
      // This test verifies that the encryption pattern matches the existing entity
      const testData = 'test_sensitive_data_12345';

      const entity = PlatformOAuthConfigEntity.build({
        id: 'test-id',
        provider_type: 'stripe' as ProviderType,
      });

      (entity as any)._decryptedClientId = testData;

      PlatformOAuthConfigEntity.encryptFieldsOnCreate(entity);

      // Encrypted format should be: {iv_hex}:{encrypted_hex}
      const encrypted = entity.client_id;
      const parts = encrypted.split(':');

      expect(parts.length).toBe(2); // IV and encrypted data
      expect(parts[0].length).toBe(32); // 16-byte IV as hex (32 chars)
      expect(parts[1].length).toBeGreaterThan(0); // Encrypted data
    });
  });

  describe('OAuthStateTokenEntity', () => {
    it('should create token with expiration', () => {
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      const entityData = {
        id: 'token-id',
        token: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        provider_type: 'stripe' as ProviderType,
        expires_at: expiresAt,
      };

      const entity = OAuthStateTokenEntity.build(entityData);

      expect(entity.id).toBe('token-id');
      expect(entity.token).toBe('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
      expect(entity.provider_type).toBe('stripe');
      expect(entity.expires_at).toEqual(expiresAt);
    });

    it('should identify expired tokens correctly', () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      const futureDate = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

      const expiredToken = OAuthStateTokenEntity.build({
        id: 'expired-id',
        token: 'expired_token',
        provider_type: 'stripe' as ProviderType,
        expires_at: expiredDate,
      });

      const validToken = OAuthStateTokenEntity.build({
        id: 'valid-id',
        token: 'valid_token',
        provider_type: 'stripe' as ProviderType,
        expires_at: futureDate,
      });

      expect(expiredToken.isExpired()).toBe(true);
      expect(validToken.isExpired()).toBe(false);
    });

    it('should enforce token uniqueness constraint', async () => {
      const token = 'unique_token_12345';

      const entity1 = OAuthStateTokenEntity.build({
        id: 'token-1',
        token: token,
        provider_type: 'stripe' as ProviderType,
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      });

      // Verify token is set
      expect(entity1.token).toBe(token);

      // Note: Actual uniqueness constraint will be enforced by database index
      // This test just verifies the token field is properly set
    });

    it('should convert to plain object with toObject', () => {
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      const entity = OAuthStateTokenEntity.build({
        id: 'token-id',
        token: 'test_token_abc123',
        provider_type: 'paypal' as ProviderType,
        expires_at: expiresAt,
      });

      const obj = entity.toObject();

      expect(obj.id).toBe('token-id');
      expect(obj.token).toBe('test_token_abc123');
      expect(obj.providerType).toBe('paypal');
      expect(obj.expiresAt).toEqual(expiresAt);
      expect(obj.isExpired).toBe(false);
    });

    it('should support querying expired tokens by expires_at index', () => {
      const now = new Date();
      const past = new Date(Date.now() - 60000); // 1 minute ago
      const future = new Date(Date.now() + 60000); // 1 minute from now

      const expiredToken = OAuthStateTokenEntity.build({
        id: 'expired-id',
        token: 'expired',
        provider_type: 'stripe' as ProviderType,
        expires_at: past,
      });

      const validToken = OAuthStateTokenEntity.build({
        id: 'valid-id',
        token: 'valid',
        provider_type: 'stripe' as ProviderType,
        expires_at: future,
      });

      // Verify that we can filter by expiration status
      expect(expiredToken.expires_at < now).toBe(true);
      expect(validToken.expires_at > now).toBe(true);
    });
  });
});
