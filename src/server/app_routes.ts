import { Request, Response, Router } from 'express';
import fs from "fs/promises";
import path from "path";
import config from 'config';
import { stripLocalePrefix, addLocalePrefix } from '@/common/i18n/locale-url';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE, getDefaultEnabledLanguageCodes } from '@/common/i18n/languages';
import ConfigurationInterface from '@/server/configuration/interface';

const environment = process.env.NODE_ENV;

const supportedAssets = ["svg", "png", "jpg", "png", "jpeg", "mp4", "ogv", "otf", "ttf", "woff", "woff2"];

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
 * @param canonicalPath - The path without any locale prefix (e.g. "/view/calendar")
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
 * Creates the application router with all page and asset routes.
 *
 * @param configInterface - ConfigurationInterface for reading instance settings
 * @returns Object containing the configured Express router and handlers
 */
export function createRouter(configInterface: ConfigurationInterface) {
  const router = Router();

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
      const data = {
        environment,
        manifest: await parseManifest(),
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

      const data = {
        environment,
        manifest: await parseManifest(),
        locale: req.locale,
        siteBaseUrl: getSiteBaseUrl(req),
        hreflangLinks: buildHreflangLinks(req, canonicalPath, instanceDefault),
      };
      res.render("site.index.html.ejs", data);
    },

    /**
     * Handles locale-prefixed site routes (e.g. /es/view/calendar).
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

      // If the path segment is not a valid locale, serve the site SPA normally
      if (!locale) {
        const instanceDefault = await resolveInstanceDefaultLanguage(configInterface);
        const { path: canonicalPath } = stripLocalePrefix(req.path);
        const data = {
          environment,
          manifest: await parseManifest(),
          locale: req.locale,
          siteBaseUrl: getSiteBaseUrl(req),
          hreflangLinks: buildHreflangLinks(req, canonicalPath, instanceDefault),
        };
        res.render("site.index.html.ejs", data);
        return;
      }

      const instanceDefault = await resolveInstanceDefaultLanguage(configInterface);

      // Redirect to canonical (unprefixed) URL when locale matches instance default
      if (locale === instanceDefault) {
        const redirectUrl = req.query && Object.keys(req.query).length > 0
          ? `${strippedPath}?${new URLSearchParams(req.query as Record<string, string>).toString()}`
          : strippedPath;
        res.redirect(301, redirectUrl);
        return;
      }

      // Serve site SPA with the locale from the URL prefix
      const data = {
        environment,
        manifest: await parseManifest(),
        locale: req.locale,
        siteBaseUrl: getSiteBaseUrl(req),
        hreflangLinks: buildHreflangLinks(req, strippedPath, instanceDefault),
      };
      res.render("site.index.html.ejs", data);
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
      const data = {
        environment,
        manifest: await parseManifest(),
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
        console.error('Error serving widget JavaScript:', error);
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

  // Locale-prefixed public site routes: /[locale]/view/...
  // Handles both non-default locale serving and default-locale redirects.
  // Must come before the unprefixed site route so prefixed URLs are handled first.
  router.get(/^\/[a-z]{2,8}\/view\//i, handlers.locale_prefixed_site);

  // Public site routes (unprefixed — default language, as-needed strategy)
  router.get(/^\/view\/.*/i, handlers.site_index);

  // Client app catch-all (goes last)
  router.get(/^\/(?!(api|assets|\.well-known|calendars|users|view|widget)\/).*/i, handlers.client_index);

  return { router, handlers };
}
