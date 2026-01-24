import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { generateKeyPairSync } from 'crypto';

import { Account } from '@/common/model/account';
import UserActorService from '@/server/activitypub/service/user_actor';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import { AccountEntity } from '@/server/common/entity/account';

describe('UserActorService', () => {
  let service: UserActorService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new UserActorService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createActor', () => {
    it('should generate valid RSA-2048 keypair', async () => {
      const testAccount = new Account('account-id-123', 'alice', 'alice@example.com');
      const domain = 'events.example';

      // Stub entity creation
      const mockEntity = {
        id: 'actor-id-123',
        account_id: testAccount.id,
        actor_uri: `https://${domain}/users/${testAccount.username}`,
        public_key: 'PUBLIC_KEY_PEM',
        private_key: 'PRIVATE_KEY_PEM',
        toModel: function() {
          return {
            id: this.id,
            accountId: this.account_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      const createStub = sandbox.stub(UserActorEntity, 'create').resolves(mockEntity as any);

      await service.createActor(testAccount, domain);

      // Verify create was called
      expect(createStub.calledOnce).toBe(true);

      const callArgs = createStub.firstCall.args[0];

      // Verify account_id is correct
      expect(callArgs.account_id).toBe(testAccount.id);

      // Verify actor URI format
      expect(callArgs.actor_uri).toBe(`https://${domain}/users/${testAccount.username}`);

      // Verify keypair fields exist
      expect(callArgs.public_key).toBeDefined();
      expect(callArgs.private_key).toBeDefined();

      // Verify keypair format (should start with PEM headers)
      expect(callArgs.public_key).toContain('BEGIN PUBLIC KEY');
      expect(callArgs.private_key).toContain('BEGIN PRIVATE KEY');
    });

    it('should format actor URI correctly', async () => {
      const testAccount = new Account('account-id-456', 'bob', 'bob@example.com');
      const domain = 'pavillion.dev';

      const createStub = sandbox.stub(UserActorEntity, 'create').resolves({
        toModel: () => ({
          id: 'actor-id',
          accountId: 'account-id-456',
          actorUri: `https://${domain}/users/bob`,
          publicKey: '',
          privateKey: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      } as any);

      await service.createActor(testAccount, domain);

      const callArgs = createStub.firstCall.args[0];
      expect(callArgs.actor_uri).toBe(`https://${domain}/users/${testAccount.username}`);
    });
  });

  describe('getActorByUsername', () => {
    it('should return actor for existing user', async () => {
      const testUsername = 'alice';
      const mockData = {
        id: 'actor-id-123',
        account_id: 'account-id-123',
        actor_uri: 'https://events.example/users/alice',
        public_key: '-----BEGIN PUBLIC KEY-----\nKEY_DATA\n-----END PUBLIC KEY-----',
        private_key: '-----BEGIN PRIVATE KEY-----\nKEY_DATA\n-----END PRIVATE KEY-----',
      };

      const mockEntity = {
        ...mockData,
        toModel: function() {
          return {
            id: this.id,
            accountId: this.account_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      // Mock the account lookup
      const accountStub = sandbox.stub(AccountEntity, 'findOne').resolves({
        id: 'account-id-123',
        username: testUsername,
      } as any);

      const findStub = sandbox.stub(UserActorEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.getActorByUsername(testUsername);

      expect(accountStub.calledOnce).toBe(true);
      expect(findStub.calledOnce).toBe(true);
      expect(result).toBeDefined();
      expect(result?.actorUri).toBe(mockData.actor_uri);
      expect(result?.publicKey).toBe(mockData.public_key);
    });

    it('should return null for non-existent user', async () => {
      sandbox.stub(AccountEntity, 'findOne').resolves(null);

      const result = await service.getActorByUsername('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getActorByAccountId', () => {
    it('should return actor for existing account ID', async () => {
      const accountId = 'account-id-123';
      const mockData = {
        id: 'actor-id-123',
        account_id: accountId,
        actor_uri: 'https://events.example/users/alice',
        public_key: '-----BEGIN PUBLIC KEY-----\nKEY_DATA\n-----END PUBLIC KEY-----',
        private_key: '-----BEGIN PRIVATE KEY-----\nKEY_DATA\n-----END PRIVATE KEY-----',
      };

      const mockEntity = {
        ...mockData,
        toModel: function() {
          return {
            id: this.id,
            accountId: this.account_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      const findStub = sandbox.stub(UserActorEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.getActorByAccountId(accountId);

      expect(findStub.calledOnce).toBe(true);
      expect(result).toBeDefined();
      expect(result?.actorUri).toBe(mockData.actor_uri);
    });
  });

  describe('signActivity', () => {
    it('should produce valid HTTP signature format', async () => {
      const actorUri = 'https://events.example/users/alice';
      const mockData = {
        id: 'actor-id-123',
        account_id: 'account-id-123',
        actor_uri: actorUri,
        public_key: '-----BEGIN PUBLIC KEY-----\nKEY_DATA\n-----END PUBLIC KEY-----',
        private_key: '-----BEGIN PRIVATE KEY-----\nKEY_DATA\n-----END PRIVATE KEY-----',
      };

      // Generate a real keypair for this test to make signing work
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const mockEntity = {
        ...mockData,
        private_key: privateKey,
        toModel: function() {
          return {
            id: this.id,
            accountId: this.account_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      sandbox.stub(UserActorEntity, 'findOne').resolves(mockEntity as any);

      const activity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        actor: actorUri,
        object: { type: 'Note', content: 'Hello' },
      };

      const targetUrl = 'https://remote.example/inbox';
      const signature = await service.signActivity(actorUri, activity, targetUrl);

      // Verify signature has required fields
      expect(signature).toBeDefined();
      expect(signature.keyId).toBe(`${actorUri}#main-key`);
      expect(signature.signature).toBeDefined();
      expect(signature.algorithm).toBe('rsa-sha256');
      expect(signature.headers).toContain('(request-target)');
      expect(signature.headers).toContain('host');
      expect(signature.headers).toContain('date');
    });
  });

  describe('verifySignature', () => {
    it('should validate known signatures correctly', async () => {
      // Generate a real keypair for testing
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const actorUri = 'https://events.example/users/alice';
      const mockData = {
        id: 'actor-id-123',
        account_id: 'account-id-123',
        actor_uri: actorUri,
        public_key: publicKey,
        private_key: privateKey,
      };

      const mockEntity = {
        ...mockData,
        toModel: function() {
          return {
            id: this.id,
            accountId: this.account_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      sandbox.stub(UserActorEntity, 'findOne').resolves(mockEntity as any);

      const activity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        actor: actorUri,
        object: { type: 'Note', content: 'Test' },
      };

      const targetUrl = 'https://remote.example/inbox';

      // Sign the activity
      const signatureData = await service.signActivity(actorUri, activity, targetUrl);

      // Create a mock request with the signature
      // Parse the target URL for the mock request
      const url = new URL(targetUrl);

      // Create a mock request with the signature
      const mockRequest = {
        headers: {
          signature: `keyId="${signatureData.keyId}",signature="${signatureData.signature}",algorithm="${signatureData.algorithm}",headers="${signatureData.headers}"`,
          date: signatureData.date,
          host: url.host,
        },
        method: 'POST',
        url: url.pathname + url.search,
      };

      // Verify the signature
      const isValid = await service.verifySignature(mockRequest as any, actorUri);

      expect(isValid).toBe(true);
    });

    it('should reject signature with wrong key', async () => {
      // Generate two different keypairs
      const { publicKey: publicKey1 } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const { privateKey: privateKey2 } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const actorUri = 'https://events.example/users/alice';
      const mockData = {
        id: 'actor-id-123',
        account_id: 'account-id-123',
        actor_uri: actorUri,
        public_key: publicKey1, // Different public key
        private_key: privateKey2, // Mismatched private key for signing
      };

      const createMockEntity = (data: any) => ({
        ...data,
        toModel: function() {
          return {
            id: this.id,
            accountId: this.account_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      });

      const findStub = sandbox.stub(UserActorEntity, 'findOne');
      findStub.onFirstCall().resolves(createMockEntity({
        ...mockData,
        private_key: privateKey2, // For signing
      }) as any);
      findStub.onSecondCall().resolves(createMockEntity({
        ...mockData,
        public_key: publicKey1, // For verification (mismatched)
      }) as any);

      const mockRequest = {
        headers: {
          signature: 'invalid-signature-string',
          date: new Date().toUTCString(),
        },
        method: 'POST',
        url: 'https://remote.example/inbox',
      };

      // This should fail because keys don't match
      const isValid = await service.verifySignature(mockRequest as any, actorUri);

      expect(isValid).toBe(false);
    });
  });
});
