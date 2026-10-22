import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express, { Router } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import config from 'config';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import { addRequestUser, testApp, countRoutes } from '@/server/common/test/lib/express';

import AuthenticationAPI from '@/server/authentication/api/v1';
import AuthenticationService from '@/server/authentication/service/auth';
import AccountsDomain from '@/server/accounts';
import ConfigurationDomain from '@/server/configuration';
import SetupDomain from '@/server/setup';
import AuthenticationDomain from '@/server/authentication';
import EventEmitter from 'events';
import AuthenticationRouteHandlers from '../api/v1/auth';
import { noAccountExistsError } from '@/server/accounts/exceptions';

describe('API v1', () => {

  it('should load routes properly', () => {
    let app = express();
    expect(countRoutes(app)).toBe(0);

    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    const accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    const authenticatetionDomain = new AuthenticationDomain(eventBus, accountsDomain.interface);
    AuthenticationAPI.install(app, authenticatetionDomain.interface, accountsDomain.interface);
    expect(countRoutes(app)).toBeGreaterThan(0);
  });
});

describe('getToken', () => {
  let stub: sinon.SinonStub;
  let service: AuthenticationDomain;
  let handlers: AuthenticationRouteHandlers;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    const accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    service = new AuthenticationDomain(eventBus, accountsDomain.interface);
    handlers = new AuthenticationRouteHandlers(service.interface, accountsDomain.interface);
    stub = sinon.stub(accountsDomain.interface, 'getAccountById');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('getToken: should succeed', async () => {
    let router = express.Router();
    stub.resolves(new Account('id', 'testme', 'testme'));
    router.get('/handler', addRequestUser, handlers.getToken.bind(handlers));

    let response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(stub.called).toBe(true);
  });

  it('getToken: bad user in request, should fail', async () => {
    let router = express.Router();
    stub.resolves(undefined);
    router.get('/handler', addRequestUser, handlers.getToken.bind(handlers));

    let response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(400);
    expect(stub.called).toBe(true);
  });

  it('getToken: no user in request, should fail', async () => {
    let router = Router();
    router.get('/handler', handlers.getToken.bind(handlers));

    let response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(400);
  });
});

describe('checkPasswordResetCode', () => {
  let stub: sinon.SinonStub;
  let service: AuthenticationDomain;
  let handlers: AuthenticationRouteHandlers;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    const accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    service = new AuthenticationDomain(eventBus, accountsDomain.interface);
    handlers = new AuthenticationRouteHandlers(service.interface, accountsDomain.interface);
    stub = sinon.stub(AuthenticationService.prototype, 'validatePasswordResetCode');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('checkPasswordResetCode: should succeed', async () => {
    let router = express.Router();
    stub.resolves(true);
    router.get('/handler/:code', handlers.checkPasswordResetCode.bind(handlers));

    let response = await request(testApp(router)).get('/handler/1234');

    expect(response.status).toBe(200);
    expect(stub.called).toBe(true);
  });

  it('checkPasswordResetCode: should fail', async () => {
    let router = express.Router();
    stub.resolves(false);
    router.get('/handler/:code', handlers.checkPasswordResetCode.bind(handlers));

    let response = await request(testApp(router)).get('/handler/1234');

    expect(response.status).toBe(200);
    expect(stub.called).toBe(true);
  });
});

describe('resetPassword', () => {
  let stub: sinon.SinonStub;
  let service: AuthenticationDomain;
  let handlers: AuthenticationRouteHandlers;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    const accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    service = new AuthenticationDomain(eventBus, accountsDomain.interface);
    handlers = new AuthenticationRouteHandlers(service.interface, accountsDomain.interface);
    stub = sinon.stub(AuthenticationService.prototype, 'resetPassword');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('resetPassword: should succeed', async () => {
    let router = express.Router();
    stub.resolves(new Account('id', 'testme', 'testme'));
    let jwtSpy = sinon.spy(ExpressHelper, 'generateJWT');
    router.post('/handler/:code', handlers.setPassword.bind(handlers));

    let response = await request(testApp(router)).post('/handler/1234').send({password: 'password123'});

    expect(response.status).toBe(200);
    expect(response.text).toBe(jwtSpy.returnValues[0]);
    expect(stub.called).toBe(true);
  });

  it('resetPassword: should fail', async () => {
    let router = express.Router();
    stub.resolves(undefined);
    router.post('/handler/:code', handlers.setPassword.bind(handlers));

    let response = await request(testApp(router)).post('/handler/1234').send({password: 'password123'});

    expect(response.status).toBe(400);
    expect(stub.called).toBe(true);
  });

  it('resetPassword: service throw becomes a 400 PasswordResetError', async () => {
    let router = express.Router();
    stub.rejects(new Error('database unavailable'));
    router.post('/handler/:code', handlers.setPassword.bind(handlers));

    let response = await request(testApp(router)).post('/handler/1234').send({password: 'password123'});

    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('PasswordResetError');
    expect(stub.called).toBe(true);
  });
});

describe('login', () => {
  let passportStub: sinon.SinonStub;
  let service: AuthenticationDomain;
  let handlers: AuthenticationRouteHandlers;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    const accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    service = new AuthenticationDomain(eventBus, accountsDomain.interface);
    handlers = new AuthenticationRouteHandlers(service.interface, accountsDomain.interface);
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

    router.post('/handler', handlers.login.bind(handlers));

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

    router.post('/handler', handlers.login.bind(handlers));

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

    router.post('/handler', handlers.login.bind(handlers));

    let response = await request(testApp(router)).post('/handler').send({email: 'testEmail', password: 'testPassword'});

    expect(response.status).toBe(200);

  });

});

describe('JWT strategy', () => {
  const secret = config.get<string>('jwt.secret');
  let app: express.Application;

  /**
   * Encode a JSON value as an unpadded base64url JWT segment.
   */
  function segment(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  /**
   * The claims a token from generateJWT carries, expiring in five minutes.
   */
  function claims() {
    return {
      exp: Math.floor(Date.now() / 1000) + 300,
      id: 'id',
      email: 'testme',
      isAdmin: false,
    };
  }

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    const accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    const authenticationDomain = new AuthenticationDomain(eventBus, accountsDomain.interface);
    sinon.stub(accountsDomain.interface, 'getAccountById').resolves(new Account('id', 'testme', 'testme'));

    app = express();
    AuthenticationAPI.install(app, authenticationDomain.interface, accountsDomain.interface);
    app.get('/protected', passport.authenticate('jwt', { session: false }), (req, res) => {
      res.json({ id: req.user?.id });
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('accepts a token from generateJWT', async () => {
    const token = ExpressHelper.generateJWT(new Account('id', 'testme', 'testme'));

    const response = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('id');
  });

  it('rejects a token signed with the right secret but another HMAC algorithm', async () => {
    const token = jwt.sign(claims(), secret, { algorithm: 'HS512' });

    const response = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('rejects an unsigned alg=none token', async () => {
    const token = `${segment({ alg: 'none', typ: 'JWT' })}.${segment(claims())}.`;

    const response = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });
});

describe('non-string credentials on the installed auth routes', () => {
  const nonStrings: Array<[string, unknown]> = [
    ['a number', 5],
    ['an object', { a: 1 }],
    ['an array', ['a']],
  ];

  let app: express.Application;
  let accountsDomain: AccountsDomain;
  let authenticationDomain: AuthenticationDomain;
  let getAccountByEmail: sinon.SinonStub;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    authenticationDomain = new AuthenticationDomain(eventBus, accountsDomain.interface);
    // Calls through to the real lookup, so a non-string email that slips past
    // the guard reaches normalizeEmail exactly as it does in production.
    getAccountByEmail = sinon.stub(accountsDomain.interface, 'getAccountByEmail').callThrough();
    sinon.stub(accountsDomain.interface, 'getAccountById').resolves(new Account('id', 'testme', 'testme'));

    app = express();
    AuthenticationAPI.install(app, authenticationDomain.interface, accountsDomain.interface);
  });

  afterEach(() => {
    sinon.restore();
  });

  function expectStringFieldError(response: request.Response, field: string) {
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
    expect(response.body.fields[field]).toBeDefined();
  }

  describe('POST /login', () => {
    for (const field of ['email', 'password']) {
      for (const [label, value] of nonStrings) {
        it(`rejects ${label} ${field} with 400 before any account lookup`, async () => {
          const body = { email: 'user@example.com', password: 'password123', [field]: value };

          const response = await request(app).post('/api/auth/v1/login').send(body);

          expectStringFieldError(response, field);
          expect(getAccountByEmail.notCalled).toBe(true);
        });
      }
    }

    it('keeps answering after a malformed login', async () => {
      const account = new Account('id', 'user@example.com', 'user@example.com');
      const malformed = await request(app).post('/api/auth/v1/login').send({ email: 5, password: 'password123' });
      expect(malformed.status).toBe(400);

      getAccountByEmail.resolves(account);
      sinon.stub(authenticationDomain.interface, 'checkPassword').resolves(true);

      const response = await request(app)
        .post('/api/auth/v1/login')
        .send({ email: 'user@example.com', password: 'password123' });

      expect(response.status).toBe(200);
      expect(jwt.verify(response.text, config.get<string>('jwt.secret'))).toMatchObject({ id: 'id' });
    });
  });

  describe('POST /reset-password', () => {
    let generate: sinon.SinonStub;

    beforeEach(() => {
      generate = sinon.stub(AuthenticationService.prototype, 'generatePasswordResetCode');
    });

    for (const [label, value] of nonStrings) {
      it(`rejects ${label} email with 400 before generating a code`, async () => {
        const response = await request(app).post('/api/auth/v1/reset-password').send({ email: value });

        expectStringFieldError(response, 'email');
        expect(generate.notCalled).toBe(true);
      });
    }

    it('still answers an absent email with the uniform success response', async () => {
      generate.rejects(new noAccountExistsError());

      const response = await request(app).post('/api/auth/v1/reset-password').send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });
  });

  describe('POST /reset-password/:code', () => {
    let reset: sinon.SinonStub;

    beforeEach(() => {
      reset = sinon.stub(AuthenticationService.prototype, 'resetPassword');
    });

    for (const [label, value] of nonStrings) {
      it(`rejects ${label} password with 400 before resetting`, async () => {
        const response = await request(app).post('/api/auth/v1/reset-password/abc').send({ password: value });

        expectStringFieldError(response, 'password');
        expect(reset.notCalled).toBe(true);
      });
    }

    it('still answers an absent password with password_too_short', async () => {
      const response = await request(app).post('/api/auth/v1/reset-password/abc').send({});

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('password_too_short');
      expect(reset.notCalled).toBe(true);
    });
  });

  describe('POST /email', () => {
    let initiate: sinon.SinonStub;
    let token: string;

    beforeEach(() => {
      initiate = sinon.stub(AuthenticationService.prototype, 'initiateEmailChange');
      token = ExpressHelper.generateJWT(new Account('id', 'testme', 'testme'));
    });

    for (const field of ['email', 'password']) {
      for (const [label, value] of nonStrings) {
        it(`rejects ${label} ${field} with 400 before initiating a change`, async () => {
          const body = { email: 'new@example.com', password: 'password123', [field]: value };

          const response = await request(app)
            .post('/api/auth/v1/email')
            .set('Authorization', `Bearer ${token}`)
            .send(body);

          expectStringFieldError(response, field);
          expect(initiate.notCalled).toBe(true);
        });
      }
    }
  });
});
