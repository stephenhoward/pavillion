import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';

const { warnStub } = vi.hoisted(() => ({ warnStub: vi.fn() }));

vi.mock('@/server/common/helper/logger', () => ({
  createLogger: () => ({
    warn: warnStub,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  default: {
    warn: warnStub,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import db from '@/server/common/entity/db';
import { AccountRoleEntity } from '@/server/common/entity/account';
import SetupService from '@/server/setup/service/setup';
import SetupInterface from '@/server/setup/interface';
import SetupRouteHandlers from '@/server/setup/api/v1/setup';
import ConfigurationInterface from '@/server/configuration/interface';
import { SetupTokenInvalidError } from '@/server/setup/exceptions';

function buildMockConfigInterface(): ConfigurationInterface {
  return {
    setSetting: sinon.stub().resolves(true),
    getInstancePolicy: sinon.stub().resolves({}),
    setInstancePolicy: sinon.stub().resolves(true),
  } as unknown as ConfigurationInterface;
}

const PASSWORD = 'Password123!';

/**
 * The setup token closes the first-run window: until an admin exists, anyone
 * who reaches the instance could otherwise claim it. Only the operator, who
 * can read the server log, holds the token.
 */
describe('SetupService setup token', () => {
  const sandbox = sinon.createSandbox();
  let service: SetupService;

  beforeEach(() => {
    warnStub.mockClear();
    service = new SetupService(buildMockConfigInterface());
  });

  afterEach(() => {
    sandbox.restore();
    SetupService.clearCache();
  });

  describe('issueSetupToken', () => {
    it('issues a 32-character hex token and logs it once at warn, naming the setup page', async () => {
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);

      const token = await SetupService.issueSetupToken();

      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(warnStub).toHaveBeenCalledTimes(1);
      const message = warnStub.mock.calls[0].join(' ');
      expect(message).toContain(token);
      expect(message).toContain('/setup');
    });

    it('issues a different token each time, as a restart does', async () => {
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);

      const first = await SetupService.issueSetupToken();
      const second = await SetupService.issueSetupToken();

      expect(second).not.toBe(first);
    });

    it('issues nothing and logs nothing when an admin exists', async () => {
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(
        AccountRoleEntity.build({ account_id: 'id', role: 'admin' }),
      );

      const token = await SetupService.issueSetupToken();

      expect(token).toBeNull();
      expect(warnStub).not.toHaveBeenCalled();
    });

    it('does not populate the setup-mode cache', async () => {
      const findOne = sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);

      await SetupService.issueSetupToken();
      findOne.resolves(AccountRoleEntity.build({ account_id: 'id', role: 'admin' }));

      expect(await service.isSetupModeActive()).toBe(false);
    });
  });

  describe('completeSetup', () => {
    let transaction: sinon.SinonStub;

    beforeEach(() => {
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);
      transaction = sandbox.stub(db, 'transaction').resolves();
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['wrong', 'f'.repeat(32)],
      ['wrong length', 'abc'],
    ])('rejects a %s token and writes nothing', async (_label, candidate) => {
      await SetupService.issueSetupToken();

      await expect(
        service.completeSetup('a@example.org', PASSWORD, 'T', 'closed', 'en', candidate as string),
      ).rejects.toBeInstanceOf(SetupTokenInvalidError);
      expect(transaction.called).toBe(false);
    });

    it('rejects every token when none has been issued', async () => {
      const token = await SetupService.issueSetupToken();
      (AccountRoleEntity.findOne as sinon.SinonStub).resolves(
        AccountRoleEntity.build({ account_id: 'id', role: 'admin' }),
      );
      await SetupService.issueSetupToken();

      await expect(
        service.completeSetup('a@example.org', PASSWORD, 'T', 'closed', 'en', token!),
      ).rejects.toBeInstanceOf(SetupTokenInvalidError);
    });

    it('completes setup with the issued token, then retires it', async () => {
      const token = await SetupService.issueSetupToken();

      await expect(
        service.completeSetup('a@example.org', PASSWORD, 'T', 'closed', 'en', token!),
      ).resolves.toBe(true);
      expect(transaction.calledOnce).toBe(true);

      await expect(
        service.completeSetup('a@example.org', PASSWORD, 'T', 'closed', 'en', token!),
      ).rejects.toBeInstanceOf(SetupTokenInvalidError);
    });
  });
});

describe('POST /api/v1/setup token handling', () => {
  const sandbox = sinon.createSandbox();
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    const handlers = new SetupRouteHandlers(new SetupInterface(buildMockConfigInterface()));
    handlers.installHandlers(app, '/api/v1');
    sandbox.stub(SetupService.prototype, 'isSetupModeActive').resolves(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('passes the token from the body to the service', async () => {
    const completeSetup = sandbox.stub(SetupService.prototype, 'completeSetup').resolves(true);

    await request(app)
      .post('/api/v1/setup')
      .send({ email: 'a@example.org', password: PASSWORD, siteTitle: 'T', registrationMode: 'closed', setupToken: 'tok' })
      .expect(200);

    expect(completeSetup.firstCall.args[5]).toBe('tok');
  });

  it('answers a rejected token with 403 and the serialized error name', async () => {
    sandbox.stub(SetupService.prototype, 'completeSetup').rejects(new SetupTokenInvalidError());

    const response = await request(app)
      .post('/api/v1/setup')
      .send({ email: 'a@example.org', password: PASSWORD, siteTitle: 'T', registrationMode: 'closed' })
      .expect(403);

    expect(response.body).toEqual({ error: 'Invalid setup token', errorName: 'SetupTokenInvalidError' });
  });
});
