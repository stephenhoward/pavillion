import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import config from 'config';
import { createRouter, getSiteBaseUrl, buildHreflangLinks, resolveInstanceDefaultLanguage, collectEntryCSS } from '@/server/app_routes';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Creates a minimal mock ConfigurationInterface with controllable default language.
 */
function buildMockConfigInterface(defaultLanguage = 'en'): ConfigurationInterface {
  const mock = {
    getDefaultLanguage: sinon.stub().resolves(defaultLanguage),
    getSetting: sinon.stub().resolves(undefined),
    setSetting: sinon.stub().resolves(true),
    getAllSettings: sinon.stub().resolves({}),
    getEnabledLanguages: sinon.stub().resolves(['en', 'es']),
    getForceLanguage: sinon.stub().resolves(null),
  } as unknown as ConfigurationInterface;
  return mock;
}

/**
 * Builds a minimal Express app that installs the locale middleware stub
 * (setting req.locale) and mounts the index router.
 *
 * The view engine is replaced with a spy so we can assert on render calls
 * without needing actual EJS templates on disk.
 */
function buildTestApp(locale = 'en', configInterface?: ConfigurationInterface): Express {
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

  const mockConfig = configInterface ?? buildMockConfigInterface(locale);
  const { router } = createRouter(mockConfig);
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
    it('should serve site.index.html.ejs for /view/calendar', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve site.index.html.ejs for /view/calendar/event/123', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view/mycalendar/event/123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should pass locale from req.locale to the template', async () => {
      const app = buildTestApp('es');
      const res = await request(app).get('/view/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.data.locale).toBe('es');
    });

    it('should pass non-empty hreflangLinks array to the template', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/view/mycalendar');

      expect(res.status).toBe(200);
      const links = res.body.data?.hreflangLinks;
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBeGreaterThan(0);
      // should include x-default
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'x-default')).toBe(true);
    });

    it('should include hreflang entries for all enabled languages', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/view/mycalendar');

      const links = res.body.data?.hreflangLinks;
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'en')).toBe(true);
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'es')).toBe(true);
    });

    it('should include canonical path in hreflang hrefs', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/view/mycalendar');

      const links = res.body.data?.hreflangLinks;
      const enLink = links.find((l: { hreflang: string }) => l.hreflang === 'en');
      expect(enLink?.href).toContain('/view/mycalendar');
      const esLink = links.find((l: { hreflang: string }) => l.hreflang === 'es');
      expect(esLink?.href).toContain('/es/view/mycalendar');
    });
  });

  // -----------------------------------------------------------------------
  // Locale-prefixed site routes: non-default language
  // -----------------------------------------------------------------------

  describe('locale-prefixed site routes — non-default language', () => {
    it('should serve site.index.html.ejs for /es/view/calendar when es is not the default', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should pass locale from req.locale to the template for prefixed routes', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.data.locale).toBe('es');
    });

    it('should serve site.index.html.ejs for /es/view/calendar/event/123', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar/event/123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should pass non-empty hreflangLinks array for locale-prefixed routes', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar');

      expect(res.status).toBe(200);
      const links = res.body.data?.hreflangLinks;
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBeGreaterThan(0);
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'x-default')).toBe(true);
    });

    it('should use stripped path (without locale prefix) in hreflang hrefs', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar');

      const links = res.body.data?.hreflangLinks;
      // x-default points to the unprefixed canonical URL
      const xDefault = links.find((l: { hreflang: string }) => l.hreflang === 'x-default');
      expect(xDefault?.href).toContain('/view/mycalendar');
      expect(xDefault?.href).not.toContain('/es/view/mycalendar');
      // es link should have /es/ prefix
      const esLink = links.find((l: { hreflang: string }) => l.hreflang === 'es');
      expect(esLink?.href).toContain('/es/view/mycalendar');
    });
  });

  // -----------------------------------------------------------------------
  // Locale-prefixed site routes: default language → redirect
  // -----------------------------------------------------------------------

  describe('locale-prefixed site routes — default language redirect', () => {
    it('should redirect /en/view/calendar to /view/calendar when en is the default language', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/view/mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/view/mycalendar');
    });

    it('should redirect /es/view/calendar to /view/calendar when es is the default language', async () => {
      const mockConfig = buildMockConfigInterface('es');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/view/mycalendar');
    });

    it('should preserve query string when redirecting', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/view/mycalendar?filter=music');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/view/mycalendar?filter=music');
    });

    it('should redirect /en/view/calendar/event/123 to /view/calendar/event/123', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/view/mycalendar/event/123');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/view/mycalendar/event/123');
    });
  });

  // -----------------------------------------------------------------------
  // Account-application confirmation routes: /auth/apply/confirm/:token
  //
  // (pv-e92c, supersedes pv-l9wv) The confirm landing page lives in the
  // client SPA's logged-out auth flow alongside login, register-apply, and
  // password_forgot. The page is served by the client SPA catch-all; the
  // anti-enumeration / cookie-hygiene posture is enforced at the API layer
  // (the GET/POST endpoints return identical generic responses for any
  // failure mode and run with no session middleware), independent of which
  // SPA shell renders the user-facing page.
  // -----------------------------------------------------------------------

  describe('apply confirmation routes', () => {
    it('should serve client.index.html.ejs for /auth/apply/confirm/<token>', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/auth/apply/confirm/abc123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });

    it('should NOT route /apply/confirm/<token> through the site SPA shell', async () => {
      // After pv-e92c, the legacy /apply/ namespace is no longer reserved for
      // the site SPA. Requests fall through to the client SPA catch-all.
      const app = buildTestApp('en');
      const res = await request(app).get('/apply/confirm/abc123');

      expect(res.body.template).not.toBe('site.index.html.ejs');
      expect(res.body.template).toBe('client.index.html.ejs');
    });

    it('should serve client.index.html.ejs for /es/auth/apply/confirm/<token>', async () => {
      // The locale-prefixed variant of the canonical confirm URL must also
      // render through the client SPA shell, not the site SPA. The /auth/
      // path does not match the site-app reserved /view/ regex, so it falls
      // through to the client SPA catch-all the same way /es/auth/login does.
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/auth/apply/confirm/abc123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });
  });

  // -----------------------------------------------------------------------
  // Non-locale path segments
  // -----------------------------------------------------------------------

  describe('non-locale path segments', () => {
    it('should serve site SPA for /xx/view/calendar when xx looks like locale but is not valid', async () => {
      // /xx/view/mycalendar matches the locale-prefixed route regex (xx is 2 chars),
      // but stripLocalePrefix returns null for 'xx' since it is not in AVAILABLE_LANGUAGES.
      // The handler falls back to serving site.index.html.ejs, which is correct — the
      // /view/ segment signals this is a public calendar path.
      const app = buildTestApp('en');
      const res = await request(app).get('/xx/view/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve client.index.html.ejs for unknown paths without /view/ segment', async () => {
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
      const mockConfig = buildMockConfigInterface('es');

      const result = await resolveInstanceDefaultLanguage(mockConfig);
      expect(result).toBe('es');
    });

    it('should fall back to DEFAULT_LANGUAGE_CODE when getDefaultLanguage throws', async () => {
      const mockConfig = {
        getDefaultLanguage: sinon.stub().rejects(new Error('DB error')),
      } as unknown as ConfigurationInterface;

      const result = await resolveInstanceDefaultLanguage(mockConfig);
      expect(result).toBe('en');
    });

    it('should fall back to DEFAULT_LANGUAGE_CODE when settings returns invalid code', async () => {
      const mockConfig = {
        getDefaultLanguage: sinon.stub().resolves('zz'),
      } as unknown as ConfigurationInterface;

      const result = await resolveInstanceDefaultLanguage(mockConfig);
      expect(result).toBe('en');
    });
  });

  // -----------------------------------------------------------------------
  // getSiteBaseUrl — host-header injection protection
  // -----------------------------------------------------------------------

  describe('getSiteBaseUrl', () => {
    it('should use the configured domain, not the Host header', () => {
      const configuredDomain = config.get<string>('domain');

      // Build a fake request with a spoofed Host header
      const fakeReq = {
        protocol: 'https',
        get: (header: string) => {
          if (header === 'host') return 'evil.com';
          return undefined;
        },
      } as unknown as Request;

      const result = getSiteBaseUrl(fakeReq);

      // The result must contain the configured domain, not the spoofed host
      expect(result).toContain(configuredDomain);
      expect(result).not.toContain('evil.com');
    });

    it('should not allow a spoofed Host header to appear in hreflang hrefs', () => {
      const fakeReq = {
        protocol: 'https',
        get: (header: string) => {
          if (header === 'host') return 'evil.com';
          return undefined;
        },
      } as unknown as Request;

      const links = buildHreflangLinks(fakeReq, '/view/mycalendar', 'en');

      for (const link of links) {
        expect(link.href).not.toContain('evil.com');
      }
    });
  });

  // -----------------------------------------------------------------------
  // collectEntryCSS — Vite manifest CSS resolution
  // -----------------------------------------------------------------------

  describe('collectEntryCSS', () => {
    it('should collect CSS listed directly on the entry', () => {
      const manifest = {
        'src/app.ts': {
          file: 'assets/app.js',
          css: ['assets/app.css'],
        },
      };

      expect(collectEntryCSS(manifest, 'src/app.ts')).toEqual(['assets/app.css']);
    });

    it('should collect CSS from imported chunks', () => {
      const manifest = {
        'src/app.ts': {
          file: 'assets/app.js',
          css: ['assets/app.css'],
          imports: ['_shared-abc.js'],
        },
        '_shared-abc.js': {
          file: 'assets/shared-abc.js',
          css: ['assets/shared.css'],
        },
      };

      const result = collectEntryCSS(manifest, 'src/app.ts');
      expect(result).toContain('assets/app.css');
      expect(result).toContain('assets/shared.css');
      expect(result).toHaveLength(2);
    });

    it('should collect CSS from transitively imported chunks', () => {
      const manifest = {
        'src/app.ts': {
          file: 'assets/app.js',
          imports: ['_chunk-a.js'],
        },
        '_chunk-a.js': {
          file: 'assets/chunk-a.js',
          imports: ['_chunk-b.js'],
        },
        '_chunk-b.js': {
          file: 'assets/chunk-b.js',
          css: ['assets/deep.css'],
        },
      };

      expect(collectEntryCSS(manifest, 'src/app.ts')).toEqual(['assets/deep.css']);
    });

    it('should deduplicate CSS referenced by multiple chunks', () => {
      const manifest = {
        'src/app.ts': {
          file: 'assets/app.js',
          imports: ['_chunk-a.js', '_chunk-b.js'],
        },
        '_chunk-a.js': {
          file: 'assets/chunk-a.js',
          css: ['assets/shared.css'],
        },
        '_chunk-b.js': {
          file: 'assets/chunk-b.js',
          css: ['assets/shared.css'],
        },
      };

      expect(collectEntryCSS(manifest, 'src/app.ts')).toEqual(['assets/shared.css']);
    });

    it('should handle circular imports without infinite recursion', () => {
      const manifest = {
        'src/app.ts': {
          file: 'assets/app.js',
          css: ['assets/app.css'],
          imports: ['_chunk-a.js'],
        },
        '_chunk-a.js': {
          file: 'assets/chunk-a.js',
          css: ['assets/chunk-a.css'],
          imports: ['src/app.ts'],
        },
      };

      const result = collectEntryCSS(manifest, 'src/app.ts');
      expect(result).toContain('assets/app.css');
      expect(result).toContain('assets/chunk-a.css');
      expect(result).toHaveLength(2);
    });

    it('should return empty array for a missing entry key', () => {
      expect(collectEntryCSS({}, 'src/nonexistent.ts')).toEqual([]);
    });

    it('should handle chunks with no css property', () => {
      const manifest = {
        'src/app.ts': {
          file: 'assets/app.js',
          imports: ['_util.js'],
        },
        '_util.js': {
          file: 'assets/util.js',
        },
      };

      expect(collectEntryCSS(manifest, 'src/app.ts')).toEqual([]);
    });

    it('should handle chunks that reference missing import keys', () => {
      const manifest = {
        'src/app.ts': {
          file: 'assets/app.js',
          css: ['assets/app.css'],
          imports: ['_missing.js'],
        },
      };

      expect(collectEntryCSS(manifest, 'src/app.ts')).toEqual(['assets/app.css']);
    });
  });

  // -----------------------------------------------------------------------
  // handlers object exports
  // -----------------------------------------------------------------------

  describe('handlers object', () => {
    it('should export expected handler functions', () => {
      const mockConfig = buildMockConfigInterface('en');
      const { handlers } = createRouter(mockConfig);

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
