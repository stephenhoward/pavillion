import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { handlers as eventHandlers } from '../api/v1/events';
import EventService from '../service/events';
import { Account } from '../../../common/model/account';
import { testApp, countRoutes, addRequestUser } from '../../common/test/lib/express';
import AccountInvitation from '../../../common/model/invitation';
import apiV1 from '../api/v1';
import ServiceSettings from '../../common/service/settings';

describe('API v1', () => {

    it('should load routes properly', () => {
        let app = express();
        expect(countRoutes(app)).toBe(0);
        apiV1(app);
        expect(countRoutes(app)).toBeGreaterThan(0);
    });
});

describe('Event API', () => {
    let router: express.Router;
    let eventSandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        router = express.Router();
    });

    afterEach(() => {
        eventSandbox.restore();
    });

    it('listEvents: should fail without account', async () => {
        let eventStub = eventSandbox.stub(EventService, 'listEvents');
        router.get('/handler', eventHandlers.listEvents);

        const response = await request(testApp(router))
            .get('/handler');

        expect(response.status).toBe(400);
        expect(eventStub.called).toBe(false);
    });

    it('listEvents: should succeed', async () => {
        let eventStub = eventSandbox.stub(EventService, 'listEvents');
        router.get('/handler', addRequestUser, eventHandlers.listEvents);

        const response = await request(testApp(router))
            .get('/handler');

        expect(response.status).toBe(200);
        expect(eventStub.called).toBe(true);
    });
    
    it('createEvent: should fail without account', async () => {
        let eventStub = eventSandbox.stub(EventService, 'createEvent');
        router.post('/handler', eventHandlers.createEvent);

        const response = await request(testApp(router))
            .post('/handler');

        expect(response.status).toBe(400);
        expect(response.body.error).toBeDefined();
        expect(eventStub.called).toBe(false);
    });

    it('createEvent: should succeed', async () => {
        let eventStub = eventSandbox.stub(EventService, 'createEvent');
        router.post('/handler', addRequestUser, eventHandlers.createEvent);

        const response = await request(testApp(router))
            .post('/handler');

        expect(response.status).toBe(200);
        expect(response.body.error).toBeUndefined();
        expect(eventStub.called).toBe(true);
    });
});
