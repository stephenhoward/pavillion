import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import { router, handlers } from '@/server/app_routes';
import ServiceSettings from '@/server/configuration/service/settings';

/**
 * Builds a minimal Express app that installs the locale middleware stub
 * (setting req.locale) and mounts the index router.
 *
 * The view engine is replaced with a spy so we can assert on render calls
 * without needing actual EJS templates on disk.
 */
function buildTestApp(locale = 'en'): Express {
  const app = express();

  // Stub locale middleware: set req.locale to the supplied value
  app.use((req: Request, _res: Response, next) => {
    req.locale = locale;
    next();
  });

  // Replace the view-engine render with a simple JSON responder
  // so tests can verify which template is rendered and with what data.
  app.use((req: Request, res: Response, next) => {
    res.render = ((template: string, data?: object) => {
      res.json({ template, data });
    }) as any;
    next();
  });

  app.use('/', router);

  return app;
}

describe('app_routes', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // -----------------------------------------------------------------------
  // Unprefixed site routes (default language — as-needed strategy)
  // -----------------------------------------------------------------------

  describe('unprefixed site routes', () => {
    it('should serve site.index.html.ejs for /@calendar', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/@mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve site.index.html.ejs for /@calendar/event/123', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/@mycalendar/event/123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should pass locale from req.locale to the template', async () => {
      const app = buildTestApp('es');
      const res = await request(app).get('/@mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.data.locale).toBe('es');
    });

    it('should pass non-empty hreflangLinks array to the template', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('en');
      const res = await request(app).get('/@mycalendar');

      expect(res.status).toBe(200);
      const links = res.body.data?.hreflangLinks;
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBeGreaterThan(0);
      // should include x-default
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'x-default')).toBe(true);
    });

    it('should include hreflang entries for all enabled languages', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('en');
      const res = await request(app).get('/@mycalendar');

      const links = res.body.data?.hreflangLinks;
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'en')).toBe(true);
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'es')).toBe(true);
    });

    it('should include canonical path in hreflang hrefs', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('en');
      const res = await request(app).get('/@mycalendar');

      const links = res.body.data?.hreflangLinks;
      const enLink = links.find((l: { hreflang: string }) => l.hreflang === 'en');
      expect(enLink?.href).toContain('/@mycalendar');
      const esLink = links.find((l: { hreflang: string }) => l.hreflang === 'es');
      expect(esLink?.href).toContain('/es/@mycalendar');
    });
  });

  // -----------------------------------------------------------------------
  // Locale-prefixed site routes: non-default language
  // -----------------------------------------------------------------------

  describe('locale-prefixed site routes — non-default language', () => {
    it('should serve site.index.html.ejs for /es/@calendar when es is not the default', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('es');
      const res = await request(app).get('/es/@mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should pass locale from req.locale to the template for prefixed routes', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('es');
      const res = await request(app).get('/es/@mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.data.locale).toBe('es');
    });

    it('should serve site.index.html.ejs for /es/@calendar/event/123', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('es');
      const res = await request(app).get('/es/@mycalendar/event/123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should pass non-empty hreflangLinks array for locale-prefixed routes', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('es');
      const res = await request(app).get('/es/@mycalendar');

      expect(res.status).toBe(200);
      const links = res.body.data?.hreflangLinks;
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBeGreaterThan(0);
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'x-default')).toBe(true);
    });

    it('should use stripped path (without locale prefix) in hreflang hrefs', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('es');
      const res = await request(app).get('/es/@mycalendar');

      const links = res.body.data?.hreflangLinks;
      // x-default points to the unprefixed canonical URL
      const xDefault = links.find((l: { hreflang: string }) => l.hreflang === 'x-default');
      expect(xDefault?.href).toContain('/@mycalendar');
      expect(xDefault?.href).not.toContain('/es/@mycalendar');
      // es link should have /es/ prefix
      const esLink = links.find((l: { hreflang: string }) => l.hreflang === 'es');
      expect(esLink?.href).toContain('/es/@mycalendar');
    });
  });

  // -----------------------------------------------------------------------
  // Locale-prefixed site routes: default language → redirect
  // -----------------------------------------------------------------------

  describe('locale-prefixed site routes — default language redirect', () => {
    it('should redirect /en/@calendar to /@calendar when en is the default language', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('en');
      const res = await request(app).get('/en/@mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/@mycalendar');
    });

    it('should redirect /es/@calendar to /@calendar when es is the default language', async () => {
      const mockSettings = {
        get: (_key: string) => 'es',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('es');
      const res = await request(app).get('/es/@mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/@mycalendar');
    });

    it('should preserve query string when redirecting', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('en');
      const res = await request(app).get('/en/@mycalendar?filter=music');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/@mycalendar?filter=music');
    });

    it('should redirect /en/@calendar/event/123 to /@calendar/event/123', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const app = buildTestApp('en');
      const res = await request(app).get('/en/@mycalendar/event/123');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/@mycalendar/event/123');
    });
  });

  // -----------------------------------------------------------------------
  // Non-locale path segments
  // -----------------------------------------------------------------------

  describe('non-locale path segments', () => {
    it('should serve site SPA for /xx/@calendar when xx looks like locale but is not valid', async () => {
      // /xx/@mycalendar matches the route regex (xx is 2 chars), but stripLocalePrefix
      // returns null for 'xx' since it is not in AVAILABLE_LANGUAGES. The handler
      // falls back to serving site.index.html.ejs, which is correct — the path
      // contains an @-prefixed segment that Vue Router will interpret as a calendar view.
      const app = buildTestApp('en');
      const res = await request(app).get('/xx/@mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve client.index.html.ejs for unknown paths without @ segment', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/unknown/path');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });
  });

  // -----------------------------------------------------------------------
  // Existing routes should continue to work
  // -----------------------------------------------------------------------

  describe('existing routes remain functional', () => {
    it('should serve client.index.html.ejs for /', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });

    it('should serve client.index.html.ejs for /login', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/login');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });

    it('should serve client.index.html.ejs for /settings', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/settings');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });
  });

  // -----------------------------------------------------------------------
  // resolveInstanceDefaultLanguage helper
  // -----------------------------------------------------------------------

  describe('resolveInstanceDefaultLanguage', () => {
    it('should return the instance default language from settings', async () => {
      const { resolveInstanceDefaultLanguage } = await import('@/server/app_routes');

      const mockSettings = {
        get: (_key: string) => 'es',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const result = await resolveInstanceDefaultLanguage();
      expect(result).toBe('es');
    });

    it('should fall back to DEFAULT_LANGUAGE_CODE when settings throws', async () => {
      const { resolveInstanceDefaultLanguage } = await import('@/server/app_routes');

      sandbox.stub(ServiceSettings, 'getInstance').rejects(new Error('DB error'));

      const result = await resolveInstanceDefaultLanguage();
      expect(result).toBe('en');
    });

    it('should fall back to DEFAULT_LANGUAGE_CODE when settings returns invalid code', async () => {
      const { resolveInstanceDefaultLanguage } = await import('@/server/app_routes');

      const mockSettings = {
        get: (_key: string) => 'zz',
      } as unknown as ServiceSettings;
      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const result = await resolveInstanceDefaultLanguage();
      expect(result).toBe('en');
    });
  });

  // -----------------------------------------------------------------------
  // handlers object exports
  // -----------------------------------------------------------------------

  describe('handlers object', () => {
    it('should export expected handler functions', () => {
      expect(typeof handlers.client_index).toBe('function');
      expect(typeof handlers.site_index).toBe('function');
      expect(typeof handlers.locale_prefixed_site).toBe('function');
      expect(typeof handlers.widget_index).toBe('function');
      expect(typeof handlers.assets).toBe('function');
      expect(typeof handlers.coverage).toBe('function');
      expect(typeof handlers.widget_javascript).toBe('function');
    });
  });
});
