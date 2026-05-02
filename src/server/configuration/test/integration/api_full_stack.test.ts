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

    it('accepts admin POST with valid instancePolicy and round-trips markdown source', async () => {
      const markdownSource = '## Community guidelines\n\nBe excellent.';
      const response = await request(env.app)
        .post('/api/config/v1/site')
        .set('Authorization', 'Bearer ' + adminAuthKey)
        .send({ instancePolicy: { en: markdownSource } });

      expect(response.status).toBe(200);

      // Markdown is now stored at rest and rendered at view time. The GET
      // response must return the raw markdown source verbatim — no <h2>,
      // <p>, or other rendered HTML tags should appear in the payload.
      const getResponse = await request(env.app).get('/api/config/v1/site');
      expect(getResponse.status).toBe(200);
      expect(getResponse.body.instancePolicy).toHaveProperty('en');
      const storedSource = getResponse.body.instancePolicy.en as string;
      expect(storedSource).toBe(markdownSource);
      expect(storedSource).not.toContain('<h2');
      expect(storedSource).not.toContain('<p>');
    });

    it('rejects admin POST with unsafe instancePolicy and does not mutate the column', async () => {
      // First, seed a known-good value so we can assert the column was NOT
      // overwritten by the rejected request.
      const safeSource = '## Safe baseline\n\nThis must remain after the rejection.';
      const seedResponse = await request(env.app)
        .post('/api/config/v1/site')
        .set('Authorization', 'Bearer ' + adminAuthKey)
        .send({ instancePolicy: { en: safeSource } });
      expect(seedResponse.status).toBe(200);

      // Payload contains content that DOMPurify would strip: a raw <script>
      // tag and a javascript: URL inside a markdown link. The dry-render
      // check in setInstancePolicy must reject the whole batch.
      const unsafeSource =
        '<script>alert(1)</script>\n\n[bad](javascript:foo)\n\n<a href="javascript:alert(1)">click</a>';
      const response = await request(env.app)
        .post('/api/config/v1/site')
        .set('Authorization', 'Bearer ' + adminAuthKey)
        .send({ instancePolicy: { en: unsafeSource } });

      expect(response.status).toBe(400);

      // Read-after-failure: the column must still hold the prior safe value,
      // and none of the dangerous payload may appear anywhere in it.
      const getResponse = await request(env.app).get('/api/config/v1/site');
      expect(getResponse.status).toBe(200);
      const storedSource = getResponse.body.instancePolicy.en as string;
      expect(storedSource).toBe(safeSource);
      expect(storedSource).not.toContain('<script');
      expect(storedSource).not.toContain('javascript:');
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
