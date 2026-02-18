import { Request, Response, Router } from 'express';
import fs from "fs/promises";
import path from "path";
import { DEFAULT_LANGUAGE_CODE, isValidLanguageCode } from '@/common/i18n/languages';
import { stripLocalePrefix } from '@/common/i18n/locale-url';
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
 * Resolves the instance default language from configuration.
 *
 * Falls back gracefully if the settings service is unavailable.
 *
 * @returns {Promise<string>} The instance default language code
 */
const resolveInstanceDefaultLanguage = async (): Promise<string> => {
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
    const data = {
      environment,
      manifest: await parseManifest(),
    };

    res.render("client.index.html.ejs", data);
  },

  /**
   * Handles requests for the site index/home page.
   * Renders the single-page-application template with locale information.
   *
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @returns {Promise<void>}
   */
  site_index: async (req: Request, res: Response) => {
    const data = {
      environment,
      manifest: await parseManifest(),
      locale: req.locale ?? DEFAULT_LANGUAGE_CODE,
    };
    res.render("site.index.html.ejs", data);
  },

  /**
   * Handles locale-prefixed public site routes (e.g., /es/@calendar).
   *
   * Uses the as-needed strategy: if the locale prefix matches the instance
   * default language, redirect (301) to the unprefixed URL. Otherwise, serve
   * the site SPA template — req.locale is already set by the locale middleware.
   *
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @returns {Promise<void>}
   */
  locale_prefixed_site: async (req: Request, res: Response) => {
    const { locale: urlLocale, path: strippedPath } = stripLocalePrefix(req.path);

    // If no valid locale prefix found, fall through to serve SPA normally
    if (!urlLocale) {
      const data = {
        environment,
        manifest: await parseManifest(),
        locale: req.locale ?? DEFAULT_LANGUAGE_CODE,
      };
      res.render("site.index.html.ejs", data);
      return;
    }

    const defaultLanguage = await resolveInstanceDefaultLanguage();

    // Redirect to unprefixed URL when the prefix is the instance default language
    if (urlLocale === defaultLanguage) {
      const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect(301, strippedPath + queryString);
      return;
    }

    // Serve the site SPA — req.locale is already set by the locale middleware
    const data = {
      environment,
      manifest: await parseManifest(),
      locale: req.locale ?? DEFAULT_LANGUAGE_CODE,
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

// Locale-prefixed public site routes: /[locale]/@...
// Handles both non-default locale serving and default-locale redirects.
// Must come before the unprefixed site route so prefixed URLs are handled first.
router.get(/^\/[a-z]{2,8}\/@/i, handlers.locale_prefixed_site);

// Public site routes (unprefixed — default language, as-needed strategy)
router.get(/^\/@.*/i, handlers.site_index);

// Client app catch-all (goes last)
router.get(/^\/(?!(api|assets|\.well-known|calendars|users|widget)\/).*/i, handlers.client_index);

export { handlers, router, resolveInstanceDefaultLanguage };
