import { Request, Response, Router } from 'express';
import fs from "fs/promises";
import path from "path";
import config from 'config';
import { stripLocalePrefix, addLocalePrefix } from '@/common/i18n/locale-url';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE, getDefaultEnabledLanguageCodes } from '@/common/i18n/languages';
import ConfigurationInterface from '@/server/configuration/interface';
import logger from '@/server/common/helper/logger';
import { PublicInterfaceHolder, parseEventPageParams, buildEventMetaTags, MetaTagData } from '@/server/common/helper/meta-tags';
import { RESERVED_ROUTE_SEGMENTS } from '@/common/routing/reserved-segments';
import { DISCOVER_PATH } from '@/common/routing/public-paths';
import { escapeRegExp } from '@/server/common/helper/regexp';

const environment = process.env.NODE_ENV;

const supportedAssets = ["svg", "png", "jpg", "png", "jpeg", "mp4", "ogv", "otf", "ttf", "woff", "woff2"];

/**
 * Top-level segments this router must not answer for at all.
 *
 * The page router is mounted before every domain router (see
 * src/server/server.ts), so a catch-all that matched these would shadow the
 * domain APIs under /api, the static /assets mount, and the federation routes
 * at /.well-known/webfinger, /calendars/... and /users/... — turning their
 * responses, and their 404s, into an HTML shell. `widget` is the one entry this
 * router owns itself: the widget routes registered below answer it before the
 * catch-all is reached.
 *
 * Every entry is also in RESERVED_ROUTE_SEGMENTS, and a test asserts that; this
 * is the subset the server itself serves. The shared module cannot supply the
 * list, because it records which names a calendar may not claim, not which
 * router owns a segment.
 */
export const SERVER_OWNED_SEGMENTS: readonly string[] = Object.freeze([
  '.well-known',
  'api',
  'assets',
  'calendars',
  'users',
  'widget',
]);

/**
 * Alternation of the enabled locale codes, for the /:locale/... route shapes.
 */
const LOCALE_SEGMENT_PATTERN = getDefaultEnabledLanguageCodes().map(escapeRegExp).join('|');

/**
 * Alternation of every first segment that is not a calendar name.
 *
 * Three things about how this is built:
 *
 * 1. Each entry is escaped before joining. '.well-known' carries a regex
 *    metacharacter, and a naive join would also match 'awell-known'.
 * 2. The enabled locale codes are composed in. RESERVED_ROUTE_SEGMENTS omits
 *    them on purpose — `isReservedRouteSegment` ORs the array against
 *    `isValidLanguageCode` — so an alternation built from the array alone would
 *    reserve strictly less than the validator does and would serve /fr as a
 *    calendar named "fr".
 * 3. Matching happens on the raw, undecoded pathname, which is where Express
 *    puts the decode seam: `decode_param` runs after route matching, and
 *    `isReservedRouteSegment` does no decoding of its own. A percent-encoded
 *    spelling ('/%61dmin') therefore misses this alternation and is treated as
 *    a calendar name — which is safe, because the lookup that follows decodes
 *    first and no calendar can hold a reserved name, so it 404s inside the
 *    public site rather than reaching a privileged route. A reverse proxy that
 *    decodes before forwarding (per DEC-017 the bundled Caddy is an opt-in
 *    profile, so the topology is not fixed) simply hands Express the literal
 *    path, which matches here normally. Both hops end at the same disposition,
 *    so no normalization is done before the check.
 */
const RESERVED_FIRST_SEGMENT_PATTERN = [
  ...RESERVED_ROUTE_SEGMENTS,
  ...getDefaultEnabledLanguageCodes(),
].map(escapeRegExp).join('|');

/**
 * Normalizes a redirect target so it can only ever address this origin.
 *
 * Express does not collapse repeated leading separators, and a Location has to
 * survive two of them: '//evil.com' is protocol-relative, and per the WHATWG
 * URL parser a backslash is handled exactly like a slash in relative-slash
 * state for special schemes, so '/\evil.com' resolves to the authority
 * evil.com as well. `encodeurl` treats 0x5C as safe and emits it verbatim, so
 * the backslash reaches the client untouched. Both are stripped here.
 *
 * The backslash form is reachable: a percent-decoding reverse proxy turns an
 * ordinary-looking '/view/%5Cevil.com' into a literal backslash before Express
 * sees it (per DEC-017 the bundled Caddy is an opt-in profile, so the topology
 * is not fixed), and clients that resolve a Location per WHATWG rather than
 * normalizing it first — in-app webviews, unfurlers, scanners — follow it.
 *
 * This is the single chokepoint for redirect targets in this router; callers
 * pass their remainder straight in rather than pre-stripping separators.
 *
 * @param path - A path derived from req.path
 * @returns The same path with its leading slashes and backslashes collapsed
 *   to a single leading slash
 */
function toSameOriginPath(path: string): string {
  return `/${path.replace(/^[/\\]+/, '')}`;
}

/**
 * Re-attaches the request's query string to a redirect target.
 *
 * The target path is always derived from req.path, and whatever is appended
 * here begins with '?', so nothing in the request URL can reach the authority
 * of the Location. The query is copied verbatim rather than rebuilt through
 * URLSearchParams, which collapses a repeated key into one comma-joined value.
 *
 * `req.originalUrl` keeps the fragment that parseurl strips from `req.path`, so
 * the split has to respect the fragment boundary: everything after a '#' is
 * fragment text and is dropped, including a '?' that appears inside it.
 * Browsers never send a fragment, so only a crafted client reaches that branch.
 *
 * @param targetPath - Same-origin path to redirect to
 * @param req - Express request object
 * @returns The target path with the original query string appended, if any
 */
function withQueryString(targetPath: string, req: Request): string {
  const url = req.originalUrl;
  const queryStart = url.indexOf('?');
  const fragmentStart = url.indexOf('#');

  if (queryStart === -1 || (fragmentStart !== -1 && fragmentStart < queryStart)) {
    return targetPath;
  }

  const queryEnd = fragmentStart > queryStart ? fragmentStart : url.length;

  return `${targetPath}${url.slice(queryStart, queryEnd)}`;
}

/**
 * @returns {RegExp} A regular expression matching URLs ending with supported asset extensions
 */
const assetExtensionRegex = () => {
  const formattedExtensionList = supportedAssets.join("|");

  return new RegExp(`/.+\.(${formattedExtensionList})$`);
};

/**
 * Parses the asset manifest file in production and e2e environments.
 *
 * @returns {Promise<Record<string, any>>} Manifest data as an object, or empty object in development
 */
const parseManifest = async () => {
  // Parse manifest in production and e2e (both serve built assets)
  if (environment !== "production" && environment !== "e2e") return {};

  const manifestPath = path.join(path.resolve(), "dist", ".vite", "manifest.json");

  try {
    const manifestFile = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(manifestFile);
  }
  catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Vite manifest not found at ${manifestPath}. Run "npm run build:frontend" before starting the server in ${environment} mode.`,
      );
    }
    throw error;
  }
};

/**
 * Collects all CSS files for a manifest entry, including CSS from imported chunks.
 *
 * Per Vite's Backend Integration guide, the entry's direct `css` array only lists
 * CSS bundled with the entry itself. Shared chunks created by code splitting may
 * carry additional CSS that must also be included in the server-rendered HTML.
 * This function walks the `imports` tree to collect all chunk CSS.
 *
 * @param manifest - Parsed Vite manifest object
 * @param entryKey - Entry point key (e.g. 'src/site/app.ts')
 * @returns De-duplicated array of CSS file paths from the entry and all its imported chunks
 */
export const collectEntryCSS = (manifest: Record<string, any>, entryKey: string): string[] => {
  const css = new Set<string>();
  const visited = new Set<string>();

  const walk = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);

    const chunk = manifest[key];
    if (!chunk) return;

    if (chunk.css) {
      for (const file of chunk.css) {
        css.add(file);
      }
    }
    if (chunk.imports) {
      for (const imp of chunk.imports) {
        walk(imp);
      }
    }
  };

  walk(entryKey);
  return Array.from(css);
};

/**
 * Resolves the instance default language from the configuration service.
 *
 * Falls back to DEFAULT_LANGUAGE_CODE if the configuration interface is unavailable
 * or returns an invalid/unsupported language code.
 *
 * @param configInterface - The ConfigurationInterface to use for settings lookup
 * @returns {Promise<string>} The instance default language code
 */
export async function resolveInstanceDefaultLanguage(configInterface: ConfigurationInterface): Promise<string> {
  try {
    const value = await configInterface.getDefaultLanguage();

    if (value && isValidLanguageCode(value)) {
      return value;
    }
  }
  catch {
    // Configuration interface unavailable — fall through to hard-coded default
  }

  return DEFAULT_LANGUAGE_CODE;
}

/**
 * Returns the site base URL using the configured canonical domain.
 *
 * Uses req.protocol and config.get('domain') rather than req.get('host') to
 * prevent host-header injection attacks where an attacker sends a spoofed
 * Host header to poison hreflang link generation (SEO poisoning / CDN cache
 * poisoning). The configured domain is a trusted server-side value.
 *
 * @param req - Express request object (used only for protocol detection)
 * @returns Base URL string, e.g. "https://example.com"
 */
export function getSiteBaseUrl(req: Request): string {
  const domain = config.get<string>('domain');
  return `${req.protocol}://${domain}`;
}

/**
 * Returns the list of enabled language codes for hreflang annotations.
 *
 * @returns Array of language code strings
 */
export function getEnabledLanguageCodes(): string[] {
  return getDefaultEnabledLanguageCodes();
}

/**
 * Builds the hreflang link data for all enabled languages plus x-default.
 *
 * Each entry has:
 * - hreflang: the BCP 47 language tag (or "x-default" for the default language)
 * - href: the full URL for this language version of the current canonical path
 *
 * The x-default entry points to the unprefixed (default-language) URL.
 *
 * @param req - Express request object
 * @param canonicalPath - The path without any locale prefix (e.g. "/mycalendar")
 * @param defaultLocale - The instance default locale code
 * @returns Array of { hreflang, href } objects
 */
export function buildHreflangLinks(
  req: Request,
  canonicalPath: string,
  defaultLocale: string,
): { hreflang: string; href: string }[] {
  const baseUrl = getSiteBaseUrl(req);
  const enabledCodes = getEnabledLanguageCodes();

  const links: { hreflang: string; href: string }[] = enabledCodes.map(code => ({
    hreflang: code,
    href: `${baseUrl}${addLocalePrefix(canonicalPath, code, defaultLocale)}`,
  }));

  // x-default points to the unprefixed (default locale) URL
  const defaultHref = `${baseUrl}${addLocalePrefix(canonicalPath, defaultLocale, defaultLocale)}`;
  links.push({ hreflang: 'x-default', href: defaultHref });

  return links;
}

/**
 * Resolves meta tag data for event pages, returning null for non-event pages.
 *
 * Takes the request path as received, not a locale-stripped remainder:
 * parseEventPageParams strips at most one locale prefix itself and documents
 * that contract, because a path stripped twice would read `/fr/es/cal/events/x`
 * as `cal`'s event page.
 *
 * @param publicInterfaceHolder - Holder for the public calendar interface
 * @param requestPath - The request path (req.path), locale prefix included
 * @param locale - The resolved locale for content
 * @param baseUrl - The site base URL
 * @returns MetaTagData or null
 */
async function resolveMetaTags(
  publicInterfaceHolder: PublicInterfaceHolder,
  requestPath: string,
  locale: string,
  baseUrl: string,
): Promise<MetaTagData | null> {
  const params = parseEventPageParams(requestPath);
  if (!params) {
    return null;
  }
  return buildEventMetaTags(publicInterfaceHolder, params, locale, baseUrl);
}

/**
 * Creates the application router with all page and asset routes.
 *
 * @param configInterface - ConfigurationInterface for reading instance settings
 * @param publicInterfaceHolder - Late-binding holder for the public calendar interface (used for meta tag resolution)
 * @returns Object containing the configured Express router and handlers
 */
export function createRouter(
  configInterface: ConfigurationInterface,
  publicInterfaceHolder: PublicInterfaceHolder = { current: null },
) {
  const router = Router();

  /**
   * Builds a 301 target for a canonical (unprefixed) path under a URL locale.
   *
   * The prefix is dropped when the locale is the instance default, so a legacy
   * URL that needs both the /view removal and the default-locale removal lands
   * on its final destination in a single hop.
   *
   * @param canonicalPath - Same-origin path without a locale prefix
   * @param locale - Locale found in the request path, or null when unprefixed
   * @returns {Promise<string>} The redirect target path
   */
  const localizeRedirectTarget = async (canonicalPath: string, locale: string | null): Promise<string> => {
    if (!locale) {
      return canonicalPath;
    }

    const instanceDefault = await resolveInstanceDefaultLanguage(configInterface);
    return addLocalePrefix(canonicalPath, locale, instanceDefault);
  };

  const handlers = {
    /**
     * Handles requests for the client app index/home page.
     * Renders the single-page-application template.
     *
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    client_index: async (req: Request, res: Response) => {
      const manifest = await parseManifest();
      const data = {
        environment,
        manifest,
        cssFiles: collectEntryCSS(manifest, 'src/client/app.ts'),
      };

      res.render("client.index.html.ejs", data);
    },

    /**
     * Handles requests for the site index/home page.
     * Renders the single-page-application template with locale data.
     *
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    site_index: async (req: Request, res: Response) => {
      const instanceDefault = await resolveInstanceDefaultLanguage(configInterface);
      const { path: canonicalPath } = stripLocalePrefix(req.path);
      const baseUrl = getSiteBaseUrl(req);

      const meta = await resolveMetaTags(publicInterfaceHolder, req.path, req.locale, baseUrl);
      const manifest = await parseManifest();

      const data = {
        environment,
        manifest,
        cssFiles: collectEntryCSS(manifest, 'src/site/app.ts'),
        locale: req.locale,
        siteBaseUrl: baseUrl,
        hreflangLinks: buildHreflangLinks(req, canonicalPath, instanceDefault),
        meta,
      };
      res.render("site.index.html.ejs", data);
    },

    /**
     * Handles locale-prefixed site routes (e.g. /es/mycalendar, /es/discover).
     *
     * If the locale in the URL matches the instance default language, redirects
     * to the unprefixed canonical URL (301). Otherwise, serves the site SPA with
     * the appropriate locale data.
     *
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    locale_prefixed_site: async (req: Request, res: Response) => {
      const { locale, path: strippedPath } = stripLocalePrefix(req.path);

      // Every route wired to this handler matches a validated locale
      // alternation, so `locale` is never null here. Delegating rather than
      // throwing keeps a future wiring mistake serving a page.
      if (!locale) {
        await handlers.site_index(req, res);
        return;
      }

      const instanceDefault = await resolveInstanceDefaultLanguage(configInterface);

      // Redirect to canonical (unprefixed) URL when locale matches instance default
      if (locale === instanceDefault) {
        res.redirect(301, withQueryString(toSameOriginPath(strippedPath), req));
        return;
      }

      // Serve site SPA with the locale from the URL prefix
      const baseUrl = getSiteBaseUrl(req);

      const meta = await resolveMetaTags(publicInterfaceHolder, req.path, locale, baseUrl);
      const manifest = await parseManifest();

      const data = {
        environment,
        manifest,
        cssFiles: collectEntryCSS(manifest, 'src/site/app.ts'),
        locale: req.locale,
        siteBaseUrl: baseUrl,
        hreflangLinks: buildHreflangLinks(req, strippedPath, instanceDefault),
        meta,
      };
      res.render("site.index.html.ejs", data);
    },

    /**
     * Permanently redirects a legacy /view URL onto the root URL shape.
     *
     * /view and /view/ carry no calendar, so they land on the discovery page;
     * /view/<rest> drops the segment and keeps <rest> at the root. A locale
     * prefix is preserved unless it is the instance default, in which case it
     * is dropped in the same hop.
     *
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    legacy_view_redirect: async (req: Request, res: Response) => {
      const { locale, path: unprefixedPath } = stripLocalePrefix(req.path);
      // toSameOriginPath does the separator stripping, so '/view', '/view/' and
      // '/view//' all arrive here as '/' — the no-calendar case.
      const rest = toSameOriginPath(unprefixedPath.slice('/view'.length));
      const canonicalPath = rest === '/' ? DISCOVER_PATH : rest;

      res.redirect(301, withQueryString(await localizeRedirectTarget(canonicalPath, locale), req));
    },

    /**
     * Permanently redirects a bare locale root (/es, /es/) to that locale's
     * discovery page. The locale prefix has no page of its own.
     *
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    locale_root_redirect: async (req: Request, res: Response) => {
      const { locale } = stripLocalePrefix(req.path);

      res.redirect(301, withQueryString(await localizeRedirectTarget(DISCOVER_PATH, locale), req));
    },

    /**
     * Handles requests for the widget app index page.
     * Renders the widget single-page-application template.
     *
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    widget_index: async (req: Request, res: Response) => {
      const manifest = await parseManifest();
      const data = {
        environment,
        manifest,
        cssFiles: collectEntryCSS(manifest, 'src/widget/app.ts'),
      };
      res.render("widget.index.html.ejs", data);
    },

    /**
     * Handles asset requests in development mode by redirecting to the dev server.
     *
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    assets: async (req: Request, res: Response) => {
      res.redirect(303, `http://localhost:5173${req.path}`);
    },

    /**
     * Handles coverage report requests in development mode by redirecting to the dev server.
     *
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    coverage: async (req: Request, res: Response) => {
      res.redirect(303, `http://localhost:5173${req.path}`);
    },

    /**
     * Serves the widget JavaScript file from the dist folder.
     * Sets proper CORS headers and content type for cross-origin embedding.
     *
     * @param {req} req - Express request object
     * @param {Response} res - Express response object
     * @returns {Promise<void>}
     */
    widget_javascript: async (req: Request, res: Response) => {
      const widgetPath = path.join(path.resolve(), "dist", "widget", "pavillion-widget.js");

      try {
        const widgetContent = await fs.readFile(widgetPath, 'utf-8');

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-Type', 'application/javascript');
        res.send(widgetContent);
      }
      catch (error) {
        logger.error({ err: error }, 'Error serving widget JavaScript');
        res.status(404).send('Widget JavaScript not found');
      }
    },
  };

  /* GET home page. */
  router.get('/', handlers.client_index);

  // In development, redirect assets to Vite dev server
  // In e2e mode, serve assets from dist folder (like production)
  if (environment === "development") {
    /* redirect to assets server */
    router.get(assetExtensionRegex(), handlers.assets);

    /* redirect to coverage server */
    router.get("/coverage/*", handlers.coverage);
  }

  // Widget routes (before site routes to ensure they match first)
  // Serve the widget JavaScript file (must come before catch-all widget route)
  router.get('/widget/pavillion-widget.js', handlers.widget_javascript);

  // Widget HTML shell: allow framing from any origin (frame-ancestors *)
  //
  // Security rationale (pv-tlal):
  // The widget iframe contains only public, read-only event data. It has no
  // authenticated user state, no forms, and no actions that mutate server state
  // on behalf of a visitor. The clickjacking risk for read-only public content
  // is negligible — there is nothing for an attacker to hijack a click toward.
  //
  // The widget data API (/api/widget/v1/) independently enforces a per-calendar
  // domain allowlist via Origin header validation, which protects that data
  // endpoint — it does not gate access to this HTML shell page itself.
  //
  // A narrowed frame-ancestors header would require a database lookup on every
  // widget page load and would only marginally reduce an already-low residual
  // risk. The complexity cost is not justified for public-only content.
  //
  // If the widget ever gains authenticated state or user-action buttons, this
  // decision must be revisited and the per-calendar allowlist applied here too.
  //
  // Also remove X-Frame-Options: DENY (set globally by helmet) since it would
  // override frame-ancestors in legacy browsers and prevent widget embedding.
  router.use(/^\/widget\/.+/i, (req, res, next) => {
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.removeHeader('X-Frame-Options');
    next();
  });

  router.get(/^\/widget\/.*/i, handlers.widget_index);

  // Page routes. Per DEC-018 public calendars live at the domain root, so the
  // site SPA is the default and the client SPA keeps `/` plus the reserved
  // segments; discovery is /discover and /view is redirect-only, forever.
  //
  // RESERVED_ROUTE_SEGMENTS answers one question — may a calendar claim this
  // name? — and membership means four different things to a router: `discover`
  // is a site SPA page, `view` only redirects, the SERVER_OWNED_SEGMENTS must
  // fall through to the domain routers mounted after this one, and the rest
  // belong to the client shell. The routes that need a disposition of their own
  // are therefore registered BEFORE the derived site routes and win on
  // Express's first-match-wins ordering; nothing is subtracted from the array.

  // Legacy /view URLs — 301 onto the root URL shape.
  router.get(/^\/view(?:\/.*)?$/i, handlers.legacy_view_redirect);
  router.get(new RegExp(`^/(?:${LOCALE_SEGMENT_PATTERN})/view(?:/.*)?$`, 'i'), handlers.legacy_view_redirect);

  // Public discovery page.
  router.get(/^\/discover(?:\/.*)?$/i, handlers.site_index);
  router.get(new RegExp(`^/(?:${LOCALE_SEGMENT_PATTERN})/discover(?:/.*)?$`, 'i'), handlers.locale_prefixed_site);

  // A bare locale root (/es, /es/) has no page of its own.
  router.get(new RegExp(`^/(?:${LOCALE_SEGMENT_PATTERN})/?$`, 'i'), handlers.locale_root_redirect);

  // Root calendar pages — /:calendarName and /:locale/:calendarName, each with
  // their event and series subpaths. The first non-locale segment must not be
  // reserved; the exclusion is derived from the shared module, so a segment
  // added there stops reaching the site SPA without editing this file.
  router.get(
    new RegExp(`^/(?:${LOCALE_SEGMENT_PATTERN})/(?!(?:${RESERVED_FIRST_SEGMENT_PATTERN})(?:/|$))[^/]+(?:/.*)?$`, 'i'),
    handlers.locale_prefixed_site,
  );
  router.get(
    new RegExp(`^/(?!(?:${RESERVED_FIRST_SEGMENT_PATTERN})(?:/|$))[^/]+(?:/.*)?$`, 'i'),
    handlers.site_index,
  );

  // Client app catch-all (goes last). The exclusion is the server-owned subset
  // only: those paths belong to routers mounted after this one, and matching
  // them here would answer an API or federation request with an HTML shell.
  router.get(
    new RegExp(`^/(?!(?:${SERVER_OWNED_SEGMENTS.map(escapeRegExp).join('|')})/).*`, 'i'),
    handlers.client_index,
  );

  return { router, handlers };
}
