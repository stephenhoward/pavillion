import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { generateKeyPairSync } from 'crypto';

import { Account } from '@/common/model/account';
import UserActorService from '@/server/activitypub/service/user_actor';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import { AccountEntity } from '@/server/common/entity/account';
import RemoteCalendarService from '@/server/activitypub/service/remote_calendar';
import CalendarInterface from '@/server/calendar/interface';

describe('UserActorService', () => {
  let service: UserActorService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new UserActorService({} as CalendarInterface);
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
    /**
     * Helper to create a mock actor entity with a real RSA keypair
     */
    function createMockActorWithKeypair(actorUri: string) {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      return {
        id: 'actor-id-123',
        account_id: 'account-id-123',
        actor_uri: actorUri,
        public_key: publicKey,
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
    }

    it('should produce valid HTTP signature format', async () => {
      const actorUri = 'https://events.example/users/alice';
      const mockEntity = createMockActorWithKeypair(actorUri);

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
      expect(signature.headers).toBe('(request-target) host date');
    });

    it('should include digest in signed headers when digest is provided', async () => {
      const actorUri = 'https://events.example/users/alice';
      const mockEntity = createMockActorWithKeypair(actorUri);

      sandbox.stub(UserActorEntity, 'findOne').resolves(mockEntity as any);

      const activity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        actor: actorUri,
        object: { type: 'Note', content: 'Hello' },
      };

      const targetUrl = 'https://remote.example/inbox';
      const digest = 'SHA-256=abc123digest';
      const signature = await service.signActivity(actorUri, activity, targetUrl, digest);

      // Verify digest is included in the headers list
      expect(signature.headers).toBe('(request-target) host date digest');
      // Signature should still be valid
      expect(signature.signature).toBeDefined();
      expect(signature.keyId).toBe(`${actorUri}#main-key`);
    });

    it('should not include digest in signed headers when digest is omitted', async () => {
      const actorUri = 'https://events.example/users/alice';
      const mockEntity = createMockActorWithKeypair(actorUri);

      sandbox.stub(UserActorEntity, 'findOne').resolves(mockEntity as any);

      const activity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Follow',
        actor: actorUri,
        object: 'https://remote.example/calendars/events',
      };

      const targetUrl = 'https://remote.example/inbox';
      const signature = await service.signActivity(actorUri, activity, targetUrl);

      // Verify digest is NOT in the headers list
      expect(signature.headers).toBe('(request-target) host date');
      expect(signature.headers).not.toContain('digest');
    });
  });

  describe('processRemoveActivity', () => {
    const LOCAL_USERNAME = 'alice';
    const LOCAL_ACCOUNT_ID = 'account-id-alice';
    const LOCAL_ACTOR_URI = 'https://events.example/users/alice';
    const REMOTE_CALENDAR_URI = 'https://remote.example/calendars/test';
    const REMOTE_CALENDAR_ACTOR_ID = 'remote-calendar-actor-id';

    let calendarInterfaceStub: { removeRemoteEditorAccess: sinon.SinonStub };

    beforeEach(() => {
      calendarInterfaceStub = {
        removeRemoteEditorAccess: sinon.stub().resolves(true),
      };
      service = new UserActorService(calendarInterfaceStub as unknown as CalendarInterface);
    });

    function stubLookups(overrides: {
      userActor?: any;
      account?: any;
      remoteCalendarActor?: any;
    } = {}): void {
      // getActorByUsername queries AccountEntity then UserActorEntity
      sandbox.stub(AccountEntity, 'findOne').callsFake(async (options: any) => {
        // First call: from getActorByUsername({ where: { username } })
        // Second call: from processRemoveActivity({ where: { username } })
        // Both return the same account row.
        if (options?.where?.username === LOCAL_USERNAME) {
          return overrides.account === undefined
            ? ({ id: LOCAL_ACCOUNT_ID, username: LOCAL_USERNAME } as any)
            : overrides.account;
        }
        return null;
      });

      const userActorEntity = overrides.userActor === undefined
        ? {
          toModel: () => ({
            id: 'user-actor-id',
            accountId: LOCAL_ACCOUNT_ID,
            actorUri: LOCAL_ACTOR_URI,
            publicKey: 'pk',
            privateKey: 'sk',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        }
        : overrides.userActor;
      sandbox.stub(UserActorEntity, 'findOne').resolves(userActorEntity as any);

      const remoteCalendarActor = overrides.remoteCalendarActor === undefined
        ? { id: REMOTE_CALENDAR_ACTOR_ID, actorUri: REMOTE_CALENDAR_URI }
        : overrides.remoteCalendarActor;
      sandbox.stub(RemoteCalendarService.prototype, 'getByActorUri').resolves(remoteCalendarActor as any);
    }

    it('prunes the remote-calendar membership via CalendarInterface', async () => {
      stubLookups();

      const activity = {
        type: 'Remove',
        actor: REMOTE_CALENDAR_URI,
        object: LOCAL_ACTOR_URI,
        target: `${REMOTE_CALENDAR_URI}/editors`,
      };

      const result = await service.processRemoveActivity(LOCAL_USERNAME, activity);

      expect(result).toBe(true);
      expect(calendarInterfaceStub.removeRemoteEditorAccess.calledOnce).toBe(true);
      const [accountIdArg, calendarActorIdArg] = calendarInterfaceStub.removeRemoteEditorAccess.firstCall.args;
      expect(accountIdArg).toBe(LOCAL_ACCOUNT_ID);
      expect(calendarActorIdArg).toBe(REMOTE_CALENDAR_ACTOR_ID);
    });

    it('returns false and does not prune when activity type is not Remove', async () => {
      const activity = {
        type: 'Delete',
        actor: REMOTE_CALENDAR_URI,
        object: LOCAL_ACTOR_URI,
      };

      const result = await service.processRemoveActivity(LOCAL_USERNAME, activity);

      expect(result).toBe(false);
      expect(calendarInterfaceStub.removeRemoteEditorAccess.called).toBe(false);
    });

    it('returns false and does not prune when actor URI is missing', async () => {
      stubLookups();

      const activity = {
        type: 'Remove',
        actor: undefined,
        object: LOCAL_ACTOR_URI,
      };

      const result = await service.processRemoveActivity(LOCAL_USERNAME, activity);

      expect(result).toBe(false);
      expect(calendarInterfaceStub.removeRemoteEditorAccess.called).toBe(false);
    });

    it('returns false when no remote calendar actor is known for the activity actor URI', async () => {
      stubLookups({ remoteCalendarActor: null });

      const activity = {
        type: 'Remove',
        actor: REMOTE_CALENDAR_URI,
        object: LOCAL_ACTOR_URI,
      };

      const result = await service.processRemoveActivity(LOCAL_USERNAME, activity);

      expect(result).toBe(false);
      expect(calendarInterfaceStub.removeRemoteEditorAccess.called).toBe(false);
    });
  });
});
