import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { handlers as accountHandlers } from '../api/v1/accounts';
import { handlers as inviteHandlers } from '../api/v1/invitations';
import { handlers as applicationHandlers } from '../api/v1/applications';
import AccountService from '../service/account';
import { Account } from '../../../common/model/account';
import { testApp, countRoutes } from '../../common/test/lib/express';
import AccountInvitation from '../../../common/model/invitation';
import apiV1 from '../api/v1';

describe('API v1', () => {

    it('should load routes properly', () => {
        let app = express();
        expect(countRoutes(app)).toBe(0);
        apiV1(app);
        expect(countRoutes(app)).toBeGreaterThan(0);
    });
});

describe('Account API', () => {
    let stub: sinon.SinonStub;
    let router: express.Router;

    beforeEach(() => {
        stub = sinon.stub(AccountService, 'registerNewAccount');
        router = express.Router();
    });

    afterEach(() => {
        sinon.restore();
    });

    it('register: should succeed', async () => {
        stub.resolves(new Account('id', 'testme', 'testme'));
        router.post('/handler', accountHandlers.register);

        const response = await request(testApp(router))
            .post('/handler')
            .send({email: 'testme'});

        expect(response.status).toBe(200);
        expect(stub.called).toBe(true);
    });

    it('register: should fail', async () => {
        stub.resolves(undefined);
        router.post('/handler', accountHandlers.register);

        const response = await request(testApp(router))
            .post('/handler')
            .send({email: 'testme'});

        expect(response.status).toBe(400);
        expect(stub.called).toBe(true);
    });
    
});

describe ('Invitations API', () => {
    let stub: sinon.SinonStub;
    let router: express.Router;

    beforeEach(() => {
        router = express.Router();
    });

    afterEach(() => {
        sinon.restore();
    });

    it('list invitations: should succeed', async () => {
        let stub2 = sinon.stub(AccountService,'listInvitations');
        stub2.resolves([]);
        router.get('/handler', inviteHandlers.listInvitations);

        const response = await request(testApp(router)).get('/handler');

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
        expect(stub2.called).toBe(true);
    });

    it('invite new account: should succeed', async () => {
        let stub2 = sinon.stub(AccountService,'inviteNewAccount');
        stub2.resolves(new AccountInvitation('id', 'testme', 'testme'));
        router.post('/handler', inviteHandlers.inviteToRegister);

        const response = await request(testApp(router))
            .post('/handler')
            .send({email: 'testme'});

        expect(response.status).toBe(200);
        expect(stub2.called).toBe(true);
    });

    it('invite new account: should fail', async () => {
        let stub2 = sinon.stub(AccountService,'inviteNewAccount');
        stub2.resolves(undefined);
        router.post('/handler', inviteHandlers.inviteToRegister);

        const response = await request(testApp(router))
            .post('/handler')
            .send({email: 'testme'});

        expect(response.status).toBe(400);
        expect(stub2.called).toBe(true);
    });

    it('check invite code: should succeed', async () => {
        let stub2 = sinon.stub(AccountService,'validateInviteCode');
        stub2.resolves(true);
        router.get('/handler', inviteHandlers.checkInviteCode);

        const response = await request(testApp(router)).get('/handler');

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('ok');
        expect(stub2.called).toBe(true);
    });

    it('check invite code: should fail', async () => {
        let stub2 = sinon.stub(AccountService,'validateInviteCode');
        stub2.resolves(false);
        router.get('/handler', inviteHandlers.checkInviteCode);

        const response = await request(testApp(router)).get('/handler');

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('not ok');
        expect(stub2.called).toBe(true);
    });

    it('accept invite: should succeed', async () => {
        let stub2 = sinon.stub(AccountService,'acceptAccountInvite');
        stub2.resolves(new Account('id', 'testme', 'testme'));
        router.post('/handler', inviteHandlers.acceptInvite);

        const response = await request(testApp(router))
            .post('/handler')
            .send({password: 'testme'});

        expect(response.status).toBe(200);
        expect(stub2.called).toBe(true);
    });

    it('accept invite: should fail', async () => {
        let stub2 = sinon.stub(AccountService,'acceptAccountInvite');
        stub2.resolves(undefined);
        router.post('/handler', inviteHandlers.acceptInvite);

        const response = await request(testApp(router))
            .post('/handler')
            .send({password: 'testme'});

        expect(response.status).toBe(400);
        expect(stub2.called).toBe(true);
    });

    //sendNewAccountInvite (resend)
});

describe('Applications API', () => {
    let router: express.Router;

    beforeEach(() => {
        router = express.Router();
    });

    afterEach(() => {
        sinon.restore();
    });

    it('apply to register: should succeed', async () => {
        let stub2 = sinon.stub(AccountService,'applyForNewAccount');
        router.post('/handler', applicationHandlers.applyToRegister);

        const response = await request(testApp(router))
            .post('/handler')
            .send({email: 'testme'});

        expect(response.status).toBe(200);
        expect(stub2.called).toBe(true);
    });

    it('list applications: should succeed', async () => {
        let stub2 = sinon.stub(AccountService,'listAccountApplications');
        stub2.resolves([]);
        router.get('/handler', applicationHandlers.listApplications);

        const response = await request(testApp(router)).get('/handler');

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
        expect(stub2.called).toBe(true);
    });

    it('process application: should accept', async () => {
        let stub = sinon.stub(AccountService,'acceptAccountApplication');
        let stub2 = sinon.stub(AccountService,'rejectAccountApplication');
        router.post('/handler', applicationHandlers.processApplication);

        const response = await request(testApp(router))
            .post('/handler')
            .send({accepted: true});

        expect(response.status).toBe(200);
        expect(stub.called).toBe(true);
        expect(stub2.called).toBe(false);
    });

    it('process application: should reject', async () => {
        let stub = sinon.stub(AccountService,'acceptAccountApplication');
        let stub2 = sinon.stub(AccountService,'rejectAccountApplication');
        router.post('/handler', applicationHandlers.processApplication);

        const response = await request(testApp(router))
            .post('/handler')
            .send({accepted: false});

        expect(response.status).toBe(200);
        expect(stub.called).toBe(false);
        expect(stub2.called).toBe(true);
    });

    it('process application: should fail', async () => {
        let stub = sinon.stub(AccountService,'acceptAccountApplication');
        let stub2 = sinon.stub(AccountService,'rejectAccountApplication');
        router.post('/handler', applicationHandlers.processApplication);

        const response = await request(testApp(router))
            .post('/handler')
            .send({});

        expect(response.status).toBe(400);
        expect(stub.called).toBe(false);
        expect(stub2.called).toBe(false);
    });
});
