import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express, Request, Response } from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import sinon from 'sinon';
import config from 'config';
import {
  createRouter,
  getSiteBaseUrl,
  buildHreflangLinks,
  resolveInstanceDefaultLanguage,
  collectEntryCSS,
  SERVER_OWNED_SEGMENTS,
} from '@/server/app_routes';
import { RESERVED_ROUTE_SEGMENTS } from '@/common/routing/reserved-segments';
import ConfigurationInterface from '@/server/configuration/interface';

const RESERVED_MODULE = '@/common/routing/reserved-segments';

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
 *
 * No domain routers are mounted, so a request the page router deliberately
 * lets fall through (an /api/… or federation path) answers 404 — which is what
 * the fall-through assertions below rely on.
 *
 * @param locale - Value the locale middleware stub puts on req.locale
 * @param configInterface - Optional ConfigurationInterface stub
 * @param routerFactory - Optional createRouter replacement (used by the test
 *   that re-imports the router with a mocked reserved-segment module)
 */
function buildTestApp(
  locale = 'en',
  configInterface?: ConfigurationInterface,
  routerFactory: typeof createRouter = createRouter,
): Express {
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
  const { router } = routerFactory(mockConfig);
  app.use('/', router);

  return app;
}

/**
 * Issues a GET over a real socket with the request target written verbatim.
 *
 * supertest routes the path through superagent's URL handling, which normalizes
 * a literal backslash away — the exact normalization a hostile client declines
 * to perform. Anything asserting on raw-path handling has to bypass it.
 *
 * @param app - Express app to drive
 * @param rawPath - Request target, sent exactly as written
 * @returns Status code and Location header of the response
 */
async function rawGet(app: Express, rawPath: string): Promise<{ status: number; location?: string }> {
  const server = app.listen(0);

  try {
    const { port } = server.address() as AddressInfo;

    return await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: rawPath }, (res) => {
        res.resume();
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          location: res.headers.location,
        }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  finally {
    server.close();
  }
}

/**
 * Resolves a Location header the way a WHATWG-conformant client would.
 *
 * A string assertion is what let the backslash form through while the
 * double-slash form was covered, so redirect safety is asserted on the origin
 * the header actually resolves to.
 *
 * @param location - Location header value
 * @returns The absolute URL a client would navigate to
 */
function resolveLocation(location: string | undefined): URL {
  return new URL(location ?? '', 'https://pavillion.test');
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
  // Root calendar pages (unprefixed — default language, as-needed strategy)
  //
  // (pv-l04s.2) Public calendar URLs live at the domain root: the site SPA
  // owns any first segment that is not reserved, and the client SPA keeps /
  // plus the reserved segments.
  // -----------------------------------------------------------------------

  describe('unprefixed root calendar routes', () => {
    it('should serve site.index.html.ejs for /:calendarName', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve site.index.html.ejs for a calendar event page', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/mycalendar/events/123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve site.index.html.ejs for a calendar series page', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/mycalendar/series/weekly-meetup');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    // Locale detection runs through stripLocalePrefix, which validates the code
    // against AVAILABLE_LANGUAGES. A bare [a-z]{2,8} shape test would read a
    // two-letter calendar name as a locale prefix and lose the calendar page.
    it('should serve a two-letter non-locale name as a calendar, not a locale prefix', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/ab');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve a two-letter non-locale name with a subpath as a calendar', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/ab/events/123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    // The exclusion alternation escapes each entry before joining. Unescaped,
    // the '.' in '.well-known' matches any character, so '/awell-known' would
    // be excluded from the site SPA and an ordinary calendar of that name would
    // be unreachable. A probe of '/.well-known' cannot catch this: a literal
    // dot matches either way.
    it('should serve a calendar whose name only looks like a reserved segment', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/awell-known');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    // The decode seam sits after route matching, as it does in Express itself:
    // the exclusion alternation is applied to the raw pathname, so a
    // percent-encoded reserved name misses it and is routed as a calendar name.
    // That is the deliberate disposition — the lookup behind the site shell
    // decodes first and no calendar can hold a reserved name, so it resolves to
    // nothing rather than reaching the client shell's privileged routes.
    it('should route a percent-encoded reserved name as a calendar, not a client route', async () => {
      const app = buildTestApp('en');
      const res = await rawGet(app, '/%61dmin');

      expect(res.status).toBe(200);
    });

    it('should serve the site shell for a percent-encoded reserved name', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/%61dmin');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
      // Nothing decoded it into the reserved segment on the way in.
      expect(res.body.data.hreflangLinks.some((l: { href: string }) => l.href.includes('/admin')))
        .toBe(false);
    });

    it('should pass locale from req.locale to the template', async () => {
      const app = buildTestApp('es');
      const res = await request(app).get('/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.data.locale).toBe('es');
    });

    it('should pass non-empty hreflangLinks array to the template', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/mycalendar');

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
      const res = await request(app).get('/mycalendar');

      const links = res.body.data?.hreflangLinks;
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'en')).toBe(true);
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'es')).toBe(true);
    });

    it('should include the root canonical path in hreflang hrefs', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/mycalendar');

      const links = res.body.data?.hreflangLinks;
      const enLink = links.find((l: { hreflang: string }) => l.hreflang === 'en');
      expect(enLink?.href).toMatch(/\/mycalendar$/);
      const esLink = links.find((l: { hreflang: string }) => l.hreflang === 'es');
      expect(esLink?.href).toMatch(/\/es\/mycalendar$/);
    });
  });

  // -----------------------------------------------------------------------
  // Discovery page — moved from /view to /discover
  // -----------------------------------------------------------------------

  describe('discovery routes', () => {
    it('should serve site.index.html.ejs for /discover', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/discover');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve site.index.html.ejs for /discover/ (trailing slash)', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/discover/');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    // `discover` is a member of RESERVED_ROUTE_SEGMENTS, so an exclusion
    // alternation built straight from the module would send this to the client
    // shell. The explicit route is registered ahead of the derived one.
    it('should serve site.index.html.ejs for /:locale/discover when the locale is not the default', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/discover');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
      expect(res.body.data.locale).toBe('es');
    });

    it('should redirect /:locale/discover to /discover when the locale is the instance default', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/discover');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/discover');
    });
  });

  // -----------------------------------------------------------------------
  // Locale-prefixed root calendar routes: non-default language
  // -----------------------------------------------------------------------

  describe('locale-prefixed root calendar routes — non-default language', () => {
    it('should serve site.index.html.ejs for /es/:calendarName when es is not the default', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should serve site.index.html.ejs for /es/:calendarName/events/:eventId', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/mycalendar/events/123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('site.index.html.ejs');
    });

    it('should pass locale from req.locale to the template for prefixed routes', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.data.locale).toBe('es');
    });

    it('should pass non-empty hreflangLinks array for locale-prefixed routes', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/mycalendar');

      expect(res.status).toBe(200);
      const links = res.body.data?.hreflangLinks;
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBeGreaterThan(0);
      expect(links.some((l: { hreflang: string }) => l.hreflang === 'x-default')).toBe(true);
    });

    it('should use the stripped path (without locale prefix) in hreflang hrefs', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/mycalendar');

      const links = res.body.data?.hreflangLinks;
      // x-default points to the unprefixed canonical URL
      const xDefault = links.find((l: { hreflang: string }) => l.hreflang === 'x-default');
      expect(xDefault?.href).toMatch(/\/mycalendar$/);
      expect(xDefault?.href).not.toContain('/es/mycalendar');
      // es link should have /es/ prefix
      const esLink = links.find((l: { hreflang: string }) => l.hreflang === 'es');
      expect(esLink?.href).toMatch(/\/es\/mycalendar$/);
    });
  });

  // -----------------------------------------------------------------------
  // Locale-prefixed routes: default language → redirect
  // -----------------------------------------------------------------------

  describe('locale-prefixed routes — default language redirect', () => {
    it('should redirect /en/:calendarName to /:calendarName when en is the default language', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar');
    });

    it('should redirect /es/:calendarName to /:calendarName when es is the default language', async () => {
      const mockConfig = buildMockConfigInterface('es');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar');
    });

    it('should preserve the query string when redirecting', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/mycalendar?filter=music');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar?filter=music');
    });

    it('should redirect /en/:calendarName/events/:eventId to the unprefixed path', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/mycalendar/events/123');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar/events/123');
    });

    // Express does not collapse repeated slashes. A doubled slash after the
    // locale matches no page route (the calendar segment pattern rejects it),
    // so it falls to the client shell — and must never be answered with a
    // protocol-relative Location the browser resolves against another host.
    // Unlike the doubled slash, a backslash after the locale is an ordinary
    // path segment to Express's matcher, so this route does redirect — and the
    // target must still resolve to this origin.
    it('should keep a backslash-prefixed locale redirect on this origin', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await rawGet(app, '/en/\\evil.com');

      expect(res.status).toBe(301);
      expect(resolveLocation(res.location).origin).toBe('https://pavillion.test');
      expect(res.location).toBe('/evil.com');
    });

    it('should never answer a doubled-slash locale path with an off-origin redirect', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en//evil.com');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
      expect(res.headers.location).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Bare locale root: /es has no page of its own
  // -----------------------------------------------------------------------

  describe('bare locale root', () => {
    it('should redirect /:locale to that locale discovery page', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/es/discover');
    });

    it('should redirect /:locale/ (trailing slash) to that locale discovery page', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/es/discover');
    });

    it('should redirect the default locale root straight to the unprefixed discovery page', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/discover');
    });
  });

  // -----------------------------------------------------------------------
  // Legacy /view URLs — permanent redirects onto the root URL shape
  //
  // `view` stays in RESERVED_ROUTE_SEGMENTS permanently so these redirects
  // stay unambiguous; the routes are registered ahead of the derived site
  // routes, which would otherwise never see the segment.
  // -----------------------------------------------------------------------

  describe('legacy /view redirects', () => {
    it('should redirect bare /view to /discover', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/discover');
    });

    it('should redirect /view/ (trailing slash, no calendar) to /discover', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view/');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/discover');
    });

    it('should redirect /view/:calendarName to /:calendarName', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view/mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar');
    });

    it('should redirect a deep /view path to its root equivalent', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view/mycalendar/events/123');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar/events/123');
    });

    it('should preserve the query string on a /view redirect', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view/mycalendar?filter=music&page=2');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar?filter=music&page=2');
    });

    // The query string is copied verbatim rather than rebuilt through
    // URLSearchParams, which is lossy: Express parses a repeated key into an
    // array, and casting that to Record<string, string> collapses it to
    // "tag=a,b". A rebuild would pass every single-valued test above.
    it('should preserve a repeated query parameter verbatim', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view/mycalendar?tag=a&tag=b');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar?tag=a&tag=b');
    });

    it('should redirect /:locale/view to that locale discovery page', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/es/discover');
    });

    it('should redirect /:locale/view/:calendarName to /:locale/:calendarName', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/es/mycalendar');
    });

    it('should preserve the query string on a locale-prefixed /view redirect', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar?filter=music');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/es/mycalendar?filter=music');
    });

    // A doubly-old URL needs both the /view removal and the default-locale
    // prefix removal. One hop, final destination.
    it('should land a default-locale /view URL on its final destination in one hop', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/view/mycalendar/events/123');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar/events/123');
    });

    it('should land a default-locale bare /view URL on /discover in one hop', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await request(app).get('/en/view');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/discover');
    });

    it('should drop the prefix when the URL locale is the configured default', async () => {
      const mockConfig = buildMockConfigInterface('es');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/view/mycalendar');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/mycalendar');
    });

    // The redirect target is built from req.path only. Express does not collapse
    // repeated slashes, so `/view//evil.com` would otherwise yield `//evil.com`
    // — a protocol-relative URL the browser resolves against the attacker host.
    it('should never build a protocol-relative Location from a /view path', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view//evil.com');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/evil.com');
      expect(res.headers.location.startsWith('//')).toBe(false);
    });

    // Per the WHATWG URL parser a backslash behaves like a slash in
    // relative-slash state, so a Location of '/\evil.com' resolves to the
    // authority evil.com. encodeurl passes 0x5C through untouched, and a
    // percent-decoding reverse proxy can turn the ordinary-looking
    // '/view/%5Cevil.com' into the literal form before Express sees it.
    it.each([
      ['/view/\\evil.com', '/evil.com'],
      ['/view//evil.com', '/evil.com'],
      ['/view/\\\\evil.com', '/evil.com'],
      ['/view//\\evil.com', '/evil.com'],
    ])('should keep the redirect for %s on this origin', async (rawPath, expected) => {
      const app = buildTestApp('en');
      const res = await rawGet(app, rawPath);

      expect(res.status).toBe(301);
      expect(resolveLocation(res.location).origin).toBe('https://pavillion.test');
      expect(res.location).toBe(expected);
    });

    it('should keep a locale-prefixed backslash redirect on this origin', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('en', mockConfig);
      const res = await rawGet(app, '/en/view/\\evil.com');

      expect(res.status).toBe(301);
      expect(resolveLocation(res.location).origin).toBe('https://pavillion.test');
      expect(res.location).toBe('/evil.com');
    });

    it('should keep a percent-encoded backslash redirect on this origin', async () => {
      const app = buildTestApp('en');
      const res = await rawGet(app, '/view/%5Cevil.com');

      expect(res.status).toBe(301);
      expect(resolveLocation(res.location).origin).toBe('https://pavillion.test');
    });

    // A fragment is not sent by a browser, but req.originalUrl carries one when
    // a crafted client sends it while req.path does not — so a '?' inside the
    // fragment must not be promoted into the redirect's query string.
    it('should not promote fragment text into the redirect query string', async () => {
      const app = buildTestApp('en');
      const res = await rawGet(app, '/view/mycalendar#x?y=1');

      expect(res.status).toBe(301);
      expect(res.location).toBe('/mycalendar');
    });

    it('should drop the fragment and keep the query string', async () => {
      const app = buildTestApp('en');
      const res = await rawGet(app, '/view/mycalendar?a=1#b');

      expect(res.status).toBe(301);
      expect(res.location).toBe('/mycalendar?a=1');
    });

    it('should ignore a redirect target supplied in the query string', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/view/mycalendar?next=https://evil.com');

      expect(res.status).toBe(301);
      expect(res.headers.location.startsWith('/mycalendar?')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Client SPA: / and the reserved segments
  // -----------------------------------------------------------------------

  describe('client SPA routes', () => {
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

    it('should serve client.index.html.ejs for /auth/apply/confirm/<token>', async () => {
      // (pv-e92c, supersedes pv-l9wv) The confirm landing page lives in the
      // client SPA's logged-out auth flow alongside login, register-apply, and
      // password_forgot.
      const app = buildTestApp('en');
      const res = await request(app).get('/auth/apply/confirm/abc123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });

    it('should serve client.index.html.ejs for a locale-prefixed client route', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/auth/apply/confirm/abc123');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });

    it('should never serve the site shell for a reserved segment', async () => {
      const app = buildTestApp('en');
      // `discover` is a site page and `view` redirects; every other reserved
      // segment belongs to the client shell or to a router mounted later.
      const segments = RESERVED_ROUTE_SEGMENTS.filter(s => s !== 'discover' && s !== 'view');

      for (const segment of segments) {
        const res = await request(app).get(`/${segment}`);
        expect(res.body.template, `/${segment} must not reach the site SPA`)
          .not.toBe('site.index.html.ejs');
      }
    });

    it('should serve the client shell for the client-owned reserved segments', async () => {
      const app = buildTestApp('en');
      const segments = RESERVED_ROUTE_SEGMENTS.filter(
        s => s !== 'discover' && s !== 'view' && !SERVER_OWNED_SEGMENTS.includes(s),
      );

      for (const segment of segments) {
        const res = await request(app).get(`/${segment}`);
        expect(res.body.template, `/${segment} should render the client shell`)
          .toBe('client.index.html.ejs');
      }
    });

    it('should serve the client shell for a locale-prefixed reserved segment', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/admin');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('client.index.html.ejs');
    });

    // A locale prefix followed by another locale code falls through three
    // routes: the locale-prefixed calendar route excludes `fr` (the composed
    // pattern reserves the locale codes), and the unprefixed one excludes `es`
    // for the same reason. The client shell is the decided destination — the
    // requirement it satisfies is that `fr` is never served as a calendar.
    it('should not serve a locale code under a locale prefix as a calendar', async () => {
      const mockConfig = buildMockConfigInterface('en');
      const app = buildTestApp('es', mockConfig);
      const res = await request(app).get('/es/fr');

      expect(res.status).toBe(200);
      expect(res.body.template).not.toBe('site.index.html.ejs');
      expect(res.body.template).toBe('client.index.html.ejs');
    });
  });

  // -----------------------------------------------------------------------
  // Segments the page router must leave to the routers mounted after it
  // -----------------------------------------------------------------------

  describe('server-owned segments', () => {
    it('should let server-owned segments fall through to later routers', async () => {
      const app = buildTestApp('en');
      // `widget` is the exception: it is excluded from the client catch-all
      // because the widget routes earlier in this same router answer it.
      const fallThrough = SERVER_OWNED_SEGMENTS.filter(s => s !== 'widget');

      for (const segment of fallThrough) {
        const res = await request(app).get(`/${segment}/probe`);
        expect(res.status, `/${segment}/probe must not be answered by the page router`).toBe(404);
      }
    });

    it('should keep serving the widget shell under /widget', async () => {
      const app = buildTestApp('en');
      const res = await request(app).get('/widget/mycalendar');

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('widget.index.html.ejs');
    });

    it('should keep every server-owned segment reserved in the shared module', () => {
      for (const segment of SERVER_OWNED_SEGMENTS) {
        expect(RESERVED_ROUTE_SEGMENTS, `${segment} must stay unclaimable by a calendar`)
          .toContain(segment);
      }
    });

    // The two assertions above both iterate SERVER_OWNED_SEGMENTS, so dropping
    // an entry makes them pass vacuously — and dropping 'calendars' or 'users'
    // is exactly the regression that answers a federation request with an HTML
    // shell. These probes name the paths directly and never read the array.
    it.each([
      '/api/probe',
      '/assets/probe',
      '/calendars/probe',
      '/users/probe',
      '/.well-known/probe',
    ])('should leave %s to the routers mounted after the page router', async (path) => {
      const app = buildTestApp('en');
      const res = await request(app).get(path);

      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // The site exclusion is derived from the shared reserved-segment module
  // -----------------------------------------------------------------------

  describe('reserved-segment derivation', () => {
    afterEach(() => {
      vi.doUnmock(RESERVED_MODULE);
      vi.resetModules();
    });

    it('should exclude a segment added to the module without editing app_routes.ts', async () => {
      // Control: the segment is an ordinary calendar name today.
      const before = await request(buildTestApp('en')).get('/brand-new-segment');
      expect(before.body.template).toBe('site.index.html.ejs');

      const actual = await vi.importActual<typeof import('@/common/routing/reserved-segments')>(
        RESERVED_MODULE,
      );
      vi.doMock(RESERVED_MODULE, () => ({
        ...actual,
        RESERVED_ROUTE_SEGMENTS: Object.freeze([
          ...actual.RESERVED_ROUTE_SEGMENTS,
          'brand-new-segment',
        ]),
      }));
      vi.resetModules();

      const { createRouter: freshCreateRouter } = await import('@/server/app_routes');
      const app = buildTestApp('en', undefined, freshCreateRouter);
      const res = await request(app).get('/brand-new-segment');

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

      const links = buildHreflangLinks(fakeReq, '/mycalendar', 'en');

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
      expect(typeof handlers.locale_root_redirect).toBe('function');
      expect(typeof handlers.legacy_view_redirect).toBe('function');
      expect(typeof handlers.widget_index).toBe('function');
      expect(typeof handlers.assets).toBe('function');
      expect(typeof handlers.coverage).toBe('function');
      expect(typeof handlers.widget_javascript).toBe('function');
    });
  });
});
