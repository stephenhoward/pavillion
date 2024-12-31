import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';

import { CalendarEvent } from '@/common/model/events';
import { testApp, countRoutes, addRequestUser } from '@/server/common/test/lib/express';
import apiV1 from '@/server/members/api/v1';
import { handlers as eventHandlers } from '@/server/members/api/v1/events';
import EventService from '@/server/members/service/events';

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
        eventStub.resolves([]);

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
        eventStub.resolves(new CalendarEvent('id', 'testme'));

        const response = await request(testApp(router))
            .post('/handler');

        expect(response.status).toBe(200);
        expect(response.body.error).toBeUndefined();
        expect(eventStub.called).toBe(true);
    });

    it('updateEvent: should fail without account', async () => {
        let eventStub = eventSandbox.stub(EventService, 'updateEvent');
        router.post('/handler', eventHandlers.updateEvent);

        const response = await request(testApp(router))
            .post('/handler');

        expect(response.status).toBe(400);
        expect(response.body.error).toBeDefined();
        expect(eventStub.called).toBe(false);
    });

    it('updateEvent: should succeed', async () => {
        let eventStub = eventSandbox.stub(EventService, 'updateEvent');
        router.post('/handler', addRequestUser, eventHandlers.updateEvent);
        eventStub.resolves(new CalendarEvent('id', 'testme'));

        const response = await request(testApp(router))
            .post('/handler');

        expect(response.status).toBe(200);
        expect(response.body.error).toBeUndefined();
        expect(eventStub.called).toBe(true);
    });
});
