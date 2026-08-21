import path from "node:path";
import { Router } from "express";
import { createPackage, findPackage, publishPackage, updatePackage } from "../repositories/appRepository.js";
import { requireAdmin } from "../middleware/auth.js";
import { classifyFile, githubRawUrl, normalizeRepoUrl, scanGitHubRepository } from "../services/githubImport.js";
import { withPreviewAvailability } from "../services/packagePreview.js";
import { injectPreviewTurnstile } from "../services/turnstile.js";
import { finalizeLocalImport, startLooseImport, startZipImport } from "../services/localImport.js";
import { objectStorageConfigured } from "../services/objectStorage.js";
import { validatePackageData } from "../services/packageValidation.js";
import {
  createGitHubPreviewTicket,
  normalizeGitHubFilePath,
  verifyGitHubPreviewTicket
} from "../services/githubPreviewAccess.js";

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
      billingPeriods: req.body.billingPeriods || { daily: 25, weekly: 50, biweekly: 100, monthly: 150 },
      screens: scan.screenManifest.screens.map((screen) => screen.buttonLabel),
      assets: scan.assets,
      cssFiles: scan.cssFiles,
      designTokens: req.body.designTokens || { brand: "#7CFFB2", font: "Inter", radius: "8px" },
      packageManifest: {
        ...scan.screenManifest,
        r2: { prefix: payload.prefix },
        files: scan.files,
        scripts: scan.scripts,
        review: scan.review,
        importedAt: new Date().toISOString()
      }
    };
    const validation = validatePackageData(packageData, { publishing: publish });
    if (!validation.valid) {
      res.status(422).json({ error: "Package validation failed", issues: validation.issues, warnings: validation.warnings, scan });
      return;
    }
    const existing = await findPackage(payload.slug);
    const pagePackage = existing
      ? await updatePackage(existing.id, validation.value)
      : await createPackage(validation.value);
    const finalPackage = publish ? await publishPackage(pagePackage.id) : pagePackage;
    res.status(201).json({ package: withPreviewAvailability(finalPackage), scan, files: files.length });
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
  const value = String(relativePath || "").trim();
  if (
    !value
    || /^(?:[a-z]+:)?\/\//i.test(value)
    || /^(?:data|mailto|tel):/i.test(value)
    || value.startsWith("#")
    || value.startsWith("/")
  ) {
    return null;
  }
  const clean = value.split("#")[0].split("?")[0];
  try {
    const sourceFile = normalizeGitHubFilePath(fromFile);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), clean));
    if (resolved.startsWith("../") || path.posix.isAbsolute(resolved)) return null;
    return normalizeGitHubFilePath(resolved);
  } catch {
    return null;
  }
}

function assetProxyUrl(req, access, file) {
  const ticket = createGitHubPreviewTicket({
    repoUrl: access.repoUrl,
    branch: access.branch,
    file,
    kind: "asset",
    userId: access.userId,
    expiresAt: access.expiresAt
  });
  const params = new URLSearchParams({ ticket });
  return `${req.baseUrl}/github/asset?${params.toString()}`;
}

function rewriteHtmlAssets(req, html, access) {
  return html.replace(/\b(src|href)=["']([^"']+)["']/gi, (match, attr, value) => {
    const resolved = resolveRelativePath(access.file, value);
    if (!resolved) return match;
    try {
      return `${attr}="${assetProxyUrl(req, access, resolved)}"`;
    } catch {
      return match;
    }
  });
}

async function fetchGitHubFile({ repoUrl, branch, file }) {
  const headers = {
    "User-Agent": "deuce-pages-importer",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(githubRawUrl({ repoUrl, branch, file }), { headers, signal: AbortSignal.timeout(10_000), redirect: "error" });
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
      Accept: "application/vnd.github.raw+json"
    },
    signal: AbortSignal.timeout(10_000),
    redirect: "error"
  });
  if (!fallbackResponse.ok) {
    throw new Error(`GitHub source fetch failed: ${fallbackResponse.status} ${fallbackResponse.statusText}. Check the repo visibility, branch, file path, and GITHUB_TOKEN.`);
  }
  return fallbackResponse;
}


const githubPreviewPageMaxBytes = 2 * 1024 * 1024;
const githubPreviewAssetMaxBytes = 10 * 1024 * 1024;

function previewLimitError(message) {
  const error = new Error(message);
  error.status = 413;
  return error;
}

async function readLimitedResponse(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw previewLimitError("GitHub preview file is too large");
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw previewLimitError("GitHub preview file is too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function setGitHubPreviewHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src https://challenges.cloudflare.com",
    "font-src 'self' data:",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "frame-src https://challenges.cloudflare.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'none'",
    "sandbox allow-scripts"
  ].join("; "));
}

function setGitHubAssetHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

function withGitHubPreviewTickets(scan, userId) {
  const previewTickets = {};
  for (const screen of scan.screens || []) {
    if (classifyFile(screen.file) !== "html") continue;
    previewTickets[screen.file] = createGitHubPreviewTicket({
      repoUrl: scan.repoUrl,
      branch: scan.branch,
      file: screen.file,
      kind: "page",
      userId
    });
  }
  return { ...scan, previewTickets };
}

function previewAccess(req, kind) {
  return verifyGitHubPreviewTicket(String(req.query.ticket || ""), kind);
}

function rejectPreviewAuthorization(res) {
  res.status(401).send("GitHub preview authorization required");
}
importsRouter.post("/github/scan", requireAdmin, async (req, res) => {
  try {
    const scan = await scanGitHubRepository(req.body);
    res.json({ scan: withGitHubPreviewTickets(scan, req.user.id) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

importsRouter.get("/github/preview", async (req, res) => {
  let access;
  try {
    access = previewAccess(req, "page");
  } catch {
    rejectPreviewAuthorization(res);
    return;
  }

  try {
    const response = await fetchGitHubFile(access);
    const html = (await readLimitedResponse(response, githubPreviewPageMaxBytes)).toString("utf8");
    setGitHubPreviewHeaders(res);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(rewriteHtmlAssets(req, injectPreviewTurnstile(html), access));
  } catch (error) {
    console.warn("GitHub preview failed:", error.message);
    res.status(error.status === 413 ? 413 : 400).send("GitHub preview unavailable");
  }
});

importsRouter.get("/github/asset", async (req, res) => {
  let access;
  try {
    access = previewAccess(req, "asset");
  } catch {
    rejectPreviewAuthorization(res);
    return;
  }

  try {
    const response = await fetchGitHubFile(access);
    const buffer = await readLimitedResponse(response, githubPreviewAssetMaxBytes);
    setGitHubAssetHeaders(res);
    res.setHeader("Content-Type", contentTypeFor(access.file));
    res.send(buffer);
  } catch (error) {
    console.warn("GitHub preview asset failed:", error.message);
    res.status(error.status === 413 ? 413 : 404).send("GitHub preview asset unavailable");
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
      billingPeriods: req.body.billingPeriods || { daily: 25, weekly: 50, biweekly: 100, monthly: 150 },
      screens: scan.screenManifest.screens.map((screen) => screen.buttonLabel),
      assets: scan.assets,
      cssFiles: scan.cssFiles,
      designTokens: req.body.designTokens || { brand: "#7CFFB2", font: "Inter", radius: "8px" },
      packageManifest: {
        ...scan.screenManifest,
        github: {
          owner: scan.owner,
          repo: scan.repo,
          branch: scan.branch,
          folder: scan.folder,
          mode: "live",
          lastSyncedCommitSha: scan.commitSha,
          lastSyncedTreeSha: scan.treeSha,
          lastSyncedAt: new Date().toISOString(),
          lastObservedCommitSha: scan.commitSha,
          lastObservedAt: new Date().toISOString(),
          committedAt: scan.committedAt,
          commitUrl: scan.commitUrl,
          health: {
            state: "healthy",
            reason: "Configured branch is healthy",
            checkedAt: new Date().toISOString(),
            commitSha: scan.commitSha
          }
        },
        files: scan.files,
        scripts: scan.scripts,
        review: scan.review,
        importedAt: new Date().toISOString()
      }
    };

    const validation = validatePackageData(packageData, { publishing: Boolean(req.body.publish) });
    if (!validation.valid) {
      res.status(422).json({ error: "Package validation failed", issues: validation.issues, warnings: validation.warnings, scan });
      return;
    }

    const existing = await findPackage(scan.slug);
    const pagePackage = existing
      ? await updatePackage(existing.id, validation.value)
      : await createPackage(validation.value);
    const finalPackage = req.body.publish ? await publishPackage(pagePackage.id) : pagePackage;
    const responseScan = withGitHubPreviewTickets(scan, req.user.id);

    res.status(201).json({ package: withPreviewAvailability(finalPackage), scan: responseScan });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
