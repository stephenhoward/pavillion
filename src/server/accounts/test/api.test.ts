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

  it('list invitations: should succeed', async () => {
    let stub2 = sandbox.stub(accountsInterface,'listInvitations');
    stub2.resolves([]);
    router.get('/handler', inviteHandlers.listInvitations.bind(inviteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(stub2.called).toBe(true);
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
