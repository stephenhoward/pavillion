import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import main from '@/server/app';

/**
 * Integration test to verify that widget HTML pages have the correct CSP headers
 * to allow embedding in iframes.
 *
 * This fixes pv-zdao: Widget page blocked by CSP frame-ancestors
 *
 * Note: These tests may return 503 status in setup mode (when no admin exists),
 * but the CSP headers should still be set correctly.
 */
describe('Widget Page CSP Headers', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await main();
  });

  it('should allow widget pages to be framed with frame-ancestors *', async () => {
    const response = await request(app)
      .get('/widget/admin');

    // Widget page should return successfully (200) now that /widget is exempt from setup mode
    expect(response.status).toBe(200);

    // CSP header should allow framing from any origin
    // This is critical for embedding the widget in external websites
    const cspHeader = response.headers['content-security-policy'];
    expect(cspHeader).toBeDefined();
    expect(cspHeader).toBe('frame-ancestors *');
  });

  it('should not affect non-widget pages CSP', async () => {
    const response = await request(app)
      .get('/');

    // Homepage should not allow framing (default security)
    const cspHeader = response.headers['content-security-policy'];
    expect(cspHeader).toBeDefined();
    expect(cspHeader).toContain("frame-ancestors 'none'");
  });
});
