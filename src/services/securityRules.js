import { deviceBlocked } from "./deviceRules.js";

const reputationCache = new Map();
const reputationTtlMs = 10 * 60 * 1000;
const reputationTimeoutMs = 1200;

function headerValue(req, name) {
  return String(req?.headers?.[name] || "").trim();
}

function isPublicIp(ip = "") {
  const value = String(ip || "").replace(/^::ffff:/, "").trim();
  if (!value || value === "unknown" || value === "::1" || value === "127.0.0.1") return false;
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function normalizeReputation(data = {}) {
  const security = data.security || {};
  return {
    vpn: Boolean(security.vpn),
    proxy: Boolean(security.proxy || security.relay),
    tor: Boolean(security.tor),
    hosting: Boolean(security.hosting),
    anonymous: Boolean(security.anonymous || security.vpn || security.proxy || security.tor || security.relay),
    provider: "ipwho.is"
  };
}

async function ipReputation(ip) {
  if (process.env.IP_REPUTATION_DISABLED === "true" || !isPublicIp(ip)) return null;
  const cached = reputationCache.get(ip);
  if (cached && Date.now() - cached.at < reputationTtlMs) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), reputationTimeoutMs);
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?security=1`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    const value = response.ok && data.success !== false ? normalizeReputation(data) : null;
    reputationCache.set(ip, { at: Date.now(), value });
    return value;
  } catch (error) {
    reputationCache.set(ip, { at: Date.now(), value: null });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function proxySecurityDecision(security = {}, req = null, ip = "") {
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

  if (rules.blockVpnProxies || rules.blockTor || rules.blockHostingProviders) {
    const reputation = await ipReputation(ip);
    if (reputation) {
      if (rules.blockTor && reputation.tor) {
        return { blocked: true, proxyType: "tor", reason: "Tor traffic is blocked", reputation };
      }
      if (rules.blockVpnProxies && (reputation.vpn || reputation.proxy || reputation.anonymous)) {
        return { blocked: true, proxyType: reputation.vpn ? "vpn" : "proxy", reason: "VPN or proxy traffic is blocked", reputation };
      }
      if (rules.blockHostingProviders && reputation.hosting) {
        return { blocked: true, proxyType: "hosting", reason: "Hosting provider traffic is blocked", reputation };
      }
      return { blocked: false, proxyType: null, reputation };
    }
  }
  return { blocked: false, proxyType: null };
}

export async function securityDecision(page, ip, userAgent = "", req = null) {
  const security = page.securityConfig || {};
  const bannedIps = security.bannedIps || [];
  const whitelistIps = security.whitelistIps || [];
  if (whitelistIps.includes(ip)) return { allowed: true, reason: "IP whitelisted" };
  if (bannedIps.includes(ip)) return { allowed: false, reason: "IP blocked by page security rules" };
  const proxy = await proxySecurityDecision(security, req, ip);
  if (proxy.blocked) return { allowed: false, reason: proxy.reason, proxyType: proxy.proxyType, reputation: proxy.reputation || null };
  const device = deviceBlocked(security, userAgent);
  if (device.blocked) return { allowed: false, reason: `${device.deviceType} devices are blocked`, deviceType: device.deviceType, proxyType: proxy.proxyType, reputation: proxy.reputation || null };
  if (page.status && page.status !== "active") return { allowed: false, reason: "Page subscription is not active", deviceType: device.deviceType, proxyType: proxy.proxyType, reputation: proxy.reputation || null };
  return { allowed: true, reason: "Allowed", deviceType: device.deviceType, proxyType: proxy.proxyType, reputation: proxy.reputation || null };
}
