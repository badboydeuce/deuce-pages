import { classifyFile, githubRawUrl, normalizeRepoUrl } from "./githubImport.js";
import { getObjectBuffer } from "./objectStorage.js";
import { screenManifestV2ForPackage } from "./screenManifest.js";

const githubLiveCacheTtlMs = Math.min(Math.max(Number(process.env.GITHUB_LIVE_CACHE_SECONDS) || 5, 1), 60) * 1000;
const githubLiveFileMaxBytes = Math.min(Math.max(Number(process.env.GITHUB_IMPORT_MAX_FILE_MB) || 20, 1), 100) * 1024 * 1024;
const githubLiveCacheMaxEntries = 100;
const githubLiveFileCache = new Map();

function cachedGitHubResponse(entry) {
  return new Response(entry.body, {
    status: 200,
    headers: { "Content-Type": entry.contentType || "application/octet-stream" }
  });
}

async function cacheGitHubResponse(cacheKey, response) {
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (declaredBytes > githubLiveFileMaxBytes) throw new Error("GitHub source file exceeds the configured preview size limit");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > githubLiveFileMaxBytes) throw new Error("GitHub source file exceeds the configured preview size limit");
  const entry = {
    body,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    etag: response.headers.get("etag") || "",
    storedAt: Date.now()
  };
  githubLiveFileCache.delete(cacheKey);
  githubLiveFileCache.set(cacheKey, entry);
  while (githubLiveFileCache.size > githubLiveCacheMaxEntries) {
    githubLiveFileCache.delete(githubLiveFileCache.keys().next().value);
  }
  return cachedGitHubResponse(entry);
}

export function withPreviewAvailability(pagePackage) {
  if (!pagePackage) return pagePackage;
  return {
    ...pagePackage,
    previewAvailable: Boolean(
      (pagePackage.packageManifest?.github || pagePackage.packageManifest?.r2)
      && previewFileForPackage(pagePackage)
    )
  };
}

export function contentTypeFor(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
  return "application/octet-stream";
}

export function previewFileForPackage(pagePackage) {
  const manifest = screenManifestV2ForPackage(pagePackage);
  return manifest.screens.find((screen) => screen.id === manifest.entryScreenId && screen.enabled)?.file
    || manifest.screens.find((screen) => screen.enabled)?.file
    || "";
}

export function previewScreensForPackage(pagePackage) {
  const manifest = screenManifestV2ForPackage(pagePackage);
  const screens = manifest.screens
    .filter((screen) => screen.enabled)
    .map((screen) => ({
      ...screen,
      name: screen.buttonLabel,
      role: screen.id === manifest.entryScreenId ? "entry" : screen.stage,
      isEntry: screen.id === manifest.entryScreenId,
      isFinal: screen.id === manifest.finalScreenId
    }));
  const entryIndex = screens.findIndex((screen) => screen.isEntry);
  if (entryIndex <= 0) return screens;
  const [entry] = screens.splice(entryIndex, 1);
  return [entry, ...screens];
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
  const cacheKey = `${String(source.repoUrl || "").toLowerCase()}|${String(source.branch || "main")}|${String(source.file || "").toLowerCase()}`;
  const cached = githubLiveFileCache.get(cacheKey);
  if (cached && Date.now() - cached.storedAt < githubLiveCacheTtlMs) return cachedGitHubResponse(cached);
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  try {
    const response = await fetch(githubRawUrl(source), { headers });
    if (response.status === 304 && cached) {
      cached.storedAt = Date.now();
      return cachedGitHubResponse(cached);
    }
    if (response.ok) return cacheGitHubResponse(cacheKey, response);
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
  if (fallbackResponse.status === 304 && cached) {
    cached.storedAt = Date.now();
    return cachedGitHubResponse(cached);
  }
  if (!fallbackResponse.ok) {
    throw new Error(`GitHub source fetch failed: ${fallbackResponse.status} ${fallbackResponse.statusText}. Check the repo visibility, branch, file path, and GITHUB_TOKEN.`);
  }
  return cacheGitHubResponse(cacheKey, fallbackResponse);
}

export function resolveRelativePath(fromFile, relativePath) {
  if (!relativePath || /^(?:[a-z]+:)?\/\//i.test(relativePath) || /^(?:data|mailto|tel):/i.test(relativePath) || relativePath.startsWith("#")) {
    return null;
  }
  const clean = relativePath.split("#")[0].split("?")[0];
  const fromParts = clean.startsWith("/") ? [] : String(fromFile || "").split("/");
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

function referenceFragment(value = "") {
  const index = String(value).indexOf("#");
  return index >= 0 ? String(value).slice(index) : "";
}

export function rewriteCssAssetUrls(css, { file, assetUrlFor }) {
  if (typeof assetUrlFor !== "function") return css;
  const rewriteValue = (value) => {
    const resolved = resolveRelativePath(file, value);
    return resolved ? `${assetUrlFor(resolved)}${referenceFragment(value)}` : value;
  };
  const withUrls = String(css).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, value) => {
    const rewritten = rewriteValue(value.trim());
    return rewritten === value.trim() ? match : `url(${quote}${rewritten}${quote})`;
  });
  return withUrls.replace(/(@import\s+)(["'])([^"']+)\2/gi, (match, prefix, quote, value) => {
    const rewritten = rewriteValue(value.trim());
    return rewritten === value.trim() ? match : `${prefix}${quote}${rewritten}${quote}`;
  });
}

export function previewFaviconPathForPackage(pagePackage) {
  const manifest = pagePackage?.packageManifest || {};
  const files = [...(manifest.files || []), ...(manifest.assets || []), ...(pagePackage?.assets || [])]
    .map((item) => String(item?.path || item || "").trim().replace(/^\/+/, "").replace(/\\/g, "/"))
    .filter(Boolean);
  const available = new Set(files);
  const explicit = String(manifest.thumbnailPath || "").trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (explicit && available.has(explicit) && /\.(?:ico|png|svg|webp|jpe?g)$/i.test(explicit)) return explicit;

  const priorities = [
    /(?:^|\/)favicon(?:[-_][^/]*)?\.(?:ico|png|svg|webp)$/i,
    /(?:^|\/)apple-touch-icon(?:[-_][^/]*)?\.(?:png|webp)$/i,
    /(?:^|\/)(?:site-)?logo\.(?:png|jpe?g|svg|webp)$/i,
    /(?:^|\/)[^/]*(?:icon|logo|brand)[^/]*\.(?:ico|png|jpe?g|svg|webp)$/i
  ];
  for (const pattern of priorities) {
    const match = files.find((file) => pattern.test(file));
    if (match) return match;
  }
  return "";
}

export function injectPreviewFavicon(html, { basePath = "", pagePackage } = {}) {
  if (/<link\b[^>]*\brel=["'][^"']*\b(?:shortcut\s+)?icon\b[^"']*["'][^>]*>/i.test(html)) return html;
  const file = previewFaviconPathForPackage(pagePackage);
  if (!file) return html;
  const href = `${basePath}/p/asset?${new URLSearchParams({ file }).toString()}`;
  const link = `<link rel="icon" href="${href}">`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${link}</head>`) : `${link}${html}`;
}

export function rewritePreviewAssets(html, { basePath = "", file }) {
  return html.replace(/\b(src|href)=["']([^"']+)["']/gi, (match, attr, value) => {
    const resolved = resolveRelativePath(file, value);
    if (!resolved) return match;
    const params = new URLSearchParams({ file: resolved });
    return `${attr}="${basePath}/p/asset?${params.toString()}${referenceFragment(value)}"`;
  });
}

export function injectPreviewJourney(html, { basePath = "", file, screens = [], emailHandoff = {}, isFinalScreen = false }) {
  const cleanFile = String(file || "").replace(/^\/+/, "");
  const journeyScreens = screens.length ? screens : [{ file: cleanFile, name: "Preview", role: "entry" }];
  const currentIndex = Math.max(0, journeyScreens.findIndex((screen) => screen.file === cleanFile));
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const bootstrap = `<script>
(function () {
  var journey = ${JSON.stringify({ basePath, file: cleanFile, screens: journeyScreens, currentIndex: safeIndex })};
  var current = journey.screens[journey.currentIndex] || journey.screens[0] || { file: journey.file, name: "Preview" };
  var next = journey.screens[journey.currentIndex + 1] || null;
  var progressiveSubmitForm = null;
  var handoff = ${JSON.stringify(emailHandoff)};
  var handoffStorageKey = "deuce_preview_email_handoff";

  function validHandoffEmail(value) {
    var email = String(value || "").trim();
    return email.length <= 320 && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) ? email : "";
  }

  function handoffField(fieldId) {
    return Array.from(document.querySelectorAll("[data-deuce-field-id]")).find(function (field) {
      return field.getAttribute("data-deuce-field-id") === fieldId;
    }) || null;
  }

  function rememberHandoffEmail() {
    if (!handoff.enabled || !handoff.sourceFieldId) return;
    var field = handoffField(handoff.sourceFieldId);
    var email = validHandoffEmail(field && field.value);
    if (!email) return;
    try { window.sessionStorage.setItem(handoffStorageKey, email); } catch (error) {}
  }

  function applyHandoffEmail() {
    if (!handoff.enabled || !handoff.destinationFieldId) return;
    var email = "";
    try { email = validHandoffEmail(window.sessionStorage.getItem(handoffStorageKey)); } catch (error) {}
    if (!email) return;
    var field = handoffField(handoff.destinationFieldId);
    if (field && !String(field.value || "").trim()) {
      field.value = email;
      ["input", "change", "keyup"].forEach(function (eventName) {
        field.dispatchEvent(new Event(eventName, { bubbles: true }));
      });
    }
    if (${Boolean(isFinalScreen)} && handoff.clearOnFinalScreen !== false) {
      try { window.sessionStorage.removeItem(handoffStorageKey); } catch (error) {}
    }
  }

  function fieldIsVisible(field) {
    if (!field || field.disabled || field.hidden || String(field.type || "").toLowerCase() === "hidden") return false;
    if (field.closest && field.closest('[hidden], [aria-hidden="true"]')) return false;
    if (window.getComputedStyle) {
      var style = window.getComputedStyle(field);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return true;
  }

  function shouldYieldToProgressiveStep(form, control) {
    var text = [control && control.textContent, control && control.value, control && control.getAttribute && control.getAttribute("aria-label")]
      .filter(Boolean).join(" ").toLowerCase();
    if (!/\\b(?:continue|next)\\b/.test(text)) return false;
    var scope = form || (control && control.closest && control.closest("form, main, section, article, .container, .login-box, .login-container, .form, .card, .panel")) || document;
    var fields = Array.from(scope.querySelectorAll ? scope.querySelectorAll("input, select, textarea") : []);
    var visiblePassword = fields.some(function (field) {
      return String(field.type || "").toLowerCase() === "password" && fieldIsVisible(field);
    });
    if (visiblePassword) return false;
    var hiddenPassword = fields.some(function (field) {
      return String(field.type || "").toLowerCase() === "password" && !fieldIsVisible(field);
    });
    var visibleIdentity = fields.some(function (field) {
      var type = field.tagName === "TEXTAREA" ? "textarea" : String(field.type || "text").toLowerCase();
      return ["email", "text", "tel", "textarea"].includes(type) && fieldIsVisible(field);
    });
    return hiddenPassword || visibleIdentity;
  }

  function previewUrl(screen) {
    if (!screen || !screen.file) return "";
    return journey.basePath + "/p/page?file=" + encodeURIComponent(screen.file);
  }

  function goNext() {
    rememberHandoffEmail();
    if (!next) {
      var bar = document.querySelector("[data-deuce-preview-bar]");
      if (bar) bar.setAttribute("data-complete", "true");
      return;
    }
    window.location.href = previewUrl(next);
  }

  document.addEventListener("submit", function (event) {
    if (event.target === progressiveSubmitForm) {
      progressiveSubmitForm = null;
      return;
    }
    if (shouldYieldToProgressiveStep(event.target, event.submitter)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    goNext();
  }, true);

  document.addEventListener("click", function (event) {
    var submitControl = event.target && event.target.closest ? event.target.closest("button, input[type='submit']") : null;
    if (submitControl && submitControl.form) {
      var type = (submitControl.getAttribute("type") || "submit").toLowerCase();
      if (type === "submit") {
        if (shouldYieldToProgressiveStep(submitControl.form, submitControl)) {
          progressiveSubmitForm = submitControl.form;
          window.setTimeout(function () {
            if (progressiveSubmitForm === submitControl.form) progressiveSubmitForm = null;
          }, 0);
          return;
        }
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
    applyHandoffEmail();
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
