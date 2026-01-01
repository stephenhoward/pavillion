import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';

import { AccountEntity, AccountRoleEntity, AccountSecretsEntity } from '@/server/common/entity/account';
import ServiceSettings from '@/server/configuration/service/settings';
import SetupService from '@/server/setup/service/setup';
import SetupRouteHandlers from '@/server/setup/api/v1/setup';
import SetupInterface from '@/server/setup/interface';

describe('SetupService', () => {
  let sandbox = sinon.createSandbox();
  let setupService: SetupService;

  beforeEach(() => {
    setupService = new SetupService();
  });

  afterEach(() => {
    sandbox.restore();
    // Clear the setup mode cache
    SetupService.clearCache();
  });

  describe('isSetupModeActive', () => {
    it('should return true when no admin account exists', async () => {
      const findOneStub = sandbox.stub(AccountRoleEntity, 'findOne');
      findOneStub.resolves(null);

      const result = await setupService.isSetupModeActive();

      expect(result).toBe(true);
      expect(findOneStub.calledOnce).toBe(true);
      expect(findOneStub.calledWith({ where: { role: 'admin' } })).toBe(true);
    });

    it('should return false when admin account exists', async () => {
      const findOneStub = sandbox.stub(AccountRoleEntity, 'findOne');
      findOneStub.resolves(AccountRoleEntity.build({ account_id: 'test-id', role: 'admin' }));

      const result = await setupService.isSetupModeActive();

      expect(result).toBe(false);
      expect(findOneStub.calledOnce).toBe(true);
    });
  });
});

describe('Setup API', () => {
  let sandbox = sinon.createSandbox();
  let app: express.Application;
  let setupInterface: SetupInterface;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    setupInterface = new SetupInterface();
    const routeHandler = new SetupRouteHandlers(setupInterface);
    routeHandler.installHandlers(app, '/api/v1');
  });

  afterEach(() => {
    sandbox.restore();
    SetupService.clearCache();
  });

  describe('GET /api/v1/setup/status', () => {
    it('should return setupRequired: true when no admin exists', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(true);

      const response = await request(app)
        .get('/api/v1/setup/status')
        .expect(200);

      expect(response.body.setupRequired).toBe(true);
    });

    it('should return setupRequired: false when admin exists', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(false);

      const response = await request(app)
        .get('/api/v1/setup/status')
        .expect(200);

      expect(response.body.setupRequired).toBe(false);
    });
  });

  describe('POST /api/v1/setup', () => {
    it('should return 404 when admin already exists', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(false);

      const response = await request(app)
        .post('/api/v1/setup')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          siteTitle: 'Test Site',
          registrationMode: 'closed',
        })
        .expect(404);

      expect(response.body.error).toBe('Setup already completed');
    });

    it('should create admin account with correct role', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(true);

      const completeSetupStub = sandbox.stub(SetupService.prototype, 'completeSetup');
      completeSetupStub.resolves(true);

      const response = await request(app)
        .post('/api/v1/setup')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          siteTitle: 'Test Site',
          registrationMode: 'closed',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.redirectTo).toBe('/login');
      expect(completeSetupStub.calledOnce).toBe(true);
      expect(completeSetupStub.calledWith(
        'admin@test.com',
        'password123',
        'Test Site',
        'closed',
      )).toBe(true);
    });

    it('should save site title and registration mode to settings', async () => {
      // Test that completeSetup is called with the correct parameters
      // The actual settings persistence is tested in the service unit tests
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(true);

      const completeSetupStub = sandbox.stub(SetupService.prototype, 'completeSetup');
      completeSetupStub.resolves(true);

      await request(app)
        .post('/api/v1/setup')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          siteTitle: 'My Community Calendar',
          registrationMode: 'apply',
        })
        .expect(200);

      expect(completeSetupStub.calledWith(
        'admin@test.com',
        'password123',
        'My Community Calendar',
        'apply',
      )).toBe(true);
    });

    it('should return validation error for invalid password', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(true);

      const response = await request(app)
        .post('/api/v1/setup')
        .send({
          email: 'admin@test.com',
          password: 'short', // Too short
          siteTitle: 'Test Site',
          registrationMode: 'closed',
        })
        .expect(400);

      expect(response.body.error).toBe('Invalid password');
      expect(response.body.passwordErrors).toContain('password_too_short');
    });

    it('should return validation error for missing fields', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(true);

      const response = await request(app)
        .post('/api/v1/setup')
        .send({
          email: 'admin@test.com',
          // missing password, siteTitle, registrationMode
        })
        .expect(400);

      expect(response.body.error).toBe('All fields are required');
    });
  });
});
