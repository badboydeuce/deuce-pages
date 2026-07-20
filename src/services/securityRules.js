import { deviceBlocked } from "./deviceRules.js";

const reputationCache = new Map();
const reputationSuccessTtlMs = 10 * 60 * 1000;
const reputationFailureTtlMs = 20 * 1000;
const reputationTimeoutMs = Math.min(Math.max(Number(process.env.IP_REPUTATION_TIMEOUT_MS) || 1200, 300), 5000);

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

function normalizeReputation(data = {}, provider = "ipwho.is") {
  const security = data.security || data;
  return {
    vpn: Boolean(security.vpn),
    proxy: Boolean(security.proxy || security.relay),
    tor: Boolean(security.tor),
    hosting: Boolean(security.hosting || security.datacenter),
    anonymous: Boolean(security.anonymous || security.vpn || security.proxy || security.tor || security.relay),
    provider
  };
}

function publicReputationStatus(result, cacheHit = false) {
  return {
    available: Boolean(result.available),
    provider: result.provider || null,
    reason: result.reason || null,
    latencyMs: Number(result.latencyMs || 0),
    cacheHit: Boolean(cacheHit)
  };
}

async function fetchReputation(url, ip, provider, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), reputationTimeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url.replace("{ip}", encodeURIComponent(ip)), {
      signal: controller.signal,
      headers: { Accept: "application/json", ...headers }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      return { available: false, provider, reason: `http_${response.status}`, latencyMs: Date.now() - startedAt };
    }
    return { available: true, provider, value: normalizeReputation(data, provider), latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      available: false,
      provider,
      reason: error?.name === "AbortError" ? "timeout" : "connection_error",
      latencyMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function ipReputation(ip) {
  if (process.env.IP_REPUTATION_DISABLED === "true") {
    return { available: false, provider: null, reason: "disabled", latencyMs: 0 };
  }
  if (!isPublicIp(ip)) {
    return { available: false, provider: null, reason: "non_public_ip", latencyMs: 0 };
  }
  const cached = reputationCache.get(ip);
  if (cached && Date.now() - cached.at < cached.ttl) {
    return { ...cached.result, status: publicReputationStatus(cached.result, true) };
  }

  let result = await fetchReputation(`https://ipwho.is/{ip}?security=1`, ip, "ipwho.is");
  const fallbackUrl = String(process.env.IP_REPUTATION_FALLBACK_URL || "").trim();
  if (!result.available && fallbackUrl) {
    const fallbackToken = String(process.env.IP_REPUTATION_FALLBACK_TOKEN || "").trim();
    result = await fetchReputation(
      fallbackUrl,
      ip,
      "fallback",
      fallbackToken ? { Authorization: `Bearer ${fallbackToken}` } : {}
    );
  }
  reputationCache.set(ip, { at: Date.now(), ttl: result.available ? reputationSuccessTtlMs : reputationFailureTtlMs, result });
  return { ...result, status: publicReputationStatus(result, false) };
}

function failureMode(rules = {}) {
  const mode = String(rules.reputationFailureMode || "challenge").toLowerCase();
  return ["allow", "challenge", "block"].includes(mode) ? mode : "challenge";
}

function hasTurnstileSiteKey(security = {}) {
  return Boolean(security.turnstile?.siteKey || security.turnstileSiteKey);
}

export async function proxySecurityDecision(security = {}, req = null, ip = "") {
  const rules = security.vpnProxyRules || {};
  const trustedRelay = Boolean(req?.deuceRelayTrusted);
  const cfCountry = trustedRelay ? headerValue(req, "cf-ipcountry").toUpperCase() : "";
  const explicitProxySignal = trustedRelay && [
    "x-anonymous-ip",
    "x-vpn",
    "x-proxy-id",
    "x-proxy-type",
    "x-tor-exit-node"
  ].some((name) => Boolean(headerValue(req, name)));
  const reputationType = trustedRelay ? headerValue(req, "x-deuce-ip-type").toLowerCase() : "";
  const reputationRisk = trustedRelay ? headerValue(req, "x-deuce-ip-risk").toLowerCase() : "";

  if (rules.blockTor && (cfCountry === "T1" || reputationType.includes("tor"))) {
    return { blocked: true, challengeRequired: false, proxyType: "tor", reason: "Tor traffic is blocked", reputationStatus: { available: true, provider: "trusted_relay", reason: null, latencyMs: 0, cacheHit: false } };
  }
  if (rules.blockVpnProxies && (explicitProxySignal || reputationType.includes("vpn") || reputationType.includes("proxy") || reputationRisk === "anonymous")) {
    return { blocked: true, challengeRequired: false, proxyType: "proxy", reason: "VPN or proxy traffic is blocked", reputationStatus: { available: true, provider: "trusted_relay", reason: null, latencyMs: 0, cacheHit: false } };
  }
  if (rules.blockHostingProviders && (reputationType.includes("hosting") || reputationType.includes("datacenter") || reputationType.includes("server"))) {
    return { blocked: true, challengeRequired: false, proxyType: "hosting", reason: "Hosting provider traffic is blocked", reputationStatus: { available: true, provider: "trusted_relay", reason: null, latencyMs: 0, cacheHit: false } };
  }

  if (rules.blockVpnProxies || rules.blockTor || rules.blockHostingProviders) {
    const reputation = await ipReputation(ip);
    if (reputation.available) {
      if (rules.blockTor && reputation.value.tor) return { blocked: true, challengeRequired: false, proxyType: "tor", reason: "Tor traffic is blocked", reputation: reputation.value, reputationStatus: reputation.status };
      if (rules.blockVpnProxies && (reputation.value.vpn || reputation.value.proxy || reputation.value.anonymous)) return { blocked: true, challengeRequired: false, proxyType: reputation.value.vpn ? "vpn" : "proxy", reason: "VPN or proxy traffic is blocked", reputation: reputation.value, reputationStatus: reputation.status };
      if (rules.blockHostingProviders && reputation.value.hosting) return { blocked: true, challengeRequired: false, proxyType: "hosting", reason: "Hosting provider traffic is blocked", reputation: reputation.value, reputationStatus: reputation.status };
      return { blocked: false, challengeRequired: false, proxyType: null, reputation: reputation.value, reputationStatus: reputation.status };
    }

    const mode = failureMode(rules);
    if (mode === "block") return { blocked: true, challengeRequired: false, proxyType: null, reason: "IP reputation is unavailable", reputationStatus: reputation.status };
    if (mode === "challenge") {
      if (!hasTurnstileSiteKey(security)) return { blocked: true, challengeRequired: false, proxyType: null, reason: "IP reputation is unavailable and Turnstile is not configured", reputationStatus: reputation.status };
      return { blocked: false, challengeRequired: true, proxyType: null, reason: "IP reputation unavailable; human verification required", reputationStatus: reputation.status };
    }
    return { blocked: false, challengeRequired: false, proxyType: null, reason: "IP reputation unavailable; allowed by policy", reputationStatus: reputation.status };
  }
  return { blocked: false, challengeRequired: false, proxyType: null, reputationStatus: { available: true, provider: null, reason: "not_required", latencyMs: 0, cacheHit: false } };
}

export async function securityDecision(page, ip, userAgent = "", req = null) {
  const security = page.securityConfig || {};
  const bannedIps = security.bannedIps || [];
  const whitelistIps = security.whitelistIps || [];
  if (whitelistIps.includes(ip)) return { allowed: true, challengeRequired: false, reason: "IP whitelisted", reputationStatus: { available: true, provider: "whitelist", reason: null, latencyMs: 0, cacheHit: false } };
  if (bannedIps.includes(ip)) return { allowed: false, challengeRequired: false, reason: "IP blocked by page security rules" };
  const proxy = await proxySecurityDecision(security, req, ip);
  if (proxy.blocked) return { allowed: false, challengeRequired: false, reason: proxy.reason, proxyType: proxy.proxyType, reputation: proxy.reputation || null, reputationStatus: proxy.reputationStatus || null };
  const device = deviceBlocked(security, userAgent);
  if (device.blocked) return { allowed: false, challengeRequired: false, reason: `${device.deviceType} devices are blocked`, deviceType: device.deviceType, proxyType: proxy.proxyType, reputation: proxy.reputation || null, reputationStatus: proxy.reputationStatus || null };
  if (page.status && page.status !== "active") return { allowed: false, challengeRequired: false, reason: "Page subscription is not active", deviceType: device.deviceType, proxyType: proxy.proxyType, reputation: proxy.reputation || null, reputationStatus: proxy.reputationStatus || null };
  return { allowed: true, challengeRequired: Boolean(proxy.challengeRequired), reason: proxy.reason || "Allowed", deviceType: device.deviceType, proxyType: proxy.proxyType, reputation: proxy.reputation || null, reputationStatus: proxy.reputationStatus || null };
}
