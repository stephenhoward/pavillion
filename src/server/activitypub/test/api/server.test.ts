import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

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
        expect(res.send.calledWith('User not found')).toBe(true);
    });

    it('should succeed with known user', async () => {
        let req = { query: { resource: 'acct:testuser@testdomain.com' } };
        let res = { json: sinon.stub() };

        let lookupMock = sandbox.stub(routes.service, 'lookupWebFinger');
        lookupMock.resolves({ toObject: () => ({}) });

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
        expect(res.send.calledWith('User not found')).toBe(true);
    });

    it('should succeed with known user', async () => {
        let req = { params: { user: 'testuser' } };
        let res = { json: sinon.stub() };

        let lookupMock = sandbox.stub(routes.service, 'lookupUserProfile');
        lookupMock.resolves({ toObject: () => ({}) });

        await routes.getUserProfile(req as any, res as any);

        expect(res.json.called).toBe(true);
    });
});