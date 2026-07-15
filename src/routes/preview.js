import { Router } from "express";
import { listPackages } from "../repositories/appRepository.js";
import {
  contentTypeFor,
  fetchGitHubPackageFile,
  findPackageByPreviewToken,
  previewSourceForPackage,
  rewritePreviewAssets
} from "../services/packagePreview.js";
import { classifyFile } from "../services/githubImport.js";
import { inferRedirectFile, injectPreviewTurnstile, isCaptchaGatePage } from "../services/turnstile.js";

export const previewRouter = Router();

async function packageFromToken(token) {
  const packages = await listPackages();
  return findPackageByPreviewToken(packages, token);
}

async function renderPreviewHtml(req, res, pagePackage, file) {
  const source = previewSourceForPackage(pagePackage, file);
  if (classifyFile(source.file) !== "html") {
    res.status(400).send("Preview file must be HTML");
    return;
  }

  const response = await fetchGitHubPackageFile(source);
  const html = await response.text();
  if (!file && isCaptchaGatePage(html)) {
    const nextFile = inferRedirectFile(html);
    res.redirect(302, `/preview/${encodeURIComponent(req.params.token)}/page?file=${encodeURIComponent(nextFile)}`);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.send(rewritePreviewAssets(injectPreviewTurnstile(html, { token: req.params.token }), { token: req.params.token, file: source.file }));
}

previewRouter.get("/:token/asset", async (req, res) => {
  try {
    const pagePackage = await packageFromToken(req.params.token);
    if (!pagePackage) {
      res.status(404).send("Preview token not found");
      return;
    }

    const file = String(req.query.file || "");
    if (!file) {
      res.status(400).send("Asset file is required");
      return;
    }

    const source = previewSourceForPackage(pagePackage, file);
    const response = await fetchGitHubPackageFile(source);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentTypeFor(file));
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(buffer);
  } catch (error) {
    res.status(404).send(String(error.message || error));
  }
});

previewRouter.get("/:token/page", async (req, res) => {
  try {
    const pagePackage = await packageFromToken(req.params.token);
    if (!pagePackage) {
      res.status(404).send("Preview token not found");
      return;
    }

    const file = String(req.query.file || "");
    if (!file) {
      res.status(400).send("Preview page file is required");
      return;
    }

    await renderPreviewHtml(req, res, pagePackage, file);
  } catch (error) {
    res.status(400).send(`<pre>${String(error.message || error)}</pre>`);
  }
});

previewRouter.get("/:token", async (req, res) => {
  try {
    const pagePackage = await packageFromToken(req.params.token);
    if (!pagePackage) {
      res.status(404).send("Preview token not found");
      return;
    }

    await renderPreviewHtml(req, res, pagePackage);
  } catch (error) {
    res.status(400).send(`<pre>${String(error.message || error)}</pre>`);
  }
});
