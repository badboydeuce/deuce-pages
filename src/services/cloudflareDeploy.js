function cleanDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function rootDomain(hostname) {
  const clean = cleanDomain(hostname);
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return clean;
  return parts.slice(-2).join(".");
}

function backendBaseUrl() {
  return (process.env.RUNTIME_API_BASE_URL || process.env.API_BASE_URL || process.env.APP_BASE_URL || "").replace(/\/$/, "");
}

export function cloudflareWorkerScript({ relaySecret }) {
  const backendUrl = backendBaseUrl();
  if (!backendUrl) {
    throw new Error("Backend URL is not configured. Set API_BASE_URL or APP_BASE_URL on Render.");
  }

  return `const DEUCE_API = "${backendUrl}";
const RELAY_SECRET = "${relaySecret}";

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname.endsWith("/index.html")) {
    url.pathname = url.pathname.replace(/index\\.html$/, "");
    return Response.redirect(url.toString(), 301);
  }

  if (!url.pathname.startsWith("/api/")) {
    return fetch(request);
  }

  const target = new URL(DEUCE_API);
  target.pathname = "/api/runtime" + url.pathname.replace(/^\\/api/, "");
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.set("x-deuce-relay-secret", RELAY_SECRET);
  headers.set("x-deuce-client-host", url.hostname);

  return fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body
  });
}`;
}

async function cloudflareFetch(path, token, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message = data.errors?.map((error) => error.message).filter(Boolean).join("; ")
      || data.message
      || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data;
}

export async function verifyCloudflareZone({ apiToken, domain }) {
  if (!apiToken) throw new Error("Cloudflare API token is required");
  const zoneName = rootDomain(domain);
  if (!zoneName) throw new Error("Domain is required");

  const tokenStatus = await cloudflareFetch("/user/tokens/verify", apiToken);
  const zones = await cloudflareFetch(`/zones?name=${encodeURIComponent(zoneName)}&status=active`, apiToken);
  const zone = zones.result?.[0];
  if (!zone) {
    throw new Error(`Cloudflare zone not found for ${zoneName}. Make sure the domain is active in this Cloudflare account.`);
  }

  return {
    tokenStatus: tokenStatus.result?.status || "active",
    zoneId: zone.id,
    zoneName: zone.name
  };
}

export async function installCloudflareWorker({ apiToken, accountId, domain, relaySecret, scriptName }) {
  if (!accountId) throw new Error("Cloudflare account ID is required");
  if (!relaySecret) throw new Error("Relay secret is required before installing Worker");

  const zone = await verifyCloudflareZone({ apiToken, domain });
  const safeScriptName = String(scriptName || `deuce-${cleanDomain(domain).replace(/[^a-z0-9-]/g, "-")}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54);
  const routePattern = `${cleanDomain(domain)}/api/*`;
  const script = cloudflareWorkerScript({ relaySecret });

  await cloudflareFetch(`/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(safeScriptName)}`, apiToken, {
    method: "PUT",
    headers: { "Content-Type": "application/javascript" },
    body: script
  });

  const existingRoutes = await cloudflareFetch(`/zones/${encodeURIComponent(zone.zoneId)}/workers/routes`, apiToken);
  const existingRoute = existingRoutes.result?.find((route) => route.pattern === routePattern);
  if (existingRoute) {
    await cloudflareFetch(`/zones/${encodeURIComponent(zone.zoneId)}/workers/routes/${encodeURIComponent(existingRoute.id)}`, apiToken, {
      method: "PUT",
      body: JSON.stringify({ pattern: routePattern, script: safeScriptName })
    });
  } else {
    await cloudflareFetch(`/zones/${encodeURIComponent(zone.zoneId)}/workers/routes`, apiToken, {
      method: "POST",
      body: JSON.stringify({ pattern: routePattern, script: safeScriptName })
    });
  }

  return {
    zoneId: zone.zoneId,
    zoneName: zone.zoneName,
    accountId,
    scriptName: safeScriptName,
    routePattern,
    installedAt: new Date().toISOString()
  };
}
