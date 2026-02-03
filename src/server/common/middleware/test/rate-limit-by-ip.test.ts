import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { createIpRateLimiter } from '../rate-limit-by-ip';

describe('createIpRateLimiter', () => {
  let app: Express;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    app = express();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('should allow requests within the rate limit', async () => {
    // Create limiter that allows 3 requests per 1 second
    const limiter = createIpRateLimiter(3, 1000, 'test-endpoint');

    app.get('/test', limiter, (req, res) => {
      res.json({ success: true });
    });

    // Make 3 requests - all should succeed
    const response1 = await request(app).get('/test');
    expect(response1.status).toBe(200);
    expect(response1.body).toEqual({ success: true });

    const response2 = await request(app).get('/test');
    expect(response2.status).toBe(200);
    expect(response2.body).toEqual({ success: true });

    const response3 = await request(app).get('/test');
    expect(response3.status).toBe(200);
    expect(response3.body).toEqual({ success: true });

    // Should not have logged any warnings yet
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should block requests exceeding the rate limit', async () => {
    // Create limiter that allows 2 requests per 1 second
    const limiter = createIpRateLimiter(2, 1000, 'test-endpoint');

    app.get('/test', limiter, (req, res) => {
      res.json({ success: true });
    });

    // Make 2 successful requests
    await request(app).get('/test');
    await request(app).get('/test');

    // Third request should be blocked
    const response = await request(app).get('/test');
    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: "Too many test-endpoint requests from this IP, please try again later.",
    });
  });

  it('should log rate limit exceeded with IP and endpoint name', async () => {
    const limiter = createIpRateLimiter(1, 1000, 'password-reset');

    app.get('/test', limiter, (req, res) => {
      res.json({ success: true });
    });

    // First request succeeds
    await request(app).get('/test');

    // Second request should be blocked and logged
    await request(app).get('/test');

    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    const logMessage = consoleWarnSpy.mock.calls[0][0];
    expect(logMessage).toContain('Rate limit exceeded for IP');
    expect(logMessage).toContain('on password-reset');
  });

  it('should include rate limit headers in response', async () => {
    const limiter = createIpRateLimiter(5, 60000, 'test-endpoint');

    app.get('/test', limiter, (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app).get('/test');

    // Check for standard rate limit headers
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBeDefined();
    expect(response.headers['ratelimit-reset']).toBeDefined();
  });

  it('should reset rate limit after window expires', async () => {
    // Create limiter with very short window (100ms)
    const limiter = createIpRateLimiter(1, 100, 'test-endpoint');

    app.get('/test', limiter, (req, res) => {
      res.json({ success: true });
    });

    // First request succeeds
    const response1 = await request(app).get('/test');
    expect(response1.status).toBe(200);

    // Second request immediately should be blocked
    const response2 = await request(app).get('/test');
    expect(response2.status).toBe(429);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    // Third request should succeed after window reset
    const response3 = await request(app).get('/test');
    expect(response3.status).toBe(200);
  });

  it('should handle different endpoints independently', async () => {
    const limiter1 = createIpRateLimiter(1, 1000, 'endpoint-1');
    const limiter2 = createIpRateLimiter(1, 1000, 'endpoint-2');

    app.get('/endpoint1', limiter1, (req, res) => {
      res.json({ endpoint: 1 });
    });

    app.get('/endpoint2', limiter2, (req, res) => {
      res.json({ endpoint: 2 });
    });

    // Use up limit on endpoint1
    await request(app).get('/endpoint1');
    const blockedResponse = await request(app).get('/endpoint1');
    expect(blockedResponse.status).toBe(429);

    // endpoint2 should still work
    const successResponse = await request(app).get('/endpoint2');
    expect(successResponse.status).toBe(200);
    expect(successResponse.body).toEqual({ endpoint: 2 });
  });

  it('should count both successful and failed requests', async () => {
    const limiter = createIpRateLimiter(2, 1000, 'test-endpoint');

    app.get('/test', limiter, (req, res) => {
      // Simulate some requests failing
      if (req.query.fail === 'true') {
        res.status(400).json({ error: 'Bad request' });
      }
      else {
        res.json({ success: true });
      }
    });

    // One successful request
    await request(app).get('/test');

    // One failed request (should still count towards limit)
    await request(app).get('/test?fail=true');

    // Third request should be blocked by rate limiter
    const response = await request(app).get('/test');
    expect(response.status).toBe(429);
  });

  it('should use correct endpoint name in logs for different limiters', async () => {
    const loginLimiter = createIpRateLimiter(1, 1000, 'login');
    const resetLimiter = createIpRateLimiter(1, 1000, 'password-reset');

    app.post('/login', loginLimiter, (req, res) => res.json({ ok: true }));
    app.post('/reset', resetLimiter, (req, res) => res.json({ ok: true }));

    // Exhaust login limit
    await request(app).post('/login');
    await request(app).post('/login');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('on login'),
    );

    consoleWarnSpy.mockClear();

    // Exhaust reset limit
    await request(app).post('/reset');
    await request(app).post('/reset');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('on password-reset'),
    );
  });

  it('should handle missing IP address gracefully', async () => {
    const limiter = createIpRateLimiter(1, 1000, 'test-endpoint');

    app.get('/test', limiter, (req, res) => {
      res.json({ success: true });
    });

    // First request
    await request(app).get('/test');

    // Second request that will be blocked
    await request(app).get('/test');

    // Should log with IP (even if it's 'unknown')
    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    const logMessage = consoleWarnSpy.mock.calls[0][0];
    expect(logMessage).toMatch(/Rate limit exceeded for IP .+ on test-endpoint/);
  });
});
