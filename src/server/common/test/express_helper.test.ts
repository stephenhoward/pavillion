import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import expressHelper from '@/server/common/helper/express';

describe('adminOnly', async () => {
    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail on missing user', async () => {

        let req = { user: null };
        let res = { status: sinon.stub(), json: sinon.stub() };
        let next = sinon.stub();
        res.status.returns(res);

        await expressHelper.adminOnly[1](req,res,next);

        expect(res.status.calledWith(403)).toBe(true);
        expect(next.called).toBe(false);
    });

    it('should fail on not-admin', async () => {

        let req = { user: new Account('testUser') };
        let res = { status: sinon.stub(), json: sinon.stub() };
        let next = sinon.stub();
        res.status.returns(res);

        await expressHelper.adminOnly[1](req,res,next);

        expect(res.status.calledWith(403)).toBe(true);
        expect(next.called).toBe(false);
    });

    it('should succeed on admin', async () => {

        let req = { user: new Account('testUser') };
        let res = { status: sinon.stub(), json: sinon.stub() };
        let next = sinon.stub();

        req.user.roles = ['admin'];
        res.status.returns(res);

        await expressHelper.adminOnly[1](req,res,next);

        expect(res.status.called).toBe(false);
        expect(next.called).toBe(true);
    });
});

describe('noUserOnly', async () => {
    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail on user present', async () => {

        let req = { user: new Account('testUser') };
        let res = { status: sinon.stub(), json: sinon.stub() };
        let next = sinon.stub();
        res.status.returns(res);

        await expressHelper.noUserOnly[0](req,res,next);

        expect(res.status.calledWith(403)).toBe(true);
        expect(next.called).toBe(false);
    });

    it('should succeed on user missing', async () => {

        let req = { user: null };
        let res = { status: sinon.stub(), json: sinon.stub() };
        let next = sinon.stub();

        res.status.returns(res);

        await expressHelper.noUserOnly[0](req,res,next);

        expect(res.status.called).toBe(false);
        expect(next.called).toBe(true);
    });
});

describe('loggedInOnly', async () => {
    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail on missing user', async () => {

        let req = { user: null };
        let res = { status: sinon.stub(), json: sinon.stub() };
        let next = sinon.stub();
        res.status.returns(res);

        await expressHelper.loggedInOnly[1](req,res,next);

        expect(res.status.calledWith(403)).toBe(true);
        expect(next.called).toBe(false);
    });

    it('should succeed on user present', async () => {

        let req = { user: new Account('testUser') };
        let res = { status: sinon.stub(), json: sinon.stub() };
        let next = sinon.stub();

        res.status.returns(res);

        await expressHelper.loggedInOnly[1](req,res,next);

        expect(res.status.called).toBe(false);
        expect(next.called).toBe(true);
    });
});

describe('generateJWT', async () => {
    it('should generate an admin token', async () => {
        let account = new Account('testUser');
        account.roles = ['admin'];

        let token = expressHelper.generateJWT(account);
        let payload = JSON.parse(
            atob( token.split('.')[1].replace('-','+').replace('_','/') )
        );

        expect(token).not.toBe(null);
        expect(payload.id).toBe(account.id);
        expect(payload.isAdmin).toBe(true);
        expect(payload.exp).toBeDefined();
    });

    it('should generate an non admin token', async () => {
        let account = new Account('testUser');

        let token = expressHelper.generateJWT(account);
        let payload = JSON.parse(
            atob( token.split('.')[1].replace('-','+').replace('_','/') )
        );

        expect(token).not.toBe(null);
        expect(payload.id).toBe(account.id);
        expect(payload.isAdmin).toBe(false);
        expect(payload.exp).toBeDefined();
    });
});