import { Request, Response, Router } from 'express';
import fs from "fs/promises";
import path from "path";

const router = Router();
const environment = process.env.NODE_ENV;

const supportedAssets = ["svg", "png", "jpg", "png", "jpeg", "mp4", "ogv"];

/**
 * @returns {RegExp} A regular expression matching URLs ending with supported asset extensions
 */
const assetExtensionRegex = () => {
  const formattedExtensionList = supportedAssets.join("|");

  return new RegExp(`/.+\.(${formattedExtensionList})$`);
};

/**
 * Parses the asset manifest file in production environment.
 *
 * @returns {Promise<Record<string, any>>} Manifest data as an object, or empty object in non-production environments
 */
const parseManifest = async () => {
  if (environment !== "production") return {};

  const manifestPath = path.join(path.resolve(), "dist", "manifest.json");
  const manifestFile = await fs.readFile(manifestPath, 'utf-8');

  return JSON.parse(manifestFile);
};

const handlers = {
  /**
   * Handles requests for the index/home page.
   * Renders the single-page-application template.
   *
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @returns {Promise<void>}
   */
  index: async (req: Request, res: Response) => {
    const data = {
      environment,
      manifest: await parseManifest(),
    };

    res.render("index.html.ejs", data);
  },

  /**
   * Handles asset requests in development mode by redirecting to the dev server.
   *
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @returns {Promise<void>}
   */
  assets: async (req: Request, res: Response) => {
    res.redirect(303, `http://localhost:5173/${req.path}`);
  },

  /**
   * Handles coverage report requests in development mode by redirecting to the dev server.
   *
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @returns {Promise<void>}
   */
  coverage: async (req: Request, res: Response) => {
    res.redirect(303, `http://localhost:5173/${req.path}`);
  },
};

/* GET home page. */
router.get('/', handlers.index);

if (environment !== "production") {
  /* redirect to assets server */
  router.get(assetExtensionRegex(), handlers.assets);

  /* redirect to coverage server */
  router.get("/coverage/*", handlers.coverage);
};

// This goes last:
router.get(/^\/(?!(api|assets|\.well-known|o)\/).*/i, handlers.index);

export { handlers, router };
