import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import CalendarService from '@/server/calendar/service/calendar';
import { WebFingerResponse } from '@/server/activitypub/model/webfinger';
import { UserProfileResponse } from '@/server/activitypub/model/userprofile';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';

describe('lookupUser', () => {
    let routes: ActivityPubServerRoutes;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        routes = new ActivityPubServerRoutes();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail without resource', async () => {
        let req = { query: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        await routes.lookupUser(req as any, res as any);

        expect(res.status.calledWith(400)).toBe(true);
        expect(res.send.calledWith('Invalid request')).toBe(true);
    });

    it('should fail with unknown user', async () => {
        let req = { query: { resource: 'acct:testuser@testdomain.com' } };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        let lookupMock = sandbox.stub(routes.service, 'lookupWebFinger');
        lookupMock.resolves(null);

        await routes.lookupUser(req as any, res as any);

        expect(res.status.calledWith(404)).toBe(true);
        expect(res.send.calledWith('Calendar not found')).toBe(true);
    });

    it('should succeed with known user', async () => {
        let req = { query: { resource: 'acct:testuser@testdomain.com' } };
        let res = { json: sinon.stub() };

        let lookupMock = sandbox.stub(routes.service, 'lookupWebFinger');
        lookupMock.resolves(new WebFingerResponse('testuser', 'testdomain.com'));

        await routes.lookupUser(req as any, res as any);

        expect(res.json.called).toBe(true);
    });
});

describe('getUserProfile', () => {
    let routes: ActivityPubServerRoutes;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        routes = new ActivityPubServerRoutes();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail with unknown user', async () => {
        let req = { params: { user: 'testuser' } };
        let res = { status: sinon.stub(), send: sinon.stub() };
        res.status.returns(res);

        let lookupMock = sandbox.stub(routes.service, 'lookupUserProfile');
        lookupMock.resolves(null);

        await routes.getUserProfile(req as any, res as any);

        expect(res.status.calledWith(404)).toBe(true);
        expect(res.send.calledWith('Calendar not found')).toBe(true);
    });

    it('should succeed with known user', async () => {
        let req = { params: { user: 'testuser' } };
        let res = { json: sinon.stub() };

        let lookupMock = sandbox.stub(routes.service, 'lookupUserProfile');
        lookupMock.resolves(new UserProfileResponse('testuser','testdomain.com'));

        await routes.getUserProfile(req as any, res as any);

        expect(res.json.called).toBe(true);
    });
});

describe('addToInbox', () => {
    let routes: ActivityPubServerRoutes;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        routes = new ActivityPubServerRoutes();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail without user', async () => {
        let req = { params: {} };
        let res = { status: sinon.stub(), send: sinon.stub() };
        let calendarFindMock = sandbox.stub(CalendarService, 'getCalendarByName');
        res.status.returns(res);
        calendarFindMock.resolves(null);

        await routes.addToInbox(req as any, res as any);

        expect(res.status.calledWith(404)).toBe(true);
        expect(res.send.calledWith('Calendar not found')).toBe(true);
    });

    it('should fail with invalid message type', async () => {
        let req = { params: { orgname: 'testuser' }, body: { type: 'Foobar' } };
        let res = { status: sinon.stub(), send: sinon.stub() };
        let userFindMock = sandbox.stub(CalendarService, 'getCalendarByName');
        let inboxMock = sandbox.stub(routes.service, 'addToInbox');

        res.status.returns(res);
        userFindMock.resolves(new Calendar("testId","testuser"));
        inboxMock.resolves();

        await routes.addToInbox(req as any, res as any);

        expect(res.status.calledWith(400)).toBe(true);
        expect(res.send.calledWith('Invalid message')).toBe(true);
    });

    it('should succeed with valid message type', async () => {
        let req = { params: { orgname: 'testuser' }, body: { type: 'Create', object: { id: 'testObjectId' } } };
        let res = { status: sinon.stub(), send: sinon.stub() };
        let userFindMock = sandbox.stub(CalendarService, 'getCalendarByName');
        let inboxMock = sandbox.stub(routes.service, 'addToInbox');

        res.status.returns(res);
        userFindMock.resolves(new Calendar("testId","testuser"));
        inboxMock.resolves();

        await routes.addToInbox(req as any, res as any);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.send.calledWith('Message received')).toBe(true);
    });
});