import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

// Intercept the shared logger so we can assert the warn payload shape.
// The factory must return a function that returns the logger object (the
// real module exports `createLogger(domain)` which returns a pino-ish
// child). Using vi.hoisted lets us reference the stub object in both the
// mock factory and the assertions below.
const { warnStub } = vi.hoisted(() => {
  return { warnStub: vi.fn() };
});
vi.mock('@/server/common/helper/logger', () => ({
  createLogger: () => ({
    warn: warnStub,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createParamRateLimiter } from '@/server/common/middleware/rate-limit-by-param';

/**
 * Unit tests for createParamRateLimiter — mirrors rate-limit-by-ip.test.ts
 * patterns. Focus areas:
 *
 *  - within limit → 200
 *  - beyond limit → 429 with the configured errorName
 *  - per-param keying isolation (two different route-param values run in
 *    independent buckets under the same limiter instance)
 *  - missing param falls back to the caller's IP (buckets stay isolated
 *    across callers even without the expected param)
 *  - warn log omits the resource identifier (privacy-playbook)
 *  - errorName defaults to 'RateLimitError' when not supplied
 */
describe('createParamRateLimiter', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    warnStub.mockClear();
  });

  it('allows requests within the rate limit', async () => {
    const limiter = createParamRateLimiter(3, 1000, 'test-endpoint', 'id');

    app.get('/resource/:id', limiter, (req, res) => {
      res.json({ success: true, id: req.params.id });
    });

    const res1 = await request(app).get('/resource/source-a');
    expect(res1.status).toBe(200);
    const res2 = await request(app).get('/resource/source-a');
    expect(res2.status).toBe(200);
    const res3 = await request(app).get('/resource/source-a');
    expect(res3.status).toBe(200);
  });

  it('blocks requests exceeding the rate limit with 429 + configured errorName', async () => {
    const limiter = createParamRateLimiter(
      2, 1000, 'import-source-sync', 'id', 'ImportSourceSyncRateLimitError',
    );

    app.post('/resource/:id', limiter, (req, res) => {
      res.json({ success: true });
    });

    await request(app).post('/resource/source-a');
    await request(app).post('/resource/source-a');
    const blocked = await request(app).post('/resource/source-a');

    expect(blocked.status).toBe(429);
    expect(blocked.body.errorName).toBe('ImportSourceSyncRateLimitError');
    expect(typeof blocked.body.error).toBe('string');
    expect(blocked.body.error).toContain('import-source-sync');
  });

  it('defaults errorName to "RateLimitError" when no override is supplied', async () => {
    const limiter = createParamRateLimiter(1, 1000, 'default-name', 'id');

    app.post('/resource/:id', limiter, (req, res) => {
      res.json({ success: true });
    });

    await request(app).post('/resource/source-a');
    const blocked = await request(app).post('/resource/source-a');

    expect(blocked.status).toBe(429);
    expect(blocked.body.errorName).toBe('RateLimitError');
  });

  it('isolates buckets per param value (different param values do not share a limit)', async () => {
    // Limit is 1-per-window per param value. Under proper isolation, hitting
    // source-a once and then source-b once should both succeed — the second
    // call for EACH param value should be the one that gets blocked.
    const limiter = createParamRateLimiter(1, 1000, 'per-resource', 'id');

    app.post('/resource/:id', limiter, (req, res) => {
      res.json({ success: true, id: req.params.id });
    });

    const a1 = await request(app).post('/resource/source-a');
    expect(a1.status).toBe(200);

    const b1 = await request(app).post('/resource/source-b');
    expect(b1.status).toBe(200);

    // source-a's bucket is exhausted, but source-b's should still be open.
    const a2 = await request(app).post('/resource/source-a');
    expect(a2.status).toBe(429);

    // ...and vice versa.
    const b2 = await request(app).post('/resource/source-b');
    expect(b2.status).toBe(429);
  });

  it('falls back to the caller IP when the named param is missing', async () => {
    // When the expected route param is absent, the limiter must fall back
    // to the caller's IP rather than collapsing all callers into one
    // 'unknown' bucket. This test proves the IP-keyed fallback by enforcing
    // a per-IP limit on a route with no :id segment.
    const limiter = createParamRateLimiter(1, 1000, 'missing-param', 'id');

    app.get('/no-param', limiter, (req, res) => {
      res.json({ success: true });
    });

    const first = await request(app).get('/no-param');
    expect(first.status).toBe(200);

    // Second call from the same supertest client (same IP) is limited.
    const second = await request(app).get('/no-param');
    expect(second.status).toBe(429);
    // Default errorName applies when not parameterized.
    expect(second.body.errorName).toBe('RateLimitError');
  });

  it('omits the resource identifier from the rate-limit warn log', async () => {
    // privacy-playbook: resource UUIDs are stable per-resource identifiers
    // and must not appear in non-debug logs. This test locks the log
    // payload to { param, endpoint } only.
    const limiter = createParamRateLimiter(1, 1000, 'privacy-endpoint', 'id');

    app.post('/resource/:id', limiter, (req, res) => {
      res.json({ success: true });
    });

    await request(app).post('/resource/source-secret-id-abc');
    const blocked = await request(app).post('/resource/source-secret-id-abc');
    expect(blocked.status).toBe(429);

    expect(warnStub).toHaveBeenCalled();
    const firstCall = warnStub.mock.calls[0];
    const payload = firstCall[0] as Record<string, unknown>;

    expect(payload).toMatchObject({ param: 'id', endpoint: 'privacy-endpoint' });
    // The resource UUID must NOT be logged (no `value` field).
    expect(payload).not.toHaveProperty('value');
    // Defense-in-depth: the secret id string should not appear in the
    // payload under any key.
    expect(JSON.stringify(payload)).not.toContain('source-secret-id-abc');
  });

  it('includes standard rate-limit headers', async () => {
    const limiter = createParamRateLimiter(5, 60000, 'test-endpoint', 'id');

    app.get('/resource/:id', limiter, (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app).get('/resource/source-a');

    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBeDefined();
    expect(response.headers['ratelimit-reset']).toBeDefined();
  });
});
