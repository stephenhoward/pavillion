import { Request, Response, Router } from 'express';
import fs from "fs/promises";
import path from "path";
import { stripLocalePrefix, addLocalePrefix } from '@/common/i18n/locale-url';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE, AVAILABLE_LANGUAGES, BETA_THRESHOLD } from '@/common/i18n/languages';
import ServiceSettings from '@/server/configuration/service/settings';

const router = Router();
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
 * Falls back to DEFAULT_LANGUAGE_CODE if the settings service is unavailable
 * or returns an invalid/unsupported language code.
 *
 * @returns {Promise<string>} The instance default language code
 */
export async function resolveInstanceDefaultLanguage(): Promise<string> {
  try {
    const settings = await ServiceSettings.getInstance();
    const value = settings.get('defaultLanguage');

    if (value && isValidLanguageCode(String(value))) {
      return String(value);
    }
  }
  catch {
    // Settings service unavailable — fall through to hard-coded default
  }

  return DEFAULT_LANGUAGE_CODE;
}

/**
 * Returns the site base URL from the incoming request.
 *
 * Uses req.protocol and req.get('host') so it works across development,
 * e2e, and production environments without additional configuration.
 *
 * @param req - Express request object
 * @returns Base URL string, e.g. "https://example.com"
 */
export function getSiteBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Returns the list of enabled language codes for hreflang annotations.
 *
 * Only languages with completeness >= BETA_THRESHOLD are included; incomplete
 * languages are excluded because they are hidden from the UI.
 *
 * @returns Array of language code strings
 */
export function getEnabledLanguageCodes(): string[] {
  return AVAILABLE_LANGUAGES
    .filter(lang => lang.completeness >= BETA_THRESHOLD)
    .map(lang => lang.code);
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
 * @param canonicalPath - The path without any locale prefix (e.g. "/@calendar")
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
    const instanceDefault = await resolveInstanceDefaultLanguage();
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
   * Handles locale-prefixed site routes (e.g. /es/@calendar).
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
      const instanceDefault = await resolveInstanceDefaultLanguage();
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

    const instanceDefault = await resolveInstanceDefaultLanguage();

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
};

// Widget routes (before site routes to ensure they match first)
// Serve the widget JavaScript file (must come before catch-all widget route)
router.get('/widget/pavillion-widget.js', handlers.widget_javascript);

// Add middleware to allow widget pages to be framed
// This overrides the default CSP frame-ancestors 'none' set in server.ts
router.use(/^\/widget\/.+/i, (req, res, next) => {
  // Allow framing from any origin for widget pages
  // Widget pages need to be embeddable in iframes on external sites
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

router.get(/^\/widget\/.*/i, handlers.widget_index);

// Locale-prefixed site routes: /xx/@... where xx is a potential locale code
// These match before the plain @-routes so we can handle locale prefix logic
router.get(/^\/[a-z]{2,8}\/@.*/i, handlers.locale_prefixed_site);

// Public site routes (unprefixed)
router.get(/^\/@.*/i, handlers.site_index);

// Client app catch-all (goes last)
router.get(/^\/(?!(api|assets|\.well-known|calendars|users|widget)\/).*/i, handlers.client_index);

export { handlers, router, resolveInstanceDefaultLanguage };
