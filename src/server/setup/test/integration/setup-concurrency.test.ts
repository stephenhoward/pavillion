import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

import { AccountEntity, AccountRoleEntity, AccountSecretsEntity } from '@/server/common/entity/account';
import SetupService from '@/server/setup/service/setup';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

const PASSWORD = 'Password123!';

function setupBody(email: string, setupToken?: string) {
  return { email, password: PASSWORD, siteTitle: 'T', registrationMode: 'closed', setupToken };
}

/**
 * Integration tests for first-run setup against a real SQLite database.
 *
 * SQLite's `=` on TEXT is case-sensitive, so only a real round-trip proves the
 * admin email is stored normalized and that login with a different case finds
 * it. Likewise only real interleaved requests prove that two concurrent setup
 * posts produce exactly one admin, and that a request without the setup
 * token logged at boot creates nothing.
 */
describe('First-run setup (integration, real SQLite DB)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  let setupToken: string;

  beforeEach(async () => {
    await AccountRoleEntity.destroy({ where: {}, truncate: true });
    await AccountSecretsEntity.destroy({ where: {}, truncate: true });
    await AccountEntity.destroy({ where: {}, truncate: true });
    SetupService.clearCache();
    // What boot does once the database is ready; the token is the one an
    // operator would read from the log.
    setupToken = (await SetupService.issueSetupToken())!;
  });

  it('rejects setup without the token with 403 and creates no admin', async () => {
    const response = await request(env.app)
      .post('/api/v1/setup')
      .send(setupBody('admin@example.org'));

    expect(response.status).toBe(403);
    expect(response.body.errorName).toBe('SetupTokenInvalidError');
    expect(await AccountRoleEntity.count({ where: { role: 'admin' } })).toBe(0);
    expect(await AccountEntity.count()).toBe(0);
  });

  it('rejects setup with a wrong token with 403 and creates no admin', async () => {
    const response = await request(env.app)
      .post('/api/v1/setup')
      .send(setupBody('admin@example.org', 'f'.repeat(32)));

    expect(response.status).toBe(403);
    expect(response.body.errorName).toBe('SetupTokenInvalidError');
    expect(await AccountRoleEntity.count({ where: { role: 'admin' } })).toBe(0);
    expect(await AccountEntity.count()).toBe(0);
  });

  it('creates the admin with the issued token and never returns the token', async () => {
    const statusResponse = await request(env.app).get('/api/v1/setup/status');
    const rejected = await request(env.app)
      .post('/api/v1/setup')
      .send(setupBody('admin@example.org', 'wrong'));
    const accepted = await request(env.app)
      .post('/api/v1/setup')
      .send(setupBody('admin@example.org', setupToken));

    expect(accepted.status).toBe(200);
    expect(await AccountRoleEntity.count({ where: { role: 'admin' } })).toBe(1);
    for (const response of [statusResponse, rejected, accepted]) {
      expect(response.text).not.toContain(setupToken);
    }
  });

  it('does not accept the token again once setup is complete', async () => {
    await request(env.app).post('/api/v1/setup').send(setupBody('admin@example.org', setupToken));
    await AccountRoleEntity.destroy({ where: {}, truncate: true });
    SetupService.clearCache();

    const response = await request(env.app)
      .post('/api/v1/setup')
      .send(setupBody('second@example.org', setupToken));

    expect(response.status).toBe(403);
    expect(await AccountRoleEntity.count({ where: { role: 'admin' } })).toBe(0);
  });

  it('stores the admin email normalized so a lowercase login succeeds', async () => {
    const setupResponse = await request(env.app)
      .post('/api/v1/setup')
      .send(setupBody('Admin@Example.org', setupToken));
    expect(setupResponse.status).toBe(200);

    const stored = await AccountEntity.findOne();
    expect(stored?.email).toBe('admin@example.org');

    const loginResponse = await request(env.app)
      .post('/api/auth/v1/login')
      .send({ email: 'admin@example.org', password: PASSWORD });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.text.length).toBeGreaterThan(0);
  });

  it('lets only one of two concurrent setup requests create an admin', async () => {
    const [a, b] = await Promise.all([
      request(env.app).post('/api/v1/setup').send(setupBody('first@example.org', setupToken)),
      request(env.app).post('/api/v1/setup').send(setupBody('second@example.org', setupToken)),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const loser = a.status === 404 ? a : b;
    expect(loser.body).toEqual({ error: 'Setup already completed', errorName: 'NotFoundError' });

    expect(await AccountRoleEntity.count({ where: { role: 'admin' } })).toBe(1);
    expect(await AccountEntity.count()).toBe(1);
  });
});
