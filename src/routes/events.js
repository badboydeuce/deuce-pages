import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import {
  pageSubscriptionState,
  resolveUserPageSubscription,
  savePageResult,
  saveTrafficEvent
} from "../repositories/appRepository.js";

export const eventsRouter = Router();
const pageExpiredMessage = "Page Expired Renew to continue using";

const legacyPayloadLimits = {
  traffic: 24 * 1024,
  result: 96 * 1024
};

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

function payloadTooLarge(req, res, limit) {
  const size = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  if (size <= limit) return false;
  res.status(413).json({ error: "Runtime payload too large", limit });
  return true;
}

async function legacyRuntimeContext(req, res) {
  const userPageId = String(req.body?.userPageId || req.body?.pageId || "").trim();
  if (!userPageId) {
    res.status(400).json({ error: "Runtime page id required" });
    return null;
  }
  const page = await resolveUserPageSubscription(userPageId);
  if (!page) {
    res.status(404).json({ error: "Runtime page not found" });
    return null;
  }

  const expectedSecret = relaySecretFor(page);
  if (expectedSecret && !safeCompare(req.headers["x-deuce-relay-secret"], expectedSecret)) {
    res.status(403).json({ error: "Relay secret rejected" });
    return null;
  }

  const host = normalizeHost(req.headers["x-deuce-client-host"] || req.body?.hostname || req.headers.origin || req.headers.host);
  const allowedHosts = allowedHostsFor(page);
  if (allowedHosts.length && (!host || !allowedHosts.includes(host))) {
    res.status(403).json({ error: "Domain not authorized", host });
    return null;
  }

  const subscription = pageSubscriptionState(page);
  if (subscription.blocked) {
    res.status(402).json({ error: pageExpiredMessage, reason: pageExpiredMessage });
    return null;
  }
  return { page, host };
}

eventsRouter.post("/page-traffic", async (req, res) => {
  try {
    if (payloadTooLarge(req, res, legacyPayloadLimits.traffic)) return;
    const context = await legacyRuntimeContext(req, res);
    if (!context) return;
    const event = await saveTrafficEvent({
      ...req.body,
      userPageId: context.page.id,
      pageId: context.page.slug,
      hostname: context.host || req.body?.hostname
    }, requestIp(req), req.headers["user-agent"]);
    res.status(201).json({ event });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

eventsRouter.post("/page-results", async (req, res) => {
  try {
    if (payloadTooLarge(req, res, legacyPayloadLimits.result)) return;
    const context = await legacyRuntimeContext(req, res);
    if (!context) return;
    const result = await savePageResult({
      ...req.body,
      userPageId: context.page.id,
      pageId: context.page.slug,
      pageName: context.page.name,
      hostname: context.host || req.body?.hostname
    }, requestIp(req), req.headers["user-agent"]);
    res.status(201).json({ result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
