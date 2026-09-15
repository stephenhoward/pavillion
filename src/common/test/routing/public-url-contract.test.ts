/**
 * The public-URL contract: the join between the paths the SERVER hands to the
 * site shell and the paths the site SPA's vue-router can actually match.
 *
 * Each side already has its own suite — src/server/common/test/app_routes.test.ts
 * pins what the server serves, src/site/test/router-locale-guard.test.ts pins
 * what the site router matches — and both stay green when the two disagree. A
 * path the server hands to the site shell that the site router cannot match
 * renders the header and footer with no content in between. That shipped once
 * (8f47ac27 emitted a '/view/…' target into a <RouterLink>) and a human found
 * it by reading code.
 *
 * Both tables are imported from the modules that ship them, never mirrored:
 * `createRouter` from @/server/app_routes and `buildSiteRoutes` from
 * @/site/routes. Reading the server's dispositions off the real Express router
 * needs no HTTP — walking `router.stack` and identifying the first matching
 * layer's handler by reference equality against the `handlers` object is the
 * same first-match-wins ordering the server uses at runtime.
 *
 * Per DEC-018 this file reads routing DISPOSITIONS only. It must never grow an
 * assertion that a resolver (`getCalendarByName` and friends) consults the
 * reserved list — the reservation governs claiming a name, not resolving one.
 *
 * The join is deliberately NOT a set equality; see the final describe block for
 * the two places the tables disagree on purpose.
 */
import { describe, it, expect } from 'vitest';
import { Request, Response } from 'express';
import { createRouter as createSiteRouter, createMemoryHistory, RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { createRouter as createServerPageRouter } from '@/server/app_routes';
import { buildSiteRoutes } from '@/site/routes';
import { RESERVED_ROUTE_SEGMENTS } from '@/common/routing/reserved-segments';
import {
  AVAILABLE_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  getDefaultEnabledLanguageCodes,
} from '@/common/i18n/languages';
import ConfigurationInterface from '@/server/configuration/interface';

// ---------------------------------------------------------------------------
// The server side: dispositions read off the real page router
// ---------------------------------------------------------------------------

/**
 * The internals of an Express 4 router layer. @types/express exposes neither
 * `Router.stack` nor `Layer`, so the shape is declared here rather than cast to
 * `any` at each use.
 */
interface ExpressRouterLayer {
  /** Note: mutates `layer.params` as a side effect. Harmless for a probe. */
  match(path: string): boolean;
  route?: { stack: { handle: unknown }[] };
}

/** The handler names that mean "the site SPA shell is rendered for this path". */
const SITE_SHELL_HANDLERS: ReadonlySet<string> = new Set(['site_index', 'locale_prefixed_site']);

/** What the probe reports for a path no layer in the page router claims. */
const FALLS_THROUGH = 'falls_through';

/**
 * Builds the real page router and a probe that names the handler each path
 * reaches.
 *
 * Only `getDefaultLanguage` is stubbed: nothing this file drives reads another
 * setting. src/server/common/test/app_routes.test.ts:24-34 has the fuller sinon
 * shape if that ever changes.
 *
 * @returns The router's `handlers` object and a path → handler-name probe
 */
function buildServerProbe() {
  const configInterface = {
    getDefaultLanguage: sinon.stub().resolves(DEFAULT_LANGUAGE_CODE),
  } as unknown as ConfigurationInterface;

  const { router, handlers } = createServerPageRouter(configInterface);
  const stack = (router as unknown as { stack: ExpressRouterLayer[] }).stack;
  const handlerNames = new Map<unknown, string>(
    Object.entries(handlers).map(([name, handler]) => [handler as unknown, name]),
  );

  /**
   * Names the handler a path reaches, by first-match-wins over the real stack.
   *
   * Layers without a `.route` are middleware (the widget CSP header), which
   * decide no disposition and are skipped.
   *
   * @param path - A request pathname
   * @returns The handler's key in `handlers`, or FALLS_THROUGH when the page
   *   router deliberately leaves the path to a domain router mounted after it
   */
  const disposition = (path: string): string => {
    for (const layer of stack) {
      if (!layer.route) continue;
      if (layer.match(path)) {
        return handlerNames.get(layer.route.stack[0].handle) ?? 'unrecognized_handler';
      }
    }
    return FALLS_THROUGH;
  };

  return { handlers, disposition };
}

const { handlers, disposition } = buildServerProbe();

// ---------------------------------------------------------------------------
// The site side: the real route table, bound to stubs
// ---------------------------------------------------------------------------

const StubComponent = { template: '<div />' };

const siteRoutes: RouteRecordRaw[] = buildSiteRoutes({
  discovery: StubComponent,
  calendar: StubComponent,
  event: StubComponent,
  instance: StubComponent,
  series: StubComponent,
});

// No catch-all: app.ts ships none, so `matched: []` here is what the browser
// really does with an unroutable path.
const siteRouter = createSiteRouter({ history: createMemoryHistory(), routes: siteRoutes });

// ---------------------------------------------------------------------------
// Instantiating the site route shapes into concrete paths
// ---------------------------------------------------------------------------

/** One sample value per route param name in the shipped site table. */
const SAMPLE_PARAMS: Readonly<Record<string, string>> = Object.freeze({
  calendar: 'mycalendar',
  event: 'event-123',
  startTime: '20260508-1400',
  series: 'weekly-standup',
});

/** ':name' with its optional '(regex)' constraint, as vue-router spells them. */
const PARAM_TOKEN = /:(\w+)(\([^)]*\))?/g;

const NON_DEFAULT_LOCALES = AVAILABLE_LANGUAGES
  .map(language => language.code)
  .filter(code => code !== DEFAULT_LANGUAGE_CODE);

/**
 * Turns one vue-router path template into a concrete path.
 *
 * Throws rather than skips on a param it has no sample for: a shape this filler
 * cannot instantiate is a shape the join does not cover, and silence there is
 * indistinguishable from success — the same reasoning
 * src/common/test/routing/reserved-segments.test.ts gives for its `unparseable`
 * list.
 *
 * @param template - A path from the shipped site route table
 * @param locale - Value for a ':locale' param, if the template carries one
 * @returns The template with every param replaced by its sample value
 */
function instantiate(template: string, locale: string): string {
  return template.replace(PARAM_TOKEN, (_token, name: string) => {
    if (name === 'locale') {
      return locale;
    }

    const sample = SAMPLE_PARAMS[name];
    if (sample === undefined) {
      throw new Error(
        `No sample value for route param ':${name}' in '${template}'. The public-URL join `
        + 'does not cover a shape it cannot instantiate — add a sample to SAMPLE_PARAMS.',
      );
    }
    return sample;
  });
}

interface CorpusEntry {
  /** The concrete path. */
  path: string;
  /** The locale prefix it carries, or null for the default-locale shape. */
  locale: string | null;
  /** The route template it came from. */
  template: string;
}

/**
 * Instantiates every shape in the shipped site table, once per non-default
 * locale for the prefixed shapes.
 *
 * Only non-default locales are used: `locale_prefixed_site` 301s a
 * default-locale prefix to the canonical path instead of serving the shell, and
 * that redirect has its own coverage in
 * src/server/common/test/app_routes.test.ts. Keeping the corpus to non-default
 * locales leaves each disposition unambiguous.
 *
 * @param routes - The shipped site route records
 * @returns One entry per (shape, locale) pair
 */
function buildCorpus(routes: RouteRecordRaw[]): CorpusEntry[] {
  return routes.flatMap((route): CorpusEntry[] => {
    const template = route.path;

    if (!template.includes(':locale')) {
      return [{ path: instantiate(template, ''), locale: null, template }];
    }
    return NON_DEFAULT_LOCALES.map(locale => ({ path: instantiate(template, locale), locale, template }));
  });
}

const corpus = buildCorpus(siteRoutes);

/**
 * The '/view'-prefixed ancestor of a corpus path, which the server must 301.
 *
 * The prefix goes after the locale segment, matching the two legacy routes in
 * src/server/app_routes.ts ('/view/…' and '/:locale/view/…').
 *
 * @param entry - A corpus entry
 * @returns The same path with '/view' inserted ahead of the calendar segment
 */
function viewTwin(entry: CorpusEntry): string {
  if (entry.locale === null) {
    return `/view${entry.path}`;
  }
  return `/${entry.locale}/view${entry.path.slice(entry.locale.length + 1)}`;
}

/**
 * Drives the real legacy-redirect handler and captures the Location it sets.
 *
 * Driving the handler rather than re-deriving the rule is the point: a test
 * that rebuilt the target would pass while the shipped redirect pointed
 * somewhere the site router cannot render.
 *
 * @param path - A '/view'-prefixed request path
 * @returns The 301 target the handler emits
 */
async function legacyRedirectTarget(path: string): Promise<string> {
  let target = '';
  const req = { path, originalUrl: path, protocol: 'https' } as unknown as Request;
  const res = {
    redirect: (_status: number, location: string) => { target = location; },
  } as unknown as Response;

  await handlers.legacy_view_redirect(req, res);

  return target;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('public URL contract (server route table ↔ site SPA route table)', () => {
  describe('the corpus this join is built from', () => {
    it('instantiates every shape in the shipped site route table', () => {
      expect(new Set(corpus.map(entry => entry.template)).size).toBe(siteRoutes.length);
      expect(corpus.length).toBeGreaterThan(siteRoutes.length - 1);
    });

    it('throws rather than skipping a route param it has no sample for', () => {
      expect(() => instantiate('/:calendar/tickets/:ticket', 'es')).toThrow(
        /No sample value for route param ':ticket'/,
      );
    });
  });

  // Direction 1: no orphan site route. Every shape the SPA can match must be a
  // shape the server actually hands to the site shell — otherwise the route is
  // unreachable by URL and only ever arrives via in-SPA navigation.
  describe('every site route shape is served to the site shell', () => {
    it('reaches the site shell handler for each shape, at every non-default locale', () => {
      const observed = corpus.map(entry => [entry.path, disposition(entry.path)]);
      const expected = corpus.map(entry => [
        entry.path,
        entry.locale === null ? 'site_index' : 'locale_prefixed_site',
      ]);

      expect(observed).toEqual(expected);
    });
  });

  // Direction 2: no unmatchable served path. This is the 8f47ac27 bug class —
  // the server renders the shell, the SPA matches nothing, the visitor gets
  // chrome with a hole in it.
  describe('every served path the site shell receives is matchable', () => {
    it('resolves each corpus path against the real site router', () => {
      const observed = corpus.map(entry => [entry.path, siteRouter.resolve(entry.path).matched.length > 0]);
      const expected = corpus.map(entry => [entry.path, true]);

      expect(observed).toEqual(expected);
    });

    // Pinned as a table rather than filtered, so reserving a new top-level
    // segment and routing it to the site shell without a site route fails here.
    // Mirrors how reserved-segments.test.ts pins expectedRouterSegments.
    it('pins the server disposition of every reserved first segment', () => {
      const observed = Object.fromEntries(
        RESERVED_ROUTE_SEGMENTS.map(segment => [segment, disposition(`/${segment}`)]),
      );

      expect(observed).toEqual({
        // Server-owned and client-shell segments: the site router is not
        // supposed to have a route for any of these.
        '.well-known': 'client_index',
        admin: 'client_index',
        api: 'client_index',
        assets: 'client_index',
        auth: 'client_index',
        calendar: 'client_index',
        calendars: 'client_index',
        coverage: 'client_index',
        event: 'client_index',
        feed: 'client_index',
        funding: 'client_index',
        health: 'client_index',
        inbox: 'client_index',
        login: 'client_index',
        policy: 'client_index',
        profile: 'client_index',
        setup: 'client_index',
        users: 'client_index',
        // The bare segment falls to the client shell; only '/widget/…' reaches
        // the widget routes registered above the page routes.
        widget: 'client_index',
        // The one reserved segment the site SPA owns.
        discover: 'site_index',
        // Reserved permanently, and redirect-only forever (DEC-018).
        view: 'legacy_view_redirect',
      });
    });

    // Locale codes are asserted by derivation, not enumeration, because that is
    // how DEC-018 reserves them: RESERVED_ROUTE_SEGMENTS omits them and
    // isReservedRouteSegment ORs the array against isValidLanguageCode. Naming
    // them here would make enabling a language a three-file edit for no gain.
    it('pins a bare locale root as a redirect for every enabled language', () => {
      const codes = getDefaultEnabledLanguageCodes();
      const observed = codes.map(code => [code, disposition(`/${code}`)]);

      expect(observed).toEqual(codes.map(code => [code, 'locale_root_redirect']));
    });

    it('gives the site router a match for every reserved segment served to the site shell', () => {
      const segments = [...RESERVED_ROUTE_SEGMENTS, ...getDefaultEnabledLanguageCodes()];
      const servedToSite = segments.filter(segment => SITE_SHELL_HANDLERS.has(disposition(`/${segment}`)));

      // Non-vacuity: 'discover' qualifies today, so an empty list here would
      // mean the filter stopped working, not that the contract holds.
      expect(servedToSite).not.toEqual([]);

      const observed = servedToSite.map(segment => [segment, siteRouter.resolve(`/${segment}`).matched.length > 0]);
      expect(observed).toEqual(servedToSite.map(segment => [segment, true]));
    });
  });

  // Direction 3: the sharpest form of the same assertion. Legacy '/view' URLs
  // are held by federated peers, search indexes and bookmarks, so the 301 has
  // to land on a path the SPA can render — and any '/view/…' path produced
  // CLIENT-side never reaches the server at all, which is the failure 8f47ac27
  // shipped.
  describe('every legacy /view URL redirects somewhere the site router can render', () => {
    it('routes every /view twin to the legacy redirect handler', () => {
      const observed = corpus.map(entry => [viewTwin(entry), disposition(viewTwin(entry))]);

      expect(observed).toEqual(corpus.map(entry => [viewTwin(entry), 'legacy_view_redirect']));
    });

    it('301s each /view twin onto its root-URL twin, and the site router matches that target', async () => {
      const observed: [string, string, boolean][] = [];

      for (const entry of corpus) {
        const twin = viewTwin(entry);
        const target = await legacyRedirectTarget(twin);

        observed.push([twin, target, siteRouter.resolve(target).matched.length > 0]);
      }

      expect(observed).toEqual(corpus.map(entry => [viewTwin(entry), entry.path, true]));
    });

    it('matches no /view path inside the SPA, which is the 8f47ac27 failure mode stated', () => {
      // The companion negative is what makes the pair a regression test rather
      // than a redirect test. A <RouterLink> to '/view/mycalendar' updates
      // currentRoute.path while matching nothing — the server never sees the
      // navigation, so the 301 above cannot save it.
      expect(siteRouter.resolve('/view/mycalendar').matched).toHaveLength(0);

      const observed = corpus.map(entry => [viewTwin(entry), siteRouter.resolve(viewTwin(entry)).matched.length]);
      expect(observed).toEqual(corpus.map(entry => [viewTwin(entry), 0]));
    });
  });

  // Read this block before "tightening" the join into a biconditional: the two
  // tables are asymmetric by design, and a set-equality assertion would fail on
  // correct code.
  describe('the two places the tables disagree on purpose', () => {
    it('sends the domain root to the client shell, so the site router matching nothing is correct', () => {
      // DEC-018: "The client SPA keeps '/' and its own top-level segments." The
      // site router having no route for '/' is therefore not an orphan. That it
      // renders blank rather than a 404 is a separate known gap, documented at
      // src/site/test/router-locale-guard.test.ts ('should leave the site root
      // unmatched by every shipped route').
      expect(disposition('/')).toBe('client_index');
      expect(siteRouter.resolve('/').matched).toHaveLength(0);
    });

    it('serves a non-slug :startTime to the site shell even though the site router rejects it', () => {
      // The server's page regexes are prefix-shaped ('(?:/.*)?$'), so the server
      // hands the site shell any depth under a non-reserved first segment and
      // lets the SPA decide. Here the SPA decides no: the
      // ':startTime(\d{8}-\d{4})' constraint rejects the segment. Answering a
      // 404-shaped public URL is the site SPA's job, not the server's, so this
      // pair is the division of labour working — not a hole to close.
      const path = '/mycalendar/events/event-123/not-a-slug';

      expect(disposition(path)).toBe('site_index');
      expect(siteRouter.resolve(path).matched).toHaveLength(0);
    });
  });
});
