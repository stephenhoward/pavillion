import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { generateKeyPairSync } from 'crypto';

import UserActorService from '@/server/activitypub/service/user_actor';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import { AccountEntity } from '@/server/common/entity/account';
import { Account } from '@/common/model/account';
import db from '@/server/common/entity/db';

describe('UserActorService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: UserActorService;
  const testDomain = 'events.example';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    service = new UserActorService();

    // Sync database for tests that need it
    await db.sync({ force: true });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createActor', () => {
    it('should generate RSA-2048 keypair for new user', async () => {
      const accountId = uuidv4();
      const username = 'alice';

      // Create the account entity first (foreign key constraint)
      await AccountEntity.create({
        id: accountId,
        username: username,
        email: 'alice@example.com',
        domain: testDomain,
        language: 'en',
      });

      const account = new Account(accountId, username, 'alice@example.com');
      const actor = await service.createActor(account, testDomain);

      // Verify actor_uri format
      expect(actor.actorUri).toBe(`https://${testDomain}/users/${username}`);

      // Verify account_id is set
      expect(actor.accountId).toBe(accountId);

      // Verify public and private keys exist and are PEM format
      expect(actor.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
      expect(actor.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    });

    it('should use correct actor URI format', async () => {
      const accountId = uuidv4();
      const username = 'bob';

      // Create the account entity first (foreign key constraint)
      await AccountEntity.create({
        id: accountId,
        username: username,
        email: 'bob@example.com',
        domain: testDomain,
        language: 'en',
      });

      const account = new Account(accountId, username, 'bob@example.com');
      const actor = await service.createActor(account, testDomain);

      expect(actor.actorUri).toBe(`https://${testDomain}/users/${username}`);
    });
  });

  describe('getActorByUsername', () => {
    it('should return actor for existing user', async () => {
      const username = 'alice';
      const accountId = uuidv4();

      // Create an actual account and user actor
      const accountEntity = await AccountEntity.create({
        id: accountId,
        username: username,
        email: 'alice@example.com',
        domain: testDomain,
        language: 'en',
      });

      const account = accountEntity.toModel();
      const createdActor = await service.createActor(account, testDomain);

      const actor = await service.getActorByUsername(username);

      expect(actor).not.toBeNull();
      expect(actor?.actorUri).toBe(`https://${testDomain}/users/${username}`);
      expect(actor?.accountId).toBe(accountId);
    });

    it('should return null for non-existent user', async () => {
      const username = 'nonexistent';

      const actor = await service.getActorByUsername(username);

      expect(actor).toBeNull();
    });
  });

  describe('signActivity', () => {
    it('should produce valid HTTP signature format', async () => {
      const username = 'alice';
      const accountId = uuidv4();
      const actorUri = `https://${testDomain}/users/${username}`;

      // Create account and user actor
      const accountEntity = await AccountEntity.create({
        id: accountId,
        username: username,
        email: 'alice@example.com',
        domain: testDomain,
        language: 'en',
      });

      const account = accountEntity.toModel();
      await service.createActor(account, testDomain);

      const activity = {
        type: 'Create',
        actor: actorUri,
        object: { type: 'Note', content: 'Test' },
      };

      const targetUrl = 'https://remote.example/inbox';
      const signature = await service.signActivity(actorUri, activity, targetUrl);

      expect(signature).toBeDefined();
      expect(signature).toHaveProperty('keyId');
      expect(signature).toHaveProperty('signature');
      expect(signature).toHaveProperty('algorithm');
      expect(signature).toHaveProperty('headers');
      expect(signature).toHaveProperty('date');
      expect(signature.keyId).toBe(`${actorUri}#main-key`);
      expect(signature.algorithm).toBe('rsa-sha256');
      expect(typeof signature.signature).toBe('string');
      expect(signature.signature.length).toBeGreaterThan(0);
    });
  });

  describe('verifySignature', () => {
    it('should validate known signatures correctly', async () => {
      const username = 'alice';
      const accountId = uuidv4();
      const actorUri = `https://${testDomain}/users/${username}`;

      // Create account and user actor
      const accountEntity = await AccountEntity.create({
        id: accountId,
        username: username,
        email: 'alice@example.com',
        domain: testDomain,
        language: 'en',
      });

      const account = accountEntity.toModel();
      const userActor = await service.createActor(account, testDomain);

      // Create a signed request
      const targetUrl = `https://${testDomain}/inbox`;
      const activity = { type: 'Create', actor: actorUri };
      const signatureData = await service.signActivity(actorUri, activity, targetUrl);

      const mockRequest = {
        headers: {
          signature: `keyId="${signatureData.keyId}",signature="${signatureData.signature}",algorithm="${signatureData.algorithm}",headers="${signatureData.headers}"`,
          date: signatureData.date,
          host: testDomain,
        },
        method: 'POST',
        url: '/inbox',
      } as any;

      const result = await service.verifySignature(mockRequest, actorUri);

      expect(result).toBe(true);
    });

    it('should return false for invalid signature', async () => {
      const username = 'alice';
      const accountId = uuidv4();
      const actorUri = `https://${testDomain}/users/${username}`;

      // Create account and user actor
      const accountEntity = await AccountEntity.create({
        id: accountId,
        username: username,
        email: 'alice@example.com',
        domain: testDomain,
        language: 'en',
      });

      const account = accountEntity.toModel();
      await service.createActor(account, testDomain);

      const mockRequest = {
        headers: {
          signature: `keyId="${actorUri}#main-key",signature="invalid-signature",algorithm="rsa-sha256",headers="(request-target) host date"`,
          date: new Date().toUTCString(),
          host: testDomain,
        },
        method: 'POST',
        url: '/inbox',
      } as any;

      const result = await service.verifySignature(mockRequest, actorUri);

      expect(result).toBe(false);
    });
  });

  describe('getActorByAccountId', () => {
    it('should return actor for existing account', async () => {
      const accountId = uuidv4();
      const username = 'alice';

      // Create account and user actor
      const accountEntity = await AccountEntity.create({
        id: accountId,
        username: username,
        email: 'alice@example.com',
        domain: testDomain,
        language: 'en',
      });

      const account = accountEntity.toModel();
      await service.createActor(account, testDomain);

      const actor = await service.getActorByAccountId(accountId);

      expect(actor).not.toBeNull();
      expect(actor?.accountId).toBe(accountId);
      expect(actor?.actorUri).toBe(`https://${testDomain}/users/${username}`);
    });

    it('should return null for non-existent account', async () => {
      const nonExistentAccountId = uuidv4();

      const actor = await service.getActorByAccountId(nonExistentAccountId);

      expect(actor).toBeNull();
    });
  });
});
