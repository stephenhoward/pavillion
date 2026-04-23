import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { createParamRateLimiter } from '../rate-limit-by-param';

/**
 * Unit tests for createParamRateLimiter — mirrors rate-limit-by-ip.test.ts
 * patterns. Focus areas:
 *
 *  - within limit → 200
 *  - beyond limit → 429 with the documented errorName contract
 *  - per-param keying isolation (two different route-param values run in
 *    independent buckets under the same limiter instance)
 *  - missing param falls back to the 'unknown' key (no crash)
 *
 * Bucket isolation across different param values is the headline invariant
 * — without it a single misbehaving resource would exhaust rate limits for
 * every other resource on the same endpoint.
 */
describe('createParamRateLimiter', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
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

  it('blocks requests exceeding the rate limit with 429 + errorName', async () => {
    const limiter = createParamRateLimiter(2, 1000, 'import-source-sync', 'id');

    app.post('/resource/:id', limiter, (req, res) => {
      res.json({ success: true });
    });

    await request(app).post('/resource/source-a');
    await request(app).post('/resource/source-a');
    const blocked = await request(app).post('/resource/source-a');

    expect(blocked.status).toBe(429);
    // Documents the current errorName contract — the implementation reports
    // 'ImportSourceVerifyRateLimitError' for every param-keyed limiter. If
    // that is ever parameterized (see the deferred follow-up), this test
    // will need to be updated.
    expect(blocked.body.errorName).toBe('ImportSourceVerifyRateLimitError');
    expect(typeof blocked.body.error).toBe('string');
    expect(blocked.body.error).toContain('import-source-sync');
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

  it('falls back to the "unknown" key when the named param is missing', async () => {
    // Limit is 1-per-window under the 'unknown' key. If the keyGenerator
    // gracefully degrades, the middleware should still enforce a limit (not
    // crash, not silently let every request through).
    const limiter = createParamRateLimiter(1, 1000, 'missing-param', 'id');

    app.get('/no-param', limiter, (req, res) => {
      res.json({ success: true });
    });

    const first = await request(app).get('/no-param');
    expect(first.status).toBe(200);

    // Second call falls into the same 'unknown' bucket and is rate-limited —
    // this is the current behaviour. All callers with a missing param share
    // one bucket regardless of IP or auth identity. Documented here so a
    // future change (e.g. fall back to IP-keyed instead) is caught loudly.
    const second = await request(app).get('/no-param');
    expect(second.status).toBe(429);
    expect(second.body.errorName).toBe('ImportSourceVerifyRateLimitError');
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
