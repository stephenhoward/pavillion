import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';

import SetupService from '@/server/setup/service/setup';
import SetupRouteHandlers from '@/server/setup/api/v1/setup';
import SetupInterface from '@/server/setup/interface';

/**
 * Additional strategic tests to fill coverage gaps for the docker first-run setup feature.
 * These tests focus on critical validation and error handling paths not covered
 * by the primary test suite.
 */
describe('Setup API - Additional Coverage', () => {
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

  describe('POST /api/v1/setup - Email Validation', () => {
    it('should return error for invalid email format', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(true);

      const response = await request(app)
        .post('/api/v1/setup')
        .send({
          email: 'not-a-valid-email',
          password: 'password123',
          siteTitle: 'Test Site',
          registrationMode: 'closed',
        })
        .expect(400);

      expect(response.body.error).toBe('Invalid email format');
    });
  });

  describe('POST /api/v1/setup - Registration Mode Validation', () => {
    it('should return error for invalid registration mode', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(true);

      const response = await request(app)
        .post('/api/v1/setup')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          siteTitle: 'Test Site',
          registrationMode: 'invalid_mode',
        })
        .expect(400);

      expect(response.body.error).toBe('Invalid registration mode');
      expect(response.body.validModes).toContain('open');
      expect(response.body.validModes).toContain('apply');
      expect(response.body.validModes).toContain('invitation');
      expect(response.body.validModes).toContain('closed');
    });

    it('should accept all valid registration modes', async () => {
      const validModes = ['open', 'apply', 'invitation', 'closed'];

      for (const mode of validModes) {
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
            registrationMode: mode,
          })
          .expect(200);

        expect(response.body.success).toBe(true);

        sandbox.restore();
      }
    });
  });

  describe('POST /api/v1/setup - Service Error Handling', () => {
    it('should return 500 when completeSetup throws an error', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.resolves(true);

      const completeSetupStub = sandbox.stub(SetupService.prototype, 'completeSetup');
      completeSetupStub.rejects(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/v1/setup')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          siteTitle: 'Test Site',
          registrationMode: 'closed',
        })
        .expect(500);

      expect(response.body.error).toBe('Failed to complete setup');
    });
  });

  describe('GET /api/v1/setup/status - Error Handling', () => {
    it('should return 500 when isSetupModeActive throws an error', async () => {
      const isSetupModeActiveStub = sandbox.stub(SetupService.prototype, 'isSetupModeActive');
      isSetupModeActiveStub.rejects(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/v1/setup/status')
        .expect(500);

      expect(response.body.error).toBe('Failed to check setup status');
    });
  });
});

describe('SetupService - Cache Behavior', () => {
  let sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
    SetupService.clearCache();
  });

  it('should cache setup mode status after first query', async () => {
    const findOneStub = sandbox.stub();
    findOneStub.resolves(null);

    // Import and stub AccountRoleEntity
    const { AccountRoleEntity } = await import('@/server/common/entity/account');
    sandbox.stub(AccountRoleEntity, 'findOne').callsFake(findOneStub);

    const service = new SetupService();

    // First call should hit database
    const result1 = await service.isSetupModeActive();
    expect(result1).toBe(true);
    expect(findOneStub.callCount).toBe(1);

    // Second call should use cache
    const result2 = await service.isSetupModeActive();
    expect(result2).toBe(true);
    expect(findOneStub.callCount).toBe(1); // Still 1, didn't hit database again
  });

  it('should refresh cache after clearCache is called', async () => {
    const findOneStub = sandbox.stub();
    findOneStub.resolves(null);

    const { AccountRoleEntity } = await import('@/server/common/entity/account');
    sandbox.stub(AccountRoleEntity, 'findOne').callsFake(findOneStub);

    const service = new SetupService();

    // First call
    await service.isSetupModeActive();
    expect(findOneStub.callCount).toBe(1);

    // Clear cache
    SetupService.clearCache();

    // Next call should hit database again
    await service.isSetupModeActive();
    expect(findOneStub.callCount).toBe(2);
  });
});
