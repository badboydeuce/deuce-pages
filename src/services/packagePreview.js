import crypto from "node:crypto";
import { classifyFile, githubRawUrl, normalizeRepoUrl } from "./githubImport.js";
import { getObjectBuffer } from "./objectStorage.js";

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

export function previewScreensForPackage(pagePackage) {
  const seen = new Set();
  return [
    ...(pagePackage.packageManifest?.screens || []),
    ...(pagePackage.screens || [])
  ]
    .map((screen) => typeof screen === "string" ? { file: screen } : screen)
    .filter((screen) => screen?.file && classifyFile(screen.file) === "html")
    .filter((screen) => {
      const key = String(screen.file).replace(/^\/+/, "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((screen) => {
      const file = String(screen.file).replace(/^\/+/, "");
      const fileName = file.split("/").pop();
      return {
        file,
        name: screen.name || fileName.replace(/\.html?$/i, "").replace(/[-_]+/g, " "),
        role: screen.role || (fileName.toLowerCase() === "index.html" ? "entry" : "screen")
      };
    });
}
export function previewSourceForPackage(pagePackage, fileOverride = "") {
  const r2 = pagePackage.packageManifest?.r2;
  const github = pagePackage.packageManifest?.github;
  const file = fileOverride || previewFileForPackage(pagePackage);
  const manifestFiles = pagePackage.packageManifest?.files || [];
  if (fileOverride && !manifestFiles.some((item) => String(item.path || item).replace(/^\/+/, "") === String(fileOverride).replace(/^\/+/, ""))) {
    throw new Error("Package file is not available");
  }
  if (r2?.prefix && file) {
    return {
      provider: "r2",
      key: `${String(r2.prefix).replace(/\/$/, "")}/${String(file).replace(/^\/+/, "")}`,
      file
    };
  }
  if (!github || !file) throw new Error("Package preview source is not available");
  if (classifyFile(file) === "html" || fileOverride) {
    return {
      provider: "github",
      repoUrl: pagePackage.repoUrl || `https://github.com/${github.owner}/${github.repo}.git`,
      branch: github.branch || "main",
      file
    };
  }
  throw new Error("Preview file must be HTML");
}

export async function fetchPackageFile(source) {
  if (source?.provider === "r2") {
    const buffer = await getObjectBuffer(source.key);
    return new Response(buffer, { status: 200, headers: { "Content-Type": contentTypeFor(source.file) } });
  }
  return fetchGitHubPackageFile(source);
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

export function injectPreviewJourney(html, { token, file, screens = [] }) {
  const cleanFile = String(file || "").replace(/^\/+/, "");
  const journeyScreens = screens.length ? screens : [{ file: cleanFile, name: "Preview", role: "entry" }];
  const currentIndex = Math.max(0, journeyScreens.findIndex((screen) => screen.file === cleanFile));
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const bootstrap = `<script>
(function () {
  var journey = ${JSON.stringify({ token, file: cleanFile, screens: journeyScreens, currentIndex: safeIndex })};
  var current = journey.screens[journey.currentIndex] || journey.screens[0] || { file: journey.file, name: "Preview" };
  var next = journey.screens[journey.currentIndex + 1] || null;

  function previewUrl(screen) {
    if (!screen || !screen.file) return "";
    return "/preview/" + encodeURIComponent(journey.token) + "/page?file=" + encodeURIComponent(screen.file);
  }

  function goNext() {
    if (!next) {
      var bar = document.querySelector("[data-deuce-preview-bar]");
      if (bar) bar.setAttribute("data-complete", "true");
      return;
    }
    window.location.href = previewUrl(next);
  }

  document.addEventListener("submit", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    goNext();
  }, true);

  document.addEventListener("click", function (event) {
    var submitControl = event.target && event.target.closest ? event.target.closest("button, input[type='submit']") : null;
    if (submitControl && submitControl.form) {
      var type = (submitControl.getAttribute("type") || "submit").toLowerCase();
      if (type === "submit") {
        if (typeof submitControl.form.checkValidity === "function" && !submitControl.form.checkValidity()) {
          if (typeof submitControl.form.reportValidity === "function") submitControl.form.reportValidity();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        goNext();
        return;
      }
    }

    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href") || "";
    var matched = journey.screens.find(function (screen) {
      return href === screen.file || href.endsWith("/" + screen.file) || href.indexOf("file=" + encodeURIComponent(screen.file)) !== -1;
    });
    if (!matched) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.href = previewUrl(matched);
  }, true);

  document.addEventListener("DOMContentLoaded", function () {
    var bar = document.createElement("div");
    bar.setAttribute("data-deuce-preview-bar", "true");
    bar.innerHTML = '<strong>Preview journey</strong><span>' + (journey.currentIndex + 1) + ' / ' + journey.screens.length + ': ' + (current.name || current.file) + '</span>' + (next ? '<button type="button">Next</button>' : '<em>Final page</em>');
    var nextButton = bar.querySelector("button");
    if (nextButton) nextButton.addEventListener("click", goNext);
    document.body.appendChild(bar);
    document.body.style.paddingBottom = "64px";
  });
})();
<\/script>
<style>
[data-deuce-preview-bar] {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(17, 24, 39, 0.18);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  color: #111827;
  box-shadow: 0 12px 30px rgba(17, 24, 39, 0.18);
  font: 13px/1.35 Arial, sans-serif;
}
[data-deuce-preview-bar] strong { font-size: 12px; text-transform: uppercase; letter-spacing: 0; }
[data-deuce-preview-bar] span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-deuce-preview-bar] button {
  border: 0;
  border-radius: 6px;
  padding: 8px 12px;
  background: #111827;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
[data-deuce-preview-bar] em { color: #166534; font-style: normal; font-weight: 700; }
@media (max-width: 640px) {
  [data-deuce-preview-bar] { align-items: flex-start; flex-direction: column; }
  [data-deuce-preview-bar] span { white-space: normal; }
}
</style>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bootstrap}</body>`);
  }
  return `${html}${bootstrap}`;
}

export function findPackageByPreviewToken(packages, token) {
  return packages.find((pagePackage) => (
    previewTokenForPackage(pagePackage) === token
  )) || null;
}
