import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';

describe ('followAccount', () => {
    let routes: ActivityPubMemberRoutes;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        routes = new ActivityPubMemberRoutes();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail without current user', async () => {
        let req = { body: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.followAccount(req as any, res as any);

        expect(res.status.calledWith(403)).toBe(true);
        expect(res.send.calledWith('Not logged in')).toBe(true);
    });

    it('should fail without remote account', async () => {
        let req = { body: {}, user: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.followAccount(req as any, res as any);

        expect(res.status.calledWith(400)).toBe(true);
        expect(res.send.calledWith('Invalid request')).toBe(true);
    });

    it('should succeed with remote account', async () => {
        let req = {
            body: { remoteAccount: 'testAccountName' },
            user: Account.fromObject({id: 'testAccountId' })
        };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        let followMock = sandbox.stub(routes.service, 'followAccount');
        followMock.resolves();

        await routes.followAccount(req as any, res as any);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.send.calledWith('Followed')).toBe(true);
    });
});

describe('unfollowAccount', () => {
    let routes: ActivityPubMemberRoutes;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        routes = new ActivityPubMemberRoutes();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail without current user', async () => {
        let req = { params: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.unfollowAccount(req as any, res as any);

        expect(res.status.calledWith(403)).toBe(true);
        expect(res.send.calledWith('Not logged in')).toBe(true);
    });

    it('should fail without remote account', async () => {
        let req = { params: {}, user: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.unfollowAccount(req as any, res as any);

        expect(res.status.calledWith(400)).toBe(true);
        expect(res.send.calledWith('Invalid request')).toBe(true);
    });

    it('should succeed with remote account', async () => {
        let req = {
            params: { id: 'testAccountId' },
            user: Account.fromObject({id: 'testAccountId' })
        };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        let unfollowMock = sandbox.stub(routes.service, 'unfollowAccount');
        unfollowMock.resolves();

        await routes.unfollowAccount(req as any, res as any);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.send.calledWith('Unfollowed')).toBe(true);
    });
});

describe('shareEvent', () => {
    let routes: ActivityPubMemberRoutes;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        routes = new ActivityPubMemberRoutes();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail without current user', async () => {
        let req = { body: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.shareEvent(req as any, res as any);

        expect(res.status.calledWith(403)).toBe(true);
        expect(res.send.calledWith('Not logged in')).toBe(true);
    });

    it('should fail without event id', async () => {
        let req = { body: {}, user: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.shareEvent(req as any, res as any);

        expect(res.status.calledWith(400)).toBe(true);
        expect(res.send.calledWith('Invalid request')).toBe(true);
    });

    it('should succeed with event id', async () => {
        let req = {
            body: { eventId: 'testEventId' },
            user: Account.fromObject({id: 'testAccountId' })
        };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        let shareMock = sandbox.stub(routes.service, 'shareEvent');
        shareMock.resolves();

        await routes.shareEvent(req as any, res as any);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.send.calledWith('Shared')).toBe(true);
    });
});

describe('unshareEvent', () => {
    let routes: ActivityPubMemberRoutes;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        routes = new ActivityPubMemberRoutes();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail without current user', async () => {
        let req = { params: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.unshareEvent(req as any, res as any);

        expect(res.status.calledWith(403)).toBe(true);
        expect(res.send.calledWith('Not logged in')).toBe(true);
    });

    it('should fail without event id', async () => {
        let req = { params: {}, user: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.unshareEvent(req as any, res as any);

        expect(res.status.calledWith(400)).toBe(true);
        expect(res.send.calledWith('Invalid request')).toBe(true);
    });

    it('should succeed with event id', async () => {
        let req = {
            params: { id: 'testEventId' },
            user: Account.fromObject({id: 'testAccountId' })
        };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        let unshareMock = sandbox.stub(routes.service, 'unshareEvent');
        unshareMock.resolves();

        await routes.unshareEvent(req as any, res as any);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.send.calledWith('Unshared')).toBe(true);
    });
});