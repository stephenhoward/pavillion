import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import config from 'config';

import { createAccountRateLimiter } from '@/server/common/middleware/rate-limit-by-account';
import { limitNotificationsByAccount } from '@/server/common/middleware/rate-limiters';

describe('notification list rate limit', () => {
  const max = config.get<number>('rateLimit.notifications.byAccount.max');
  const windowMs = config.get<number>('rateLimit.notifications.byAccount.windowMs');

  it('is configured as 60 requests per minute per account', () => {
    expect(max).toBe(60);
    expect(windowMs).toBe(60000);
  });

  it('stays above the notification poll\'s designed load', () => {
    // The client polls every 30s per tab (2/min) plus focus and inbox fetches.
    expect(max).toBeGreaterThanOrEqual(20);
  });

  it('exports the configured limiter', () => {
    expect(typeof limitNotificationsByAccount).toBe('function');
  });

  it('allows `max` requests in a window and rejects the next with 429', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: 'account-1' };
      next();
    });
    app.get('/notification', createAccountRateLimiter(max, windowMs, 'notifications'), (_req, res) => {
      res.json([]);
    });

    for (let i = 0; i < max; i++) {
      const res = await request(app).get('/notification');
      expect(res.status).toBe(200);
    }
    const limited = await request(app).get('/notification');
    expect(limited.status).toBe(429);
    expect(limited.body.errorName).toBe('RateLimitError');
  });
});
