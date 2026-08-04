function normalizedBaseUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.origin;
  } catch {
    return "";
  }
}

export function previewBaseUrl() {
  return normalizedBaseUrl(process.env.PREVIEW_BASE_URL)
    || (process.env.NODE_ENV === "production" ? "https://preview.deucetoolkit.cloud" : "");
}

export function portalBaseUrl() {
  return normalizedBaseUrl(process.env.PORTAL_BASE_URL)
    || normalizedBaseUrl(process.env.APP_BASE_URL)
    || "";
}

export function publicBaseUrl() {
  return normalizedBaseUrl(process.env.PUBLIC_BASE_URL)
    || normalizedBaseUrl(process.env.APP_BASE_URL)
    || "";
}

function hostnameFor(baseUrl) {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isPreviewHost(req) {
  const configured = hostnameFor(previewBaseUrl());
  const hostHeader = String(req.headers.host || "").trim();
  let requestHostname = "";
  try {
    requestHostname = new URL("http://" + hostHeader).hostname.toLowerCase();
  } catch {
    requestHostname = "";
  }
  return Boolean(configured) && requestHostname === configured;
}

export function previewLaunchUrl(req, ticket) {
  const baseUrl = previewBaseUrl();
  const path = "/session/" + encodeURIComponent(ticket);
  if (baseUrl) return baseUrl + path;
  return req.protocol + "://" + req.get("host") + "/preview" + path;
}

export function previewRouteBase(req) {
  return isPreviewHost(req) ? "" : "/preview";
}
