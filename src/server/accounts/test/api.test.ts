import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import AccountRouteHandlers from '../api/v1/accounts';
import AccountInvitationRouteHandlers from '../api/v1/invitations';
import AccountApplicationRouteHandlers from '../api/v1/applications';
import AccountsInterface from '../interface';
import { Account } from '../../../common/model/account';
import { testApp, countRoutes } from '../../common/test/lib/express';
import AccountInvitation from '../../../common/model/invitation';
import AccountApiV1 from '../api/v1';

describe('API v1', () => {

  it('should load routes properly', () => {
    let app = express();
    const eventBus = new EventEmitter();
    const accountsInterface = new AccountsInterface(eventBus);
    expect(countRoutes(app)).toBe(0);
    AccountApiV1.install(app, accountsInterface);
    expect(countRoutes(app)).toBeGreaterThan(0);
  });
});

describe('Account API', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let stub: sinon.SinonStub;
  let router: express.Router;
  let accountsInterface: AccountsInterface;
  let accountHandlers: AccountRouteHandlers;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    accountsInterface = new AccountsInterface(eventBus);
    accountHandlers = new AccountRouteHandlers(accountsInterface);
    stub = sandbox.stub(accountsInterface, 'registerNewAccount');
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('register: should succeed', async () => {
    stub.resolves(new Account('id', 'testme', 'testme'));
    router.post('/handler', accountHandlers.registerHandler.bind(accountHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(200);
    expect(stub.called).toBe(true);
  });

  it('register: should fail', async () => {
    stub.resolves(undefined);
    router.post('/handler', accountHandlers.registerHandler.bind(accountHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(400);
    expect(stub.called).toBe(true);
  });

});

describe ('Invitations API', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let router: express.Router;
  let accountsInterface: AccountsInterface;
  let inviteHandlers: AccountInvitationRouteHandlers;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    accountsInterface = new AccountsInterface(eventBus);
    inviteHandlers = new AccountInvitationRouteHandlers(accountsInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('list invitations: admin should receive all invitations', async () => {
    const adminAccount = new Account('admin-id', 'admin@test.com', 'admin@test.com');
    adminAccount.roles = ['admin'];

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves([]);
    router.get('/handler', (req, res, next) => {
      req.user = adminAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(stub2.called).toBe(true);
    // Verify admin gets all invitations (inviterId = undefined)
    expect(stub2.firstCall.args[0]).toBeUndefined();
  });

  it('list invitations: regular user should receive only their own invitations', async () => {
    const regularAccount = new Account('user-id', 'user@test.com', 'user@test.com');
    regularAccount.roles = [];

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves([]);
    router.get('/handler', (req, res, next) => {
      req.user = regularAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(stub2.called).toBe(true);
    // Verify regular user gets filtered by their ID
    expect(stub2.firstCall.args[0]).toBe('user-id');
  });

  it('list invitations: should return 400 when user not authenticated', async () => {
    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves([]);
    router.get('/handler', (req, res, next) => {
      req.user = undefined;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('User not authenticated');
    expect(stub2.called).toBe(false);
  });

  it('list invitations: should filter by inviterId only', async () => {
    const mockInviterId = 'inviter-123';
    const eventBus = new EventEmitter();
    const testInterface = new AccountsInterface(eventBus);
    const serviceStub = sandbox.stub(testInterface['accountService'], 'listInvitations');
    serviceStub.resolves([]);

    const result = await testInterface.listInvitations(mockInviterId);

    expect(result).toEqual([]);
    expect(serviceStub.calledWith(mockInviterId, undefined)).toBe(true);
  });

  it('list invitations: should filter by calendarId only', async () => {
    const mockCalendarId = 'calendar-123';
    const eventBus = new EventEmitter();
    const testInterface = new AccountsInterface(eventBus);
    const serviceStub = sandbox.stub(testInterface['accountService'], 'listInvitations');
    serviceStub.resolves([]);

    const result = await testInterface.listInvitations(undefined, mockCalendarId);

    expect(result).toEqual([]);
    expect(serviceStub.calledWith(undefined, mockCalendarId)).toBe(true);
  });

  it('list invitations: should filter by both inviterId and calendarId', async () => {
    const mockInviterId = 'inviter-123';
    const mockCalendarId = 'calendar-123';
    const eventBus = new EventEmitter();
    const testInterface = new AccountsInterface(eventBus);
    const serviceStub = sandbox.stub(testInterface['accountService'], 'listInvitations');
    serviceStub.resolves([]);

    const result = await testInterface.listInvitations(mockInviterId, mockCalendarId);

    expect(result).toEqual([]);
    expect(serviceStub.calledWith(mockInviterId, mockCalendarId)).toBe(true);
  });

  it('cross-user privacy: User A cannot see User B\'s invitations', async () => {
    const userA = new Account('user-a-id', 'userA@test.com', 'userA@test.com');
    userA.roles = [];

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    // When User A requests, return empty (no invitations from User B)
    stub2.resolves([]);

    router.get('/handler', (req, res, next) => {
      req.user = userA;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    // Verify User A's ID was used for filtering, not User B's
    expect(stub2.firstCall.args[0]).toBe('user-a-id');
  });

  it('calendar owner privacy: sees only their editor invitations', async () => {
    const calendarOwner = new Account('owner-id', 'owner@test.com', 'owner@test.com');
    calendarOwner.roles = [];

    const ownInvitation = new AccountInvitation(
      'inv-own-1',
      'editor@test.com',
      calendarOwner,
    );
    ownInvitation.calendarId = 'calendar-123';

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves([ownInvitation]);

    router.get('/handler', (req, res, next) => {
      req.user = calendarOwner;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(1);
    expect(response.body[0].invitedBy.id).toBe('owner-id');
    // Verify only owner's invitations are requested
    expect(stub2.firstCall.args[0]).toBe('owner-id');
  });

  it('admin comprehensive view: can see all invitations from all users', async () => {
    const adminAccount = new Account('admin-id', 'admin@test.com', 'admin@test.com');
    adminAccount.roles = ['admin'];

    const regularUser = new Account('user-id', 'user@test.com', 'user@test.com');

    const adminInvitation = new AccountInvitation(
      'inv-admin-1',
      'admin-invitee@test.com',
      adminAccount,
    );

    const userInvitation = new AccountInvitation(
      'inv-user-1',
      'user-invitee@test.com',
      regularUser,
    );

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves([adminInvitation, userInvitation]);

    router.get('/handler', (req, res, next) => {
      req.user = adminAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(2);
    // Verify admin gets all invitations (inviterId = undefined)
    expect(stub2.firstCall.args[0]).toBeUndefined();
  });

  it('role-based filtering: admin receives undefined inviterId, regular user receives their ID', async () => {
    const adminAccount = new Account('admin-id', 'admin@test.com', 'admin@test.com');
    adminAccount.roles = ['admin'];

    const regularAccount = new Account('user-id', 'user@test.com', 'user@test.com');
    regularAccount.roles = [];

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves([]);

    // Test admin
    router.get('/admin', (req, res, next) => {
      req.user = adminAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const adminResponse = await request(testApp(router)).get('/admin');
    expect(adminResponse.status).toBe(200);
    expect(stub2.firstCall.args[0]).toBeUndefined();

    stub2.resetHistory();

    // Test regular user
    router.get('/user', (req, res, next) => {
      req.user = regularAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const userResponse = await request(testApp(router)).get('/user');
    expect(userResponse.status).toBe(200);
    expect(stub2.firstCall.args[0]).toBe('user-id');
  });

  it('invite new account: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'inviteNewAccount');
    stub2.resolves(new AccountInvitation('id', 'testme', 'testme'));
    router.post('/handler', inviteHandlers.inviteToRegister.bind(inviteHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(200);
    expect(stub2.called).toBe(true);
  });

  it('invite new account: should fail', async () => {
    let stub2 = sandbox.stub(accountsInterface,'inviteNewAccount');
    stub2.resolves(undefined);
    router.post('/handler', inviteHandlers.inviteToRegister.bind(inviteHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(400);
    expect(stub2.called).toBe(true);
  });

  it('check invite code: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'validateInviteCode');
    const mockInvitation = { invitation_code: 'test_code' } as any;
    stub2.resolves(mockInvitation);
    router.get('/handler', inviteHandlers.checkInviteCode.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('ok');
    expect(stub2.called).toBe(true);
  });

  it('check invite code: should fail', async () => {
    let stub2 = sinon.stub(accountsInterface,'validateInviteCode');
    stub2.rejects(new Error('Invalid invite'));
    router.get('/handler', inviteHandlers.checkInviteCode.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('not ok');
    expect(stub2.called).toBe(true);
  });

  it('accept invite: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'acceptAccountInvite');
    const mockResult = {
      account: new Account('id', 'testme', 'testme'),
      calendars: ['calendar1', 'calendar2'],
    };
    stub2.resolves(mockResult);
    router.post('/handler', inviteHandlers.acceptInvite.bind(inviteHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({password: 'testme'});

    expect(response.status).toBe(200);
    expect(stub2.called).toBe(true);
  });

  it('accept invite: should fail', async () => {
    let stub2 = sandbox.stub(accountsInterface,'acceptAccountInvite');
    stub2.resolves(undefined);
    router.post('/handler', inviteHandlers.acceptInvite.bind(inviteHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({password: 'testme'});

    expect(response.status).toBe(400);
    expect(stub2.called).toBe(true);
  });

  //sendNewAccountInvite (resend)
});

describe('Applications API', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let router: express.Router;
  let accountsInterface: AccountsInterface;
  let applicationHandlers: AccountApplicationRouteHandlers;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    accountsInterface = new AccountsInterface(eventBus);
    applicationHandlers = new AccountApplicationRouteHandlers(accountsInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('apply to register: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'applyForNewAccount');
    router.post('/handler', applicationHandlers.applyToRegister.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(200);
    expect(stub2.called).toBe(true);
  });

  it('list applications: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'listAccountApplications');
    stub2.resolves([]);
    router.get('/handler', applicationHandlers.listApplications.bind(applicationHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(stub2.called).toBe(true);
  });

  it('process application: should accept', async () => {
    let stub = sandbox.stub(accountsInterface,'acceptAccountApplication');
    let stub2 = sandbox.stub(accountsInterface,'rejectAccountApplication');
    router.post('/handler', applicationHandlers.processApplication.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({accepted: true});

    expect(response.status).toBe(200);
    expect(stub.called).toBe(true);
    expect(stub2.called).toBe(false);
  });

  it('process application: should reject', async () => {
    let stub = sandbox.stub(accountsInterface,'acceptAccountApplication');
    let stub2 = sandbox.stub(accountsInterface,'rejectAccountApplication');
    router.post('/handler', applicationHandlers.processApplication.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({accepted: false});

    expect(response.status).toBe(200);
    expect(stub.called).toBe(false);
    expect(stub2.called).toBe(true);
  });

  it('process application: should fail', async () => {
    let stub = sandbox.stub(accountsInterface,'acceptAccountApplication');
    let stub2 = sandbox.stub(accountsInterface,'rejectAccountApplication');
    router.post('/handler', applicationHandlers.processApplication.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({});

    expect(response.status).toBe(400);
    expect(stub.called).toBe(false);
    expect(stub2.called).toBe(false);
  });
});
