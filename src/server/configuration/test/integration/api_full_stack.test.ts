import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';

import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

describe('Configuration site API — full stack', () => {
  let env: TestEnvironment;
  let adminAuthKey: string;
  let nonAdminAuthKey: string;

  const adminEmail = 'admin-config-fullstack@pavillion.dev';
  const adminPassword = 'admin-pw-1';
  const nonAdminEmail = 'user-config-fullstack@pavillion.dev';
  const nonAdminPassword = 'user-pw-1';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // First account becomes admin in test mode
    await accountService._setupAccount(adminEmail, adminPassword);
    // Second account is non-admin
    await accountService._setupAccount(nonAdminEmail, nonAdminPassword);

    adminAuthKey = await env.login(adminEmail, adminPassword);
    nonAdminAuthKey = await env.login(nonAdminEmail, nonAdminPassword);
  });

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  describe('GET /api/config/v1/site (public)', () => {
    it('returns 200 for anonymous callers and includes instancePolicy', async () => {
      const response = await request(env.app).get('/api/config/v1/site');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('instancePolicy');
      // Empty object is the expected shape when no policy is configured
      expect(typeof response.body.instancePolicy).toBe('object');
    });
  });

  describe('POST /api/config/v1/site auth', () => {
    it('rejects unauthenticated POST with 401', async () => {
      const response = await request(env.app)
        .post('/api/config/v1/site')
        .send({ instancePolicy: { en: '<p>hi</p>' } });

      expect(response.status).toBe(401);
    });

    it('rejects non-admin authenticated POST with 401 or 403', async () => {
      const response = await request(env.app)
        .post('/api/config/v1/site')
        .set('Authorization', 'Bearer ' + nonAdminAuthKey)
        .send({ instancePolicy: { en: '<p>hi</p>' } });

      // ExpressHelper.adminOnly returns 401 for missing or insufficient role,
      // some auth middleware uses 403 — accept either to avoid coupling to
      // the specific status the middleware emits.
      expect([401, 403]).toContain(response.status);
    });

    it('accepts admin POST with valid instancePolicy', async () => {
      const response = await request(env.app)
        .post('/api/config/v1/site')
        .set('Authorization', 'Bearer ' + adminAuthKey)
        .send({ instancePolicy: { en: '## Community guidelines\n\nBe excellent.' } });

      expect(response.status).toBe(200);

      // Verify the policy was persisted and round-trips through GET
      const getResponse = await request(env.app).get('/api/config/v1/site');
      expect(getResponse.status).toBe(200);
      expect(getResponse.body.instancePolicy).toHaveProperty('en');
      // Stored as sanitized HTML; should contain rendered headings/paragraphs
      const storedHtml = getResponse.body.instancePolicy.en as string;
      expect(storedHtml).toContain('Community guidelines');
      expect(storedHtml).toContain('Be excellent.');
      // Sanitization stripped any dangerous content that wasn't there to begin with
      expect(storedHtml).not.toContain('<script');
    });
  });

  describe('Body-size limit (512kb)', () => {
    it('rejects oversized payloads with 413', async () => {
      // 600KB of content well over the 512kb limit
      const oversized = 'x'.repeat(600 * 1024);
      const response = await request(env.app)
        .post('/api/config/v1/site')
        .set('Authorization', 'Bearer ' + adminAuthKey)
        .send({ instancePolicy: { en: oversized } });

      expect(response.status).toBe(413);
    });

    it('accepts payloads near the cap (~350KB)', async () => {
      // 350KB of safe text — comfortably under 512kb total payload size
      const nearCap = 'word '.repeat(70 * 1024);
      const response = await request(env.app)
        .post('/api/config/v1/site')
        .set('Authorization', 'Bearer ' + adminAuthKey)
        .send({ instancePolicy: { en: nearCap } });

      // The service may still 400 if the per-language length cap is hit,
      // but we are specifically asserting that the body-size cap doesn't
      // prematurely 413 on legitimate content.
      expect(response.status).not.toBe(413);
    });
  });
});
