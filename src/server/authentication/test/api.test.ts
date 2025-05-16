import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express, { Router } from 'express';
import passport from 'passport';

import { Account } from '@/common/model/account';
import CommonAccountService from '@/server/common/service/accounts';
import ExpressHelper from '@/server/common/helper/express';
import { addRequestUser, testApp, countRoutes } from '@/server/common/test/lib/express';

import apiV1 from '@/server/authentication/api/v1';
import { handlers } from '@/server/authentication/api/v1/auth';
import AuthenticationService from '@/server/authentication/service/auth';

describe('API v1', () => {

  it('should load routes properly', () => {
    let app = express();
    expect(countRoutes(app)).toBe(0);
    apiV1(app);
    expect(countRoutes(app)).toBeGreaterThan(0);
  });
});

describe('getToken', () => {
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

describe('checkPasswordResetCode', () => {
  let stub: sinon.SinonStub;

  beforeEach(() => {
    stub = sinon.stub(AuthenticationService, 'validatePasswordResetCode');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('checkPasswordResetCode: should succeed', async () => {
    let router = express.Router();
    stub.resolves(true);
    router.get('/handler/:code', handlers.checkPasswordResetCode);

    let response = await request(testApp(router)).get('/handler/1234');

    expect(response.status).toBe(200);
    expect(stub.called).toBe(true);
  });

  it('checkPasswordResetCode: should fail', async () => {
    let router = express.Router();
    stub.resolves(false);
    router.get('/handler/:code', handlers.checkPasswordResetCode);

    let response = await request(testApp(router)).get('/handler/1234');

    expect(response.status).toBe(200);
    expect(stub.called).toBe(true);
  });
});

describe('resetPassword', () => {
  let stub: sinon.SinonStub;

  beforeEach(() => {
    stub = sinon.stub(AuthenticationService, 'resetPassword');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('resetPassword: should succeed', async () => {
    let router = express.Router();
    stub.resolves(new Account('id', 'testme', 'testme'));
    let jwtSpy = sinon.spy(ExpressHelper, 'generateJWT');
    router.post('/handler', handlers.setPassword);

    let response = await request(testApp(router)).post('/handler').send({code: '1234', password: 'password'});

    expect(response.status).toBe(200);
    expect(response.text).toBe(jwtSpy.returnValues[0]);
    expect(stub.called).toBe(true);
  });

  it('resetPassword: should fail', async () => {
    let router = express.Router();
    stub.resolves(undefined);
    router.post('/handler', handlers.setPassword);

    let response = await request(testApp(router)).post('/handler').send({code: '1234', password: 'password'});

    expect(response.status).toBe(400);
    expect(stub.called).toBe(true);
  });
});

describe('login', () => {
  let passportStub: sinon.SinonStub;

  beforeEach(() => {
    passportStub = sinon.stub(passport, 'authenticate');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('login fail on error', async () => {
    let router = express.Router();
    passportStub.callsFake((strategy: string, options: any, cb: any) => {
      return () => {
        cb('hasAnError', new Account('id', 'testme', 'testme'));
      };
    });

    router.post('/handler', handlers.login);

    let response = await request(testApp(router)).post('/handler').send({email: 'testEmail', password: 'testPassword'});

    expect(response.status).toBe(400);

  });

  it('login fail on missing account', async () => {
    let router = express.Router();
    passportStub.callsFake((strategy: string, options: any, cb: any) => {
      return () => {
        cb(null, null);
      };
    });

    router.post('/handler', handlers.login);

    let response = await request(testApp(router)).post('/handler').send({email: 'testEmail', password: 'testPassword'});

    expect(response.status).toBe(400);

  });

  it('login success', async () => {
    let router = express.Router();
    passportStub.callsFake((strategy: string, options: any, cb: any) => {
      return () => {
        cb(null, new Account('id', 'testme', 'testme'));
      };
    });

    router.post('/handler', handlers.login);

    let response = await request(testApp(router)).post('/handler').send({email: 'testEmail', password: 'testPassword'});

    expect(response.status).toBe(200);

  });

});
