import { deviceBlocked } from "./deviceRules.js";

function headerValue(req, name) {
  return String(req?.headers?.[name] || "").trim();
}

export function proxySecurityDecision(security = {}, req = null) {
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

export function securityDecision(page, ip, userAgent = "", req = null) {
  const security = page.securityConfig || {};
  const bannedIps = security.bannedIps || [];
  const whitelistIps = security.whitelistIps || [];
  if (whitelistIps.includes(ip)) return { allowed: true, reason: "IP whitelisted" };
  if (bannedIps.includes(ip)) return { allowed: false, reason: "IP blocked by page security rules" };
  const proxy = proxySecurityDecision(security, req);
  if (proxy.blocked) return { allowed: false, reason: proxy.reason, proxyType: proxy.proxyType };
  const device = deviceBlocked(security, userAgent);
  if (device.blocked) return { allowed: false, reason: `${device.deviceType} devices are blocked`, deviceType: device.deviceType, proxyType: proxy.proxyType };
  if (page.status && page.status !== "active") return { allowed: false, reason: "Page subscription is not active", deviceType: device.deviceType, proxyType: proxy.proxyType };
  return { allowed: true, reason: "Allowed", deviceType: device.deviceType, proxyType: proxy.proxyType };
}
