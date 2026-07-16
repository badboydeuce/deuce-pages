import { Router } from "express";
import { findUserPage, saveTrafficEvent } from "../repositories/appRepository.js";
import { turnstileSecretFor, verifyTurnstileToken } from "../services/turnstile.js";
import { deviceBlocked } from "../services/deviceRules.js";

export const securityRouter = Router();

function requestIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

securityRouter.post("/check", async (req, res) => {
  try {
    const userPage = await findUserPage(req.body.userPageId || req.body.pageId);
    const ip = requestIp(req);
    const hostname = req.body.hostname || "";

    if (!userPage) {
      return res.status(404).json({ allowed: false, reason: "Page config not found" });
    }

    const security = userPage.securityConfig || {};
    const allowedDomains = security.domains || [];
    const localHosts = ["", "localhost", "127.0.0.1"];
    const banned = (security.bannedIps || []).includes(ip) || (security.bannedIps || []).includes(req.body.ip);
    const device = deviceBlocked(security, req.headers["user-agent"]);
    const domainAllowed = !allowedDomains.length || allowedDomains.includes(hostname) || localHosts.includes(hostname);
    const blocked = banned || device.blocked || !domainAllowed;

    const event = await saveTrafficEvent({
      userPageId: userPage.id,
      pageId: userPage.slug,
      sessionId: req.body.sessionId,
      event: req.body.event || "security_check",
      hostname,
      result: blocked ? "blocked" : "allowed",
      reason: banned ? "Banned IP" : device.blocked ? `${device.deviceType} devices are blocked` : !domainAllowed ? "Domain not allowed" : "Passed rules",
      metadata: { deviceType: device.deviceType }
    }, ip, req.headers["user-agent"]);

    if (banned) return res.status(403).json({ allowed: false, reason: "IP address is banned" });
    if (device.blocked) return res.status(403).json({ allowed: false, reason: `${device.deviceType} devices are blocked`, deviceType: device.deviceType });
    if (!domainAllowed) return res.status(403).json({ allowed: false, reason: "Domain is not allowed" });

    res.json({ allowed: true, captchaRequired: Boolean(security.captcha), deviceType: device.deviceType, event });
  } catch (error) {
    res.status(400).json({ allowed: false, reason: error.message });
  }
});

securityRouter.post("/turnstile/verify", async (req, res) => {
  try {
    const userPage = await findUserPage(req.body.userPageId || req.body.pageId);
    if (!userPage) {
      res.status(404).json({ verified: false, reason: "Page config not found" });
      return;
    }

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
      res.status(403).json({ verified: false, reason: result.error || "Turnstile verification failed" });
      return;
    }

    await saveTrafficEvent({
      userPageId: userPage.id,
      pageId: userPage.slug,
      sessionId: req.body.sessionId,
      event: "turnstile_verified",
      hostname: req.body.hostname || "",
      result: "allowed",
      reason: "Turnstile passed"
    }, requestIp(req), req.headers["user-agent"]);

    res.json({ verified: true });
  } catch (error) {
    res.status(400).json({ verified: false, reason: error.message });
  }
});
