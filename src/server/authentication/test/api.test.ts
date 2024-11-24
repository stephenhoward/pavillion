import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express, { Request, Response, Router } from 'express';
import { handlers } from '../api/v1/auth';
import CommonAccountService from '../../common/service/accounts';
import { Account } from '../../../common/model/account';
import apiV1 from '../api/v1';
import { addRequestUser, testApp, countRoutes } from '../../common/test/lib/express';

describe('API v1', () => {

    it('should load routes properly', () => {
        let app = express();
        expect(countRoutes(app)).toBe(0);
        apiV1(app);
        expect(countRoutes(app)).toBeGreaterThan(0);
    });
});

describe('Auth API', () => {
    let stub: sinon.SinonStub;

    beforeEach(() => {
        stub = sinon.stub(CommonAccountService, 'getAccountById');
    });

    afterEach(() => {
        sinon.restore();
    });

    it('getToken: should succeed', async () => {
        let router = express.Router();
        stub.resolves(new Account('id', 'testme', 'testme'));
        router.get('/handler', addRequestUser, handlers.getToken);

        let response = await request(testApp(router)).get('/handler');

        expect(response.status).toBe(200);
        expect(stub.called).toBe(true);
    });

    it('getToken: bad user in request, should fail', async () => {
        let router = express.Router();
        stub.resolves(undefined);
        router.get('/handler', addRequestUser, handlers.getToken);

        let response = await request(testApp(router)).get('/handler');

        expect(response.status).toBe(400);
        expect(stub.called).toBe(true);
    });

    it('getToken: no user in request, should fail', async () => {
        let router = Router();
        router.get('/handler', handlers.getToken);

        let response = await request(testApp(router)).get('/handler');

        expect(response.status).toBe(400);
    });
});
