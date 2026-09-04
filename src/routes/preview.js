import { Router } from "express";
import {
  claimPackagePreviewTicket,
  findPackage,
  getPackagePreviewAccess
} from "../repositories/appRepository.js";
import {
  contentTypeFor,
  fetchPackageFile,
  injectPreviewFavicon,
  injectPreviewJourney,
  previewSourceForPackage,
  previewScreensForPackage,
  rewritePreviewAssets
} from "../services/packagePreview.js";
import { classifyFile } from "../services/githubImport.js";
import { previewRouteBase } from "../services/appHosts.js";
import {
  clearPreviewSessionCookie,
  readPreviewSessionToken,
  setPreviewSessionCookie
} from "../services/sessionCookie.js";
import { inferRedirectFile, injectPreviewTurnstile, isCaptchaGatePage } from "../services/turnstile.js";

export const previewRouter = Router();

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
}

async function requirePreviewSession(req, res, next) {
  try {
    const access = await getPackagePreviewAccess(readPreviewSessionToken(req));
    if (!access) {
      clearPreviewSessionCookie(res);
      noStore(res);
      res.status(401).type("text/plain").send("Preview session required");
      return;
    }
    const pagePackage = await findPackage(access.packageId);
    if (!pagePackage || pagePackage.version !== access.packageVersion) {
      clearPreviewSessionCookie(res);
      noStore(res);
      res.status(410).type("text/plain").send("Preview session expired");
      return;
    }
    req.previewAccess = access;
    req.previewPackage = pagePackage;
    next();
  } catch (error) {
    next(error);
  }
}

async function renderPreviewHtml(req, res, file) {
  const pagePackage = req.previewPackage;
  const source = previewSourceForPackage(pagePackage, file);
  if (classifyFile(source.file) !== "html") {
    res.status(400).type("text/plain").send("Preview file must be HTML");
    return;
  }

  const response = await fetchPackageFile(source);
  const html = await response.text();
  const basePath = previewRouteBase(req);
  if (!file && isCaptchaGatePage(html)) {
    const nextFile = inferRedirectFile(html);
    res.redirect(302, basePath + "/p/page?file=" + encodeURIComponent(nextFile));
    return;
  }

  noStore(res);
  res.type("html");
  const screens = previewScreensForPackage(pagePackage);
  const turnstileHtml = injectPreviewTurnstile(html, { basePath });
  const previewHtml = rewritePreviewAssets(turnstileHtml, { basePath, file: source.file });
  const brandedPreviewHtml = injectPreviewFavicon(previewHtml, { basePath, pagePackage });
  res.send(injectPreviewJourney(brandedPreviewHtml, { basePath, file: source.file, screens }));
}

previewRouter.get("/session/:ticket", async (req, res) => {
  try {
    const session = await claimPackagePreviewTicket(req.params.ticket);
    setPreviewSessionCookie(res, session);
    noStore(res);
    res.redirect(303, previewRouteBase(req) + "/p");
  } catch {
    clearPreviewSessionCookie(res);
    noStore(res);
    res.status(401).type("text/plain").send("Preview link is invalid, expired, or already used");
  }
});

previewRouter.use("/p", requirePreviewSession);

previewRouter.get("/p/asset", async (req, res) => {
  try {
    const file = String(req.query.file || "");
    if (!file) {
      res.status(400).type("text/plain").send("Asset file is required");
      return;
    }

    const source = previewSourceForPackage(req.previewPackage, file);
    const response = await fetchPackageFile(source);
    const buffer = Buffer.from(await response.arrayBuffer());
    noStore(res);
    res.setHeader("Content-Type", contentTypeFor(file));
    res.send(buffer);
  } catch {
    noStore(res);
    res.status(404).type("text/plain").send("Preview asset not found");
  }
});

previewRouter.get("/p/page", async (req, res) => {
  const file = String(req.query.file || "");
  if (!file) {
    res.status(400).type("text/plain").send("Preview page file is required");
    return;
  }
  try {
    await renderPreviewHtml(req, res, file);
  } catch {
    noStore(res);
    res.status(400).type("text/plain").send("Preview page is unavailable");
  }
});

previewRouter.get("/p", async (req, res) => {
  try {
    await renderPreviewHtml(req, res);
  } catch {
    noStore(res);
    res.status(400).type("text/plain").send("Preview page is unavailable");
  }
});
