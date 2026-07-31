import { isIP } from "node:net";

function isRenderWebService(env) {
  return String(env.RENDER || "").toLowerCase() === "true"
    && String(env.RENDER_SERVICE_TYPE || "").toLowerCase() === "web";
}

function normalizeIp(value) {
  let ip = String(value || "").trim();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) {
    ip = ip.slice(7);
  }
  return isIP(ip) ? ip : "";
}

export function configureClientIpTrust(app, env = process.env) {
  // Render web services receive public traffic through one final load-balancer
  // hop. Everywhere else, forwarded client-IP headers remain untrusted.
  app.set("trust proxy", isRenderWebService(env) ? 1 : false);
}

export function clientIp(req) {
  return normalizeIp(req.ip)
    || normalizeIp(req.socket?.remoteAddress)
    || "unknown";
}
