import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';

describe ('followCalendar', () => {
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

        await routes.followCalendar(req as any, res as any);

        expect(res.status.calledWith(403)).toBe(true);
        expect(res.send.calledWith('Not logged in')).toBe(true);
    });

    it('should fail without remote account', async () => {
        let req = { body: {}, user: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.followCalendar(req as any, res as any);

        expect(res.status.calledWith(400)).toBe(true);
        expect(res.send.calledWith('Invalid request')).toBe(true);
    });

    it('should succeed with remote account', async () => {
        let req = {
            body: { remoteCalendar: 'testCalendarName' },
            user: Account.fromObject({id: 'testAccountId' })
        };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        let followMock = sandbox.stub(routes.service, 'followCalendar');
        followMock.resolves();

        await routes.followCalendar(req as any, res as any);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.send.calledWith('Followed')).toBe(true);
    });
});

describe('unfollowCalendar', () => {
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

        await routes.unfollowCalendar(req as any, res as any);

        expect(res.status.calledWith(403)).toBe(true);
        expect(res.send.calledWith('Not logged in')).toBe(true);
    });

    it('should fail without remote account', async () => {
        let req = { body: {}, user: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.unfollowCalendar(req as any, res as any);

        expect(res.status.calledWith(400)).toBe(true);
        expect(res.send.calledWith('Invalid request')).toBe(true);
    });

    it('should succeed with remote account', async () => {
        let req = {
            body: { remoteCalendar: 'testCalendarId' },
            user: Account.fromObject({id: 'testAccountId' })
        };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        let unfollowMock = sandbox.stub(routes.service, 'unfollowCalendar');
        unfollowMock.resolves();

        await routes.unfollowCalendar(req as any, res as any);

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
        let req = { body: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.unshareEvent(req as any, res as any);

        expect(res.status.calledWith(403)).toBe(true);
        expect(res.send.calledWith('Not logged in')).toBe(true);
    });

    it('should fail without event id', async () => {
        let req = { body: {}, user: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.unshareEvent(req as any, res as any);

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

        let unshareMock = sandbox.stub(routes.service, 'unshareEvent');
        unshareMock.resolves();

        await routes.unshareEvent(req as any, res as any);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.send.calledWith('Unshared')).toBe(true);
    });
});