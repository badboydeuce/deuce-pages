import { Router } from "express";
import { createPackage, findPackage, publishPackage, updatePackage } from "../repositories/appRepository.js";
import { requireAdmin } from "../middleware/auth.js";
import { classifyFile, githubRawUrl, normalizeRepoUrl, scanGitHubRepository } from "../services/githubImport.js";
import { withPreviewToken } from "../services/packagePreview.js";
import { injectPreviewTurnstile } from "../services/turnstile.js";
import { finalizeLocalImport, startLooseImport, startZipImport } from "../services/localImport.js";
import { objectStorageConfigured } from "../services/objectStorage.js";

export const importsRouter = Router();

importsRouter.get("/local/status", requireAdmin, (req, res) => {
  res.json({ configured: objectStorageConfigured() });
});

importsRouter.post("/local/start", requireAdmin, async (req, res) => {
  try {
    const input = { ...req.body, userId: req.user.id };
    const session = req.body.mode === "zip"
      ? await startZipImport(input)
      : await startLooseImport(input);
    res.status(201).json(session);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

importsRouter.post("/local/finalize", requireAdmin, async (req, res) => {
  try {
    const { payload, files, scan } = await finalizeLocalImport({ token: req.body.importToken, userId: req.user.id });
    const publish = Boolean(req.body.publish);
    if (publish && !scan.review.publishable) {
      res.status(400).json({ error: "Local package is not publishable yet", scan, review: scan.review });
      return;
    }
    const packageData = {
      slug: payload.slug,
      name: payload.packageName,
      version: payload.version,
      status: publish ? "published" : "draft",
      sourceType: "r2",
      billingPeriods: req.body.billingPeriods || { daily: 5, weekly: 25, biweekly: 45, monthly: 80 },
      screens: scan.screens.map((screen) => screen.name),
      assets: scan.assets,
      cssFiles: scan.cssFiles,
      designTokens: req.body.designTokens || { brand: "#7CFFB2", font: "Inter", radius: "8px" },
      packageManifest: {
        r2: { prefix: payload.prefix },
        files: scan.files,
        screens: scan.screens,
        scripts: scan.scripts,
        review: scan.review,
        importedAt: new Date().toISOString()
      }
    };
    const existing = await findPackage(payload.slug);
    const pagePackage = existing
      ? await updatePackage(existing.id, packageData)
      : await createPackage(packageData);
    const finalPackage = publish ? await publishPackage(pagePackage.id) : pagePackage;
    res.status(201).json({ package: withPreviewToken(finalPackage), scan, files: files.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function contentTypeFor(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function resolveRelativePath(fromFile, relativePath) {
  if (!relativePath || /^(?:[a-z]+:)?\/\//i.test(relativePath) || /^(?:data|mailto|tel):/i.test(relativePath) || relativePath.startsWith("#")) {
    return null;
  }
  const clean = relativePath.split("#")[0].split("?")[0];
  const fromParts = String(fromFile || "").split("/");
  fromParts.pop();

  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      fromParts.pop();
    } else {
      fromParts.push(part);
    }
  }

  return fromParts.join("/");
}

function assetProxyUrl(req, { repoUrl, branch, file }) {
  const params = new URLSearchParams({ repoUrl, branch, file });
  return `${req.baseUrl}/github/asset?${params.toString()}`;
}

function rewriteHtmlAssets(req, html, { repoUrl, branch, file }) {
  return html.replace(/\b(src|href)=["']([^"']+)["']/gi, (match, attr, value) => {
    const resolved = resolveRelativePath(file, value);
    if (!resolved) return match;
    return `${attr}="${assetProxyUrl(req, { repoUrl, branch, file: resolved })}"`;
  });
}

async function fetchGitHubFile({ repoUrl, branch, file }) {
  const headers = { "User-Agent": "deuce-pages-importer" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(githubRawUrl({ repoUrl, branch, file }), { headers });
    if (response.ok) return response;
    if (![403, 404, 429].includes(response.status)) {
      throw new Error(`GitHub raw fetch failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.warn("GitHub raw fetch failed, trying contents API fallback:", error.message);
  }

  const { owner, repo } = normalizeRepoUrl(repoUrl);
  const encodedFile = String(file || "").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedFile}?ref=${encodeURIComponent(branch || "main")}`;
  const fallbackResponse = await fetch(contentsUrl, {
    headers: {
      ...headers,
      Accept: "application/vnd.github.raw"
    }
  });
  if (!fallbackResponse.ok) {
    throw new Error(`GitHub source fetch failed: ${fallbackResponse.status} ${fallbackResponse.statusText}. Check the repo visibility, branch, file path, and GITHUB_TOKEN.`);
  }
  return fallbackResponse;
}

importsRouter.post("/github/scan", requireAdmin, async (req, res) => {
  try {
    const scan = await scanGitHubRepository(req.body);
    res.json({ scan });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

importsRouter.get("/github/preview", async (req, res) => {
  try {
    const repoUrl = String(req.query.repoUrl || "");
    const branch = String(req.query.branch || "main");
    const file = String(req.query.file || "");
    if (classifyFile(file) !== "html") {
      res.status(400).send("Preview file must be HTML");
      return;
    }

    const response = await fetchGitHubFile({ repoUrl, branch, file });
    const html = await response.text();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(rewriteHtmlAssets(req, injectPreviewTurnstile(html), { repoUrl, branch, file }));
  } catch (error) {
    res.status(400).send(`<pre>${String(error.message || error)}</pre>`);
  }
});

importsRouter.get("/github/asset", async (req, res) => {
  try {
    const repoUrl = String(req.query.repoUrl || "");
    const branch = String(req.query.branch || "main");
    const file = String(req.query.file || "");
    const response = await fetchGitHubFile({ repoUrl, branch, file });
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentTypeFor(file));
    res.send(buffer);
  } catch (error) {
    res.status(404).send(String(error.message || error));
  }
});

importsRouter.post("/github/package", requireAdmin, async (req, res) => {
  try {
    const scan = await scanGitHubRepository(req.body);
    if (req.body.publish && !scan.review?.publishable) {
      res.status(400).json({
        error: "GitHub package is not publishable yet",
        scan,
        review: scan.review
      });
      return;
    }

    const packageData = {
      slug: scan.slug,
      name: scan.packageName,
      version: req.body.version || "v0.1",
      status: req.body.publish ? "published" : "draft",
      sourceType: "github",
      repoUrl: scan.repoUrl,
      billingPeriods: req.body.billingPeriods || { daily: 5, weekly: 25, biweekly: 45, monthly: 80 },
      screens: scan.screens.map((screen) => screen.name),
      assets: scan.assets,
      cssFiles: scan.cssFiles,
      designTokens: req.body.designTokens || { brand: "#7CFFB2", font: "Inter", radius: "8px" },
      packageManifest: {
        github: {
          owner: scan.owner,
          repo: scan.repo,
          branch: scan.branch,
          folder: scan.folder
        },
        files: scan.files,
        screens: scan.screens,
        scripts: scan.scripts,
        review: scan.review,
        importedAt: new Date().toISOString()
      }
    };

    const existing = await findPackage(scan.slug);
    const pagePackage = existing
      ? await updatePackage(existing.id, packageData)
      : await createPackage(packageData);
    const finalPackage = req.body.publish ? await publishPackage(pagePackage.id) : pagePackage;

    res.status(201).json({ package: withPreviewToken(finalPackage), scan });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
