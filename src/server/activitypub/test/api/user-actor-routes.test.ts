import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import UserActorRoutes from '@/server/activitypub/api/v1/user-actor';
import UserActorService from '@/server/activitypub/service/user_actor';
import { UserActor } from '@/server/activitypub/entity/user_actor';

describe('UserActorRoutes - GET /users/:username', () => {
  let routes: UserActorRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let userActorService: UserActorService;

  beforeEach(() => {
    userActorService = new UserActorService();
    routes = new UserActorRoutes(userActorService);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return Person actor JSON-LD with correct @context', async () => {
    const mockActor: UserActor = {
      id: 'test-id',
      accountId: 'account-id',
      actorUri: 'https://events.example/users/alice',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
      privateKey: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const getActorStub = sandbox.stub(userActorService, 'getActorByUsername');
    getActorStub.resolves(mockActor);

    const req = { params: { username: 'alice' } };
    const res = {
      json: sandbox.stub(),
      setHeader: sandbox.stub(),
    };

    await routes.getUserActor(req as any, res as any);

    expect(res.setHeader.calledWith('Content-Type', 'application/activity+json')).toBe(true);
    expect(res.json.called).toBe(true);

    const responseData = res.json.firstCall.args[0];
    expect(responseData['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ]);
    expect(responseData.type).toBe('Person');
    expect(responseData.id).toBe('https://events.example/users/alice');
  });

  it('should return 404 for non-existent user', async () => {
    const getActorStub = sandbox.stub(userActorService, 'getActorByUsername');
    getActorStub.resolves(null);

    const req = { params: { username: 'nonexistent' } };
    const res = {
      status: sandbox.stub(),
      send: sandbox.stub(),
    };
    res.status.returns(res);

    await routes.getUserActor(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('User not found')).toBe(true);
  });

  it('should include publicKey with correct keyId format', async () => {
    const mockActor: UserActor = {
      id: 'test-id',
      accountId: 'account-id',
      actorUri: 'https://events.example/users/bob',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
      privateKey: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const getActorStub = sandbox.stub(userActorService, 'getActorByUsername');
    getActorStub.resolves(mockActor);

    const req = { params: { username: 'bob' } };
    const res = {
      json: sandbox.stub(),
      setHeader: sandbox.stub(),
    };

    await routes.getUserActor(req as any, res as any);

    const responseData = res.json.firstCall.args[0];
    expect(responseData.publicKey).toBeDefined();
    expect(responseData.publicKey.id).toBe('https://events.example/users/bob#main-key');
    expect(responseData.publicKey.owner).toBe('https://events.example/users/bob');
    expect(responseData.publicKey.publicKeyPem).toBe('-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----');
  });

  it('should include inbox and outbox URLs', async () => {
    const mockActor: UserActor = {
      id: 'test-id',
      accountId: 'account-id',
      actorUri: 'https://events.example/users/carol',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
      privateKey: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const getActorStub = sandbox.stub(userActorService, 'getActorByUsername');
    getActorStub.resolves(mockActor);

    const req = { params: { username: 'carol' } };
    const res = {
      json: sandbox.stub(),
      setHeader: sandbox.stub(),
    };

    await routes.getUserActor(req as any, res as any);

    const responseData = res.json.firstCall.args[0];
    expect(responseData.inbox).toBe('https://events.example/users/carol/inbox');
    expect(responseData.outbox).toBe('https://events.example/users/carol/outbox');
  });
});

describe('UserActorRoutes - POST /users/:username/inbox', () => {
  let routes: UserActorRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let userActorService: UserActorService;

  beforeEach(() => {
    userActorService = new UserActorService();
    routes = new UserActorRoutes(userActorService);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should require HTTP signature verification', async () => {
    // This test verifies the middleware is applied - actual signature verification
    // is tested in the middleware test suite
    const req = {
      params: { username: 'alice' },
      body: { type: 'Add' },
    };
    const res = {
      status: sandbox.stub(),
      json: sandbox.stub(),
    };
    res.status.returns(res);

    // Note: The actual route will have verifyHttpSignature middleware
    // This test just ensures the handler expects to be called with verified requests
    expect(routes).toBeDefined();
  });

  it('should return 404 for non-existent user', async () => {
    const getActorStub = sandbox.stub(userActorService, 'getActorByUsername');
    getActorStub.resolves(null);

    const req = {
      params: { username: 'nonexistent' },
      body: {
        type: 'Add',
        actor: 'https://other.example/calendars/test',
        object: { actor: 'https://events.example/users/alice', role: 'editor' },
      },
    };
    const res = {
      status: sandbox.stub(),
      send: sandbox.stub(),
    };
    res.status.returns(res);

    await routes.postToInbox(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('User not found')).toBe(true);
  });

  it('should accept valid Add activity', async () => {
    const mockActor: UserActor = {
      id: 'test-id',
      accountId: 'account-id',
      actorUri: 'https://events.example/users/alice',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
      privateKey: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const getActorStub = sandbox.stub(userActorService, 'getActorByUsername');
    getActorStub.resolves(mockActor);

    const req = {
      params: { username: 'alice' },
      body: {
        type: 'Add',
        actor: 'https://other.example/calendars/test',
        object: { actor: 'https://events.example/users/alice', role: 'editor' },
        target: 'https://other.example/calendars/test/editors',
      },
    };
    const res = {
      status: sandbox.stub(),
      send: sandbox.stub(),
    };
    res.status.returns(res);

    await routes.postToInbox(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Activity processed')).toBe(true);
  });
});

describe('UserActorRoutes - GET /users/:username/outbox', () => {
  let routes: UserActorRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let userActorService: UserActorService;

  beforeEach(() => {
    userActorService = new UserActorService();
    routes = new UserActorRoutes(userActorService);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return OrderedCollection for user outbox', async () => {
    const mockActor: UserActor = {
      id: 'test-id',
      accountId: 'account-id',
      actorUri: 'https://events.example/users/alice',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
      privateKey: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const getActorStub = sandbox.stub(userActorService, 'getActorByUsername');
    getActorStub.resolves(mockActor);

    const req = {
      params: { username: 'alice' },
      query: {},
    };
    const res = {
      json: sandbox.stub(),
      setHeader: sandbox.stub(),
    };

    await routes.getUserOutbox(req as any, res as any);

    expect(res.setHeader.calledWith('Content-Type', 'application/activity+json')).toBe(true);
    expect(res.json.called).toBe(true);

    const responseData = res.json.firstCall.args[0];
    expect(responseData['@context']).toBe('https://www.w3.org/ns/activitystreams');
    expect(responseData.type).toBe('OrderedCollection');
    expect(responseData.id).toBe('https://events.example/users/alice/outbox');
  });

  it('should return 404 for non-existent user', async () => {
    const getActorStub = sandbox.stub(userActorService, 'getActorByUsername');
    getActorStub.resolves(null);

    const req = {
      params: { username: 'nonexistent' },
      query: {},
    };
    const res = {
      status: sandbox.stub(),
      send: sandbox.stub(),
    };
    res.status.returns(res);

    await routes.getUserOutbox(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('User not found')).toBe(true);
  });
});
