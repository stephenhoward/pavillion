import express from 'express';
import fs from "fs/promises";
import path from "path";

const router = express.Router();
const environment = process.env.NODE_ENV;

/* GET home page. */
router.get('/', async (req, res) => {
  const data = {
    environment,
    manifest: await parseManifest(),
  };

  res.render("index.html.ejs", data);
});

const supportedAssets = ["svg", "png", "jpg", "png", "jpeg", "mp4", "ogv"];

const assetExtensionRegex = () => {
  const formattedExtensionList = supportedAssets.join("|");

  return new RegExp(`/src/.+\.(${formattedExtensionList})$`);
};

router.get(assetExtensionRegex(), (req, res) => {
  console.log("ASSET PATH" + req.path);
  res.redirect(303, `http://localhost:5173/src${req.path}`);
});


const parseManifest = async () => {
  if (environment !== "production") return {};

  const manifestPath = path.join(path.resolve(), "dist", "manifest.json");
  const manifestFile = await fs.readFile(manifestPath, 'utf-8');

  return JSON.parse(manifestFile);
};

export default router;