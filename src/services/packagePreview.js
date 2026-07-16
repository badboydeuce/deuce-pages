import crypto from "node:crypto";
import { classifyFile, githubRawUrl, normalizeRepoUrl } from "./githubImport.js";

function previewSecret() {
  return process.env.PREVIEW_TOKEN_SECRET || process.env.JWT_SECRET || "deuce-pages-local-preview-secret";
}

export function previewTokenForPackage(pagePackage) {
  const versionKey = pagePackage.updatedAt || pagePackage.publishedAt || pagePackage.version || "v0";
  const material = `${pagePackage.id}:${pagePackage.slug}:${versionKey}`;
  const digest = crypto.createHmac("sha256", previewSecret()).update(material).digest("hex").slice(0, 18);
  return `tk_${digest}`;
}

export function withPreviewToken(pagePackage) {
  if (!pagePackage) return pagePackage;
  return {
    ...pagePackage,
    previewToken: previewTokenForPackage(pagePackage)
  };
}

export function contentTypeFor(filePath) {
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

export function previewFileForPackage(pagePackage) {
  const screens = pagePackage.packageManifest?.screens || [];
  return screens.find((screen) => screen.role === "entry")?.file || screens[0]?.file || "";
}

export function previewSourceForPackage(pagePackage, fileOverride = "") {
  const github = pagePackage.packageManifest?.github;
  const file = fileOverride || previewFileForPackage(pagePackage);
  if (!github || !file) throw new Error("Package preview source is not available");
  if (classifyFile(file) === "html" || fileOverride) {
    return {
      repoUrl: pagePackage.repoUrl || `https://github.com/${github.owner}/${github.repo}.git`,
      branch: github.branch || "main",
      file
    };
  }
  throw new Error("Preview file must be HTML");
}

export async function fetchGitHubPackageFile(source) {
  const headers = { "User-Agent": "deuce-pages-preview" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(githubRawUrl(source), { headers });
    if (response.ok) return response;
    if (![403, 404, 429].includes(response.status)) {
      throw new Error(`GitHub raw fetch failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.warn("GitHub raw fetch failed, trying contents API fallback:", error.message);
  }

  const { owner, repo } = normalizeRepoUrl(source.repoUrl);
  const encodedFile = String(source.file || "").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedFile}?ref=${encodeURIComponent(source.branch || "main")}`;
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

export function resolveRelativePath(fromFile, relativePath) {
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

export function rewritePreviewAssets(html, { token, file }) {
  return html.replace(/\b(src|href)=["']([^"']+)["']/gi, (match, attr, value) => {
    const resolved = resolveRelativePath(file, value);
    if (!resolved) return match;
    const params = new URLSearchParams({ file: resolved });
    return `${attr}="/preview/${encodeURIComponent(token)}/asset?${params.toString()}"`;
  });
}

export function findPackageByPreviewToken(packages, token) {
  return packages.find((pagePackage) => (
    previewTokenForPackage(pagePackage) === token
  )) || null;
}
