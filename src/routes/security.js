import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { pageSubscriptionState, resolveUserPageSubscription, saveTrafficEvent } from "../repositories/appRepository.js";
import { turnstileSecretFor, verifyTurnstileToken } from "../services/turnstile.js";
import { securityDecision } from "../services/securityRules.js";

export const securityRouter = Router();
const accessDeniedMessage = "ACCESS DENIED";

const securityPayloadLimit = 16 * 1024;

function requestIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

function normalizeHost(value = "") {
  return String(value).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
}

function relaySecretFor(page) {
  return page?.hostingConfig?.relaySecret || page?.generatedFile?.relaySecret || "";
}

function allowedHostsFor(page) {
  return Array.from(new Set([page?.domain, page?.hostingConfig?.domain].map(normalizeHost).filter(Boolean)));
}

function safeCompare(value, expected) {
  const a = Buffer.from(String(value || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function payloadTooLarge(req, res) {
  const size = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  if (size <= securityPayloadLimit) return false;
  res.status(413).json({ allowed: false, reason: "Runtime payload too large", limit: securityPayloadLimit });
  return true;
}

async function securityContext(req, res) {
  const userPageId = String(req.body.userPageId || req.body.pageId || "").trim();
  if (!userPageId) {
    res.status(400).json({ allowed: false, reason: accessDeniedMessage });
    return null;
  }
  const userPage = await resolveUserPageSubscription(userPageId);
  if (!userPage) {
    res.status(404).json({ allowed: false, reason: accessDeniedMessage });
    return null;
  }

  const expectedSecret = relaySecretFor(userPage);
  if (expectedSecret && !safeCompare(req.headers["x-deuce-relay-secret"], expectedSecret)) {
    res.status(403).json({ allowed: false, reason: accessDeniedMessage });
    return null;
  }

  const hostname = normalizeHost(req.headers["x-deuce-client-host"] || req.body.hostname || req.headers.origin || req.headers.host);
  const allowedHosts = allowedHostsFor(userPage);
  if (allowedHosts.length && (!hostname || !allowedHosts.includes(hostname))) {
    res.status(403).json({ allowed: false, reason: accessDeniedMessage });
    return null;
  }

  const subscription = pageSubscriptionState(userPage);
  if (subscription.blocked) {
    res.status(402).json({ allowed: false, reason: accessDeniedMessage });
    return null;
  }

  return { userPage, hostname };
}

securityRouter.post("/check", async (req, res) => {
  try {
    if (payloadTooLarge(req, res)) return;
    const context = await securityContext(req, res);
    if (!context) return;
    const { userPage, hostname } = context;
    const ip = requestIp(req);

    const decision = securityDecision(userPage, ip, req.headers["user-agent"], req);

    const event = await saveTrafficEvent({
      userPageId: userPage.id,
      pageId: userPage.slug,
      sessionId: req.body.sessionId,
      event: req.body.event || "security_check",
      hostname,
      result: decision.allowed ? "allowed" : "blocked",
      reason: decision.allowed ? "Passed rules" : decision.reason,
      metadata: {
        deviceType: decision.deviceType || null,
        proxyType: decision.proxyType || null
      }
    }, ip, req.headers["user-agent"]);

    if (!decision.allowed) return res.status(403).json({ allowed: false, reason: accessDeniedMessage });

    res.json({
      allowed: true,
      captchaRequired: Boolean(userPage.securityConfig?.captcha),
      deviceType: decision.deviceType || null,
      proxyType: decision.proxyType || null,
      event
    });
  } catch (error) {
    res.status(400).json({ allowed: false, reason: error.message });
  }
});

securityRouter.post("/turnstile/verify", async (req, res) => {
  try {
    if (payloadTooLarge(req, res)) return;
    const context = await securityContext(req, res);
    if (!context) return;
    const { userPage, hostname } = context;

    const security = userPage.securityConfig || {};
    if (!security.captcha) {
      res.json({ verified: true, skipped: true });
      return;
    }

    const result = await verifyTurnstileToken({
      token: req.body.token,
      secret: turnstileSecretFor(security),
      remoteIp: requestIp(req)
    });

    if (!result.success) {
      res.status(403).json({ verified: false, reason: accessDeniedMessage });
      return;
    }

    await saveTrafficEvent({
      userPageId: userPage.id,
      pageId: userPage.slug,
      sessionId: req.body.sessionId,
      event: "turnstile_verified",
      hostname,
      result: "allowed",
      reason: "Turnstile passed"
    }, requestIp(req), req.headers["user-agent"]);

    res.json({ verified: true });
  } catch (error) {
    res.status(400).json({ verified: false, reason: accessDeniedMessage });
  }
});
