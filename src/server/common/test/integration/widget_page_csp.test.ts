import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import main from '@/server/app';
import { CalendarEntity } from '@/server/calendar/entity/calendar';

/**
 * Integration test for the widget HTML shell's framing policy.
 *
 * The shell's frame-ancestors follows each calendar's Allowed Domain
 * (DEC-020): a configured domain permits it and its www twin; with none
 * configured only the instance itself ('self') and localhost may frame it.
 *
 * Note: These tests may return 503 status in setup mode (when no admin exists),
 * but the CSP headers should still be set correctly.
 */
describe('Widget Page CSP Headers', () => {
  let app: express.Application;
  const configuredUrlName = `csp_configured_${uuidv4().slice(0, 8)}`;
  const unconfiguredUrlName = `csp_open_${uuidv4().slice(0, 8)}`;

  beforeAll(async () => {
    app = await main();

    await CalendarEntity.bulkCreate([
      { id: uuidv4(), url_name: configuredUrlName, languages: 'en', widget_allowed_domain: 'example.com' },
      { id: uuidv4(), url_name: unconfiguredUrlName, languages: 'en', widget_allowed_domain: null },
    ]);
  });

  afterAll(async () => {
    await CalendarEntity.destroy({
      where: { url_name: [configuredUrlName, unconfiguredUrlName] },
      force: true,
    });
  });

  /**
   * The space-separated sources of a frame-ancestors header value.
   */
  function frameSources(cspHeader: string): string[] {
    expect(cspHeader.startsWith('frame-ancestors ')).toBe(true);
    return cspHeader.slice('frame-ancestors '.length).split(' ');
  }

  it('should permit a configured domain and its www twin', async () => {
    const response = await request(app).get(`/widget/${configuredUrlName}`);

    expect(response.status).toBe(200);
    const sources = frameSources(response.headers['content-security-policy']);
    expect(sources).toContain("'self'");
    expect(sources).toContain('https://example.com:*');
    expect(sources).toContain('https://www.example.com:*');
    expect(sources).not.toContain('*');
  });

  it('should permit only self and localhost for a calendar with no domain', async () => {
    const response = await request(app).get(`/widget/${unconfiguredUrlName}`);

    expect(response.status).toBe(200);
    const sources = frameSources(response.headers['content-security-policy']);
    expect(sources[0]).toBe("'self'");
    expect(sources.filter(s => !s.startsWith('http://localhost') && !s.startsWith('http://127.0.0.1') && !s.startsWith('http://*.localhost')))
      .toEqual(["'self'"]);
  });

  it('should answer an unknown calendar exactly as an unconfigured one', async () => {
    const unknown = await request(app).get('/widget/no_such_calendar');
    const unconfigured = await request(app).get(`/widget/${unconfiguredUrlName}`);

    expect(unknown.headers['content-security-policy'])
      .toBe(unconfigured.headers['content-security-policy']);
  });

  it('should not affect non-widget pages CSP', async () => {
    const response = await request(app)
      .get('/');

    // Homepage should not allow framing (default security)
    const cspHeader = response.headers['content-security-policy'];
    expect(cspHeader).toBeDefined();
    expect(cspHeader).toContain("frame-ancestors 'none'");
  });

  it('should not have X-Frame-Options: DENY on widget pages', async () => {
    const response = await request(app).get('/widget/testcalendar');
    expect(response.headers['x-frame-options']).toBeUndefined();
  });
});
