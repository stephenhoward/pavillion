import { Request, Response, Router } from 'express';
import fs from "fs/promises";
import path from "path";

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
  const manifestFile = await fs.readFile(manifestPath, 'utf-8');

  return JSON.parse(manifestFile);
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
   * Renders the single-page-application template.
   *
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @returns {Promise<void>}
   */
  site_index: async (req: Request, res: Response) => {
    const data = {
      environment,
      manifest: await parseManifest(),
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
router.get(/^\/widget\/.*/i, handlers.widget_index);

// Public site routes
router.get(/^\/@.*/i, handlers.site_index);

// Client app catch-all (goes last)
router.get(/^\/(?!(api|assets|\.well-known|calendars|users|widget)\/).*/i, handlers.client_index);

export { handlers, router };
