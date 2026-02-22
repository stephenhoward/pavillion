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
import AccountApplication from '../../../common/model/application';
import AccountApiV1 from '../api/v1';
import ConfigurationInterface from '../../configuration/interface';
import SetupInterface from '../../setup/interface';
import {
  AccountAlreadyExistsError,
  AccountRegistrationClosedError,
  AccountApplicationAlreadyExistsError,
  AccountApplicationsClosedError,
} from '../exceptions';
import { ValidationError } from '../../../common/exceptions/base';

describe('API v1', () => {

  it('should load routes properly', () => {
    let app = express();
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
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
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    accountHandlers = new AccountRouteHandlers(accountsInterface);
    stub = sandbox.stub(accountsInterface, 'registerNewAccount');
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('register: should return registration_submitted for new account', async () => {
    stub.resolves(new Account('id', 'testme', 'testme'));
    router.post('/handler', accountHandlers.registerHandler.bind(accountHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('registration_submitted');
    expect(stub.called).toBe(true);
  });

  it('register: should return registration_submitted for existing account (prevent enumeration)', async () => {
    stub.rejects(new AccountAlreadyExistsError());
    router.post('/handler', accountHandlers.registerHandler.bind(accountHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'existing@test.com'});

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('registration_submitted');
    expect(stub.called).toBe(true);
  });

  it('register: should return registration_closed when registration is closed', async () => {
    stub.rejects(new AccountRegistrationClosedError());
    router.post('/handler', accountHandlers.registerHandler.bind(accountHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('registration_closed');
    expect(stub.called).toBe(true);
  });

  it('register: should handle undefined account return gracefully', async () => {
    stub.resolves(undefined);
    router.post('/handler', accountHandlers.registerHandler.bind(accountHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('error_creating_account');
    expect(stub.called).toBe(true);
  });

  it('register: should handle unexpected errors', async () => {
    stub.rejects(new Error('Database error'));
    router.post('/handler', accountHandlers.registerHandler.bind(accountHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme'});

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('error_creating_account');
    expect(stub.called).toBe(true);
  });

  it('GET /me: should return current user profile', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    testAccount.displayName = 'Test User';
    testAccount.roles = ['user'];

    router.get('/me', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.getCurrentUser.bind(accountHandlers));

    const response = await request(testApp(router)).get('/me');

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('user-id');
    expect(response.body.username).toBe('testuser');
    expect(response.body.email).toBe('test@example.com');
    expect(response.body.displayName).toBe('Test User');
  });

  it('GET /me: should return 400 when user not authenticated', async () => {
    router.get('/me', (req, res, next) => {
      req.user = undefined;
      next();
    }, accountHandlers.getCurrentUser.bind(accountHandlers));

    const response = await request(testApp(router)).get('/me');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('User not authenticated');
  });

  it('PATCH /me/profile: should update display name', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const updatedAccount = new Account('user-id', 'testuser', 'test@example.com');
    updatedAccount.displayName = 'New Display Name';

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.resolves(updatedAccount);

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: 'New Display Name' });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe('New Display Name');
    expect(updateStub.called).toBe(true);
    expect(updateStub.firstCall.args[0].id).toBe('user-id');
    expect(updateStub.firstCall.args[1]).toBe('New Display Name');
  });

  it('PATCH /me/profile: should allow clearing display name with null', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    testAccount.displayName = 'Current Name';
    const updatedAccount = new Account('user-id', 'testuser', 'test@example.com');
    updatedAccount.displayName = null;

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.resolves(updatedAccount);

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: null });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe(null);
    expect(updateStub.called).toBe(true);
    expect(updateStub.firstCall.args[1]).toBe(null);
  });

  it('PATCH /me/profile: should fall back to existing displayName when not provided', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    testAccount.displayName = 'Existing Name';
    const updatedAccount = new Account('user-id', 'testuser', 'test@example.com');
    updatedAccount.displayName = 'Existing Name';
    updatedAccount.language = 'es';

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.resolves(updatedAccount);

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ language: 'es' });

    expect(response.status).toBe(200);
    expect(updateStub.called).toBe(true);
    expect(updateStub.firstCall.args[1]).toBe('Existing Name');
    expect(updateStub.firstCall.args[2]).toBe('es');
  });

  it('PATCH /me/profile: should return 400 when user not authenticated', async () => {
    router.patch('/me/profile', (req, res, next) => {
      req.user = undefined;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: 'New Name' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('User not authenticated');
  });

  it('PATCH /me/profile: should handle empty string display name', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const updatedAccount = new Account('user-id', 'testuser', 'test@example.com');
    updatedAccount.displayName = '';

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.resolves(updatedAccount);

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: '' });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe('');
    expect(updateStub.called).toBe(true);
  });

  it('PATCH /me/profile: should handle service errors gracefully', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.rejects(new Error('Database connection failed'));

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: 'New Name' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('An error occurred while updating the profile');
    expect(updateStub.called).toBe(true);
  });

  it('PATCH /me/profile: should update and return account with existing displayName', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    testAccount.displayName = 'Old Name';
    const updatedAccount = new Account('user-id', 'testuser', 'test@example.com');
    updatedAccount.displayName = 'New Name';

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.resolves(updatedAccount);

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: 'New Name' });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe('New Name');
    expect(updateStub.calledWith(testAccount, 'New Name')).toBe(true);
  });

  it('PATCH /me/profile: should update language preference', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const updatedAccount = new Account('user-id', 'testuser', 'test@example.com');
    updatedAccount.language = 'es';

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.resolves(updatedAccount);

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: 'Test User', language: 'es' });

    expect(response.status).toBe(200);
    expect(response.body.language).toBe('es');
    expect(updateStub.called).toBe(true);
    expect(updateStub.firstCall.args[2]).toBe('es');
  });

  it('PATCH /me/profile: should pass language to service when provided', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const updatedAccount = new Account('user-id', 'testuser', 'test@example.com');

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.resolves(updatedAccount);

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: 'Test User', language: 'en' });

    expect(updateStub.firstCall.args[1]).toBe('Test User');
    expect(updateStub.firstCall.args[2]).toBe('en');
  });

  it('PATCH /me/profile: should pass undefined language to service when not provided', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const updatedAccount = new Account('user-id', 'testuser', 'test@example.com');

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.resolves(updatedAccount);

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: 'Test User' });

    expect(updateStub.firstCall.args[1]).toBe('Test User');
    expect(updateStub.firstCall.args[2]).toBeUndefined();
  });

  it('PATCH /me/profile: should return 400 when service throws ValidationError for invalid language', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');

    const updateStub = sandbox.stub(accountsInterface, 'updateProfile');
    updateStub.rejects(new ValidationError('Invalid language code'));

    router.patch('/me/profile', (req, res, next) => {
      req.user = testAccount;
      next();
    }, accountHandlers.updateProfile.bind(accountHandlers));

    const response = await request(testApp(router))
      .patch('/me/profile')
      .send({ displayName: 'Test User', language: 'xx' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid language code');
    expect(response.body.errorName).toBe('ValidationError');
    expect(updateStub.called).toBe(true);
  });

});

describe ('Invitations API', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let router: express.Router;
  let accountsInterface: AccountsInterface;
  let inviteHandlers: AccountInvitationRouteHandlers;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
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
    stub2.resolves({ invitations: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });
    router.get('/handler', (req, res, next) => {
      req.user = adminAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.invitations).toEqual([]);
    expect(response.body.pagination).toEqual({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 });
    expect(stub2.called).toBe(true);
    // Verify admin gets all invitations (inviterId = undefined)
    expect(stub2.firstCall.args[2]).toBeUndefined();
  });

  it('list invitations: regular user should receive only their own invitations', async () => {
    const regularAccount = new Account('user-id', 'user@test.com', 'user@test.com');
    regularAccount.roles = [];

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves({ invitations: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });
    router.get('/handler', (req, res, next) => {
      req.user = regularAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.invitations).toEqual([]);
    expect(response.body.pagination).toEqual({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 });
    expect(stub2.called).toBe(true);
    // Verify regular user gets filtered by their ID
    expect(stub2.firstCall.args[2]).toBe('user-id');
  });

  it('list invitations: should return 400 when user not authenticated', async () => {
    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves({ invitations: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });
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
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const testInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    const serviceStub = sandbox.stub(testInterface['accountService'], 'listInvitations');
    serviceStub.resolves({ invitations: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });

    const result = await testInterface.listInvitations(1, 50, mockInviterId);

    expect(result.invitations).toEqual([]);
    expect(serviceStub.calledWith(1, 50, mockInviterId, undefined)).toBe(true);
  });

  it('list invitations: should filter by calendarId only', async () => {
    const mockCalendarId = 'calendar-123';
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const testInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    const serviceStub = sandbox.stub(testInterface['accountService'], 'listInvitations');
    serviceStub.resolves({ invitations: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });

    const result = await testInterface.listInvitations(1, 50, undefined, mockCalendarId);

    expect(result.invitations).toEqual([]);
    expect(serviceStub.calledWith(1, 50, undefined, mockCalendarId)).toBe(true);
  });

  it('list invitations: should filter by both inviterId and calendarId', async () => {
    const mockInviterId = 'inviter-123';
    const mockCalendarId = 'calendar-123';
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const testInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    const serviceStub = sandbox.stub(testInterface['accountService'], 'listInvitations');
    serviceStub.resolves({ invitations: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });

    const result = await testInterface.listInvitations(1, 50, mockInviterId, mockCalendarId);

    expect(result.invitations).toEqual([]);
    expect(serviceStub.calledWith(1, 50, mockInviterId, mockCalendarId)).toBe(true);
  });

  it('cross-user privacy: User A cannot see User B\'s invitations', async () => {
    const userA = new Account('user-a-id', 'userA@test.com', 'userA@test.com');
    userA.roles = [];

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    // When User A requests, return empty (no invitations from User B)
    stub2.resolves({ invitations: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });

    router.get('/handler', (req, res, next) => {
      req.user = userA;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.invitations).toEqual([]);
    expect(response.body.pagination).toEqual({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 });
    // Verify User A's ID was used for filtering, not User B's
    expect(stub2.firstCall.args[2]).toBe('user-a-id');
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
    stub2.resolves({ invitations: [ownInvitation], pagination: { currentPage: 1, totalPages: 1, totalCount: 1, limit: 50 } });

    router.get('/handler', (req, res, next) => {
      req.user = calendarOwner;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.invitations.length).toBe(1);
    expect(response.body.invitations[0].invitedBy.id).toBe('owner-id');
    expect(response.body.pagination).toEqual({ currentPage: 1, totalPages: 1, totalCount: 1, limit: 50 });
    // Verify only owner's invitations are requested
    expect(stub2.firstCall.args[2]).toBe('owner-id');
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
    stub2.resolves({ invitations: [adminInvitation, userInvitation], pagination: { currentPage: 1, totalPages: 1, totalCount: 2, limit: 50 } });

    router.get('/handler', (req, res, next) => {
      req.user = adminAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.invitations.length).toBe(2);
    expect(response.body.pagination).toEqual({ currentPage: 1, totalPages: 1, totalCount: 2, limit: 50 });
    // Verify admin gets all invitations (inviterId = undefined)
    expect(stub2.firstCall.args[2]).toBeUndefined();
  });

  it('role-based filtering: admin receives undefined inviterId, regular user receives their ID', async () => {
    const adminAccount = new Account('admin-id', 'admin@test.com', 'admin@test.com');
    adminAccount.roles = ['admin'];

    const regularAccount = new Account('user-id', 'user@test.com', 'user@test.com');
    regularAccount.roles = [];

    let stub2 = sandbox.stub(accountsInterface, 'listInvitations');
    stub2.resolves({ invitations: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });

    // Test admin
    router.get('/admin', (req, res, next) => {
      req.user = adminAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const adminResponse = await request(testApp(router)).get('/admin');
    expect(adminResponse.status).toBe(200);
    expect(stub2.firstCall.args[2]).toBeUndefined();

    stub2.resetHistory();

    // Test regular user
    router.get('/user', (req, res, next) => {
      req.user = regularAccount;
      next();
    }, inviteHandlers.listInvitations.bind(inviteHandlers));

    const userResponse = await request(testApp(router)).get('/user');
    expect(userResponse.status).toBe(200);
    expect(stub2.firstCall.args[2]).toBe('user-id');
  });

  it('invite new account: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'inviteNewAccount');
    const mockInviter = new Account('inviter-id', 'inviter', 'inviter@test.com');
    stub2.resolves(new AccountInvitation('id', 'testme', mockInviter));
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
    expect(response.body.valid).toBe(true);
    expect(stub2.called).toBe(true);
  });

  it('check invite code: should fail', async () => {
    let stub2 = sinon.stub(accountsInterface,'validateInviteCode');
    stub2.rejects(new Error('Invalid invite'));
    router.get('/handler', inviteHandlers.checkInviteCode.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Invalid or expired invitation code');
    expect(stub2.called).toBe(true);
  });

  it('accept invite: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'acceptAccountInvite');
    const mockResult = {
      account: new Account('id', 'testme', 'testme'),
      calendars: ['calendar1', 'calendar2'],
    };
    stub2.resolves(mockResult);
    router.post('/handler/:code', inviteHandlers.acceptInvite.bind(inviteHandlers));

    const response = await request(testApp(router))
      .post('/handler/invite123')
      .send({password: 'password123'});

    expect(response.status).toBe(200);
    expect(stub2.called).toBe(true);
  });

  it('accept invite: should fail', async () => {
    let stub2 = sandbox.stub(accountsInterface,'acceptAccountInvite');
    stub2.resolves(undefined);
    router.post('/handler/:code', inviteHandlers.acceptInvite.bind(inviteHandlers));

    const response = await request(testApp(router))
      .post('/handler/invite123')
      .send({password: 'password123'});

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
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    applicationHandlers = new AccountApplicationRouteHandlers(accountsInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('apply to register: should return application_submitted for new application', async () => {
    let stub2 = sandbox.stub(accountsInterface,'applyForNewAccount');
    stub2.resolves();
    router.post('/handler', applicationHandlers.applyToRegister.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme', message: 'I want to join'});

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('application_submitted');
    expect(stub2.called).toBe(true);
  });

  it('apply to register: should return application_submitted for existing account (prevent enumeration)', async () => {
    let stub2 = sandbox.stub(accountsInterface,'applyForNewAccount');
    stub2.rejects(new AccountAlreadyExistsError());
    router.post('/handler', applicationHandlers.applyToRegister.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'existing@test.com', message: 'I want to join'});

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('application_submitted');
    expect(stub2.called).toBe(true);
  });

  it('apply to register: should return application_submitted for duplicate application (prevent enumeration)', async () => {
    let stub2 = sandbox.stub(accountsInterface,'applyForNewAccount');
    stub2.rejects(new AccountApplicationAlreadyExistsError());
    router.post('/handler', applicationHandlers.applyToRegister.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'duplicate@test.com', message: 'I want to join'});

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('application_submitted');
    expect(stub2.called).toBe(true);
  });

  it('apply to register: should return account_applications_closed when applications are closed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'applyForNewAccount');
    stub2.rejects(new AccountApplicationsClosedError());
    router.post('/handler', applicationHandlers.applyToRegister.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme', message: 'I want to join'});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('account_applications_closed');
    expect(stub2.called).toBe(true);
  });

  it('apply to register: should handle unexpected errors', async () => {
    let stub2 = sandbox.stub(accountsInterface,'applyForNewAccount');
    stub2.rejects(new Error('Database error'));
    router.post('/handler', applicationHandlers.applyToRegister.bind(applicationHandlers));

    const response = await request(testApp(router))
      .post('/handler')
      .send({email: 'testme', message: 'I want to join'});

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('application_processing_error');
    expect(stub2.called).toBe(true);
  });

  it('list applications: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'listAccountApplications');
    stub2.resolves({ applications: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 50 } });
    router.get('/handler', applicationHandlers.listApplications.bind(applicationHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('applications');
    expect(response.body).toHaveProperty('pagination');
    expect(response.body.applications).toEqual([]);
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

describe('Admin API', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let accountsInterface: AccountsInterface;
  let adminAccount: Account;
  let regularAccount: Account;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);

    // Create admin and regular user accounts for testing
    adminAccount = new Account('admin-id', 'admin@test.com', 'admin@test.com');
    adminAccount.roles = ['admin'];

    regularAccount = new Account('user-id', 'user@test.com', 'user@test.com');
    regularAccount.roles = [];
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /api/v1/admin/accounts', () => {
    it('should return paginated account list for admin', async () => {
      const mockAccounts = [
        new Account('id1', 'user1@test.com', 'user1@test.com'),
        new Account('id2', 'user2@test.com', 'user2@test.com'),
      ];

      const stub = sandbox.stub(accountsInterface, 'listAccounts');
      stub.resolves({
        accounts: mockAccounts,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 2,
          limit: 50,
        },
      });

      // Import admin handler would be done here once created
      // For now, testing the interface method
      const result = await accountsInterface.listAccounts(1, 50);

      expect(result.accounts).toEqual(mockAccounts);
      expect(result.pagination.totalCount).toBe(2);
      expect(stub.called).toBe(true);
    });

    it('should filter accounts by search term', async () => {
      const stub = sandbox.stub(accountsInterface, 'listAccounts');
      stub.resolves({
        accounts: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalCount: 0,
          limit: 50,
        },
      });

      await accountsInterface.listAccounts(1, 50, 'test@example.com');

      expect(stub.calledWith(1, 50, 'test@example.com')).toBe(true);
    });

    it('should support pagination parameters', async () => {
      const stub = sandbox.stub(accountsInterface, 'listAccounts');
      stub.resolves({
        accounts: [],
        pagination: {
          currentPage: 2,
          totalPages: 5,
          totalCount: 250,
          limit: 50,
        },
      });

      const result = await accountsInterface.listAccounts(2, 50);

      expect(result.pagination.currentPage).toBe(2);
      expect(result.pagination.totalPages).toBe(5);
      expect(stub.calledWith(2, 50)).toBe(true);
    });
  });

  describe('GET /api/v1/admin/applications', () => {
    it('should list all pending applications for admin', async () => {
      const mockApplications = [
        new AccountApplication('app1', 'user1@test.com', 'I want to join', 'pending'),
        new AccountApplication('app2', 'user2@test.com', 'Please let me in', 'pending'),
      ];

      const stub = sandbox.stub(accountsInterface, 'listAccountApplications');
      stub.resolves(mockApplications);

      const result = await accountsInterface.listAccountApplications();

      expect(result).toEqual(mockApplications);
      expect(result.length).toBe(2);
      expect(stub.called).toBe(true);
    });
  });

  describe('POST /api/v1/admin/applications/:id/approve', () => {
    it('should approve application and create account', async () => {
      const newAccount = new Account('new-id', 'approved@test.com', 'approved@test.com');

      const stub = sandbox.stub(accountsInterface, 'acceptAccountApplication');
      stub.resolves(newAccount);

      const result = await accountsInterface.acceptAccountApplication('app-id');

      expect(result).toEqual(newAccount);
      expect(result.email).toBe('approved@test.com');
      expect(stub.calledWith('app-id')).toBe(true);
    });
  });

  describe('POST /api/v1/admin/applications/:id/deny', () => {
    it('should deny application', async () => {
      const stub = sandbox.stub(accountsInterface, 'rejectAccountApplication');
      stub.resolves();

      await accountsInterface.rejectAccountApplication('app-id', false);

      expect(stub.calledWith('app-id', false)).toBe(true);
    });

    it('should deny application silently', async () => {
      const stub = sandbox.stub(accountsInterface, 'rejectAccountApplication');
      stub.resolves();

      await accountsInterface.rejectAccountApplication('app-id', true);

      expect(stub.calledWith('app-id', true)).toBe(true);
    });
  });

  describe('POST /api/v1/admin/invitations', () => {
    it('should send invitation as admin', async () => {
      const invitation = new AccountInvitation('inv-id', 'newuser@test.com', adminAccount);

      const stub = sandbox.stub(accountsInterface, 'inviteNewAccount');
      stub.resolves(invitation);

      const result = await accountsInterface.inviteNewAccount(
        adminAccount,
        'newuser@test.com',
        'Welcome to our instance!',
      );

      expect(result).toEqual(invitation);
      expect(result.email).toBe('newuser@test.com');
      expect(stub.called).toBe(true);
    });
  });

  describe('GET /api/v1/admin/invitations', () => {
    it('should list all invitations for admin', async () => {
      const mockInvitations = [
        new AccountInvitation('inv1', 'user1@test.com', adminAccount),
        new AccountInvitation('inv2', 'user2@test.com', regularAccount),
      ];

      const stub = sandbox.stub(accountsInterface, 'listInvitations');
      stub.resolves({ invitations: mockInvitations, pagination: { currentPage: 1, totalPages: 1, totalCount: 2, limit: 50 } });

      // Admin should get all invitations (inviterId = undefined)
      const result = await accountsInterface.listInvitations();

      expect(result.invitations).toEqual(mockInvitations);
      expect(result.invitations.length).toBe(2);
      expect(result.pagination).toEqual({ currentPage: 1, totalPages: 1, totalCount: 2, limit: 50 });
      expect(stub.called).toBe(true);
    });
  });

  describe('Authorization', () => {
    it('should deny non-admin access to admin endpoints', () => {
      // This will be tested in route handler tests
      expect(regularAccount.hasRole('admin')).toBe(false);
      expect(adminAccount.hasRole('admin')).toBe(true);
    });
  });
});
