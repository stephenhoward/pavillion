import { Request, Response, Router } from 'express';
import express from 'express';
import fs from "fs/promises";
import path from "path";

const router = Router();
const environment = process.env.NODE_ENV;

const supportedAssets = ["svg", "png", "jpg", "png", "jpeg", "mp4", "ogv"];

const assetExtensionRegex = () => {
  const formattedExtensionList = supportedAssets.join("|");

  return new RegExp(`/.+\.(${formattedExtensionList})$`);
};

const parseManifest = async () => {
  if (environment !== "production") return {};

  const manifestPath = path.join(path.resolve(), "dist", "manifest.json");
  const manifestFile = await fs.readFile(manifestPath, 'utf-8');

  return JSON.parse(manifestFile);
};

const handlers = {
  index: async (req: Request, res: Response) => {
    const data = {
      environment,
      manifest: await parseManifest(),
    };

    res.render("index.html.ejs", data);
  },
  assets: async (req: Request, res: Response) => {
    console.log("ASSET PATH" + req.path);
    res.redirect(303, `http://localhost:5173/${req.path}`);
  }
};

/* GET home page. */
router.get('/', handlers.index);

/* redirect to assets server */
router.get(assetExtensionRegex(), handlers.assets);

export { handlers, router };