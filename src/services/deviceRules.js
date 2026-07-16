export const deviceTypes = ["mobile", "desktop", "tablet", "bot", "other"];

export function detectDeviceType(userAgent = "") {
  const agent = String(userAgent || "").toLowerCase();
  if (!agent) return "other";
  if (/bot|crawler|spider|slurp|headless|preview|scanner/.test(agent)) return "bot";
  if (/ipad|tablet|kindle|silk|playbook/.test(agent)) return "tablet";
  if (/mobi|android|iphone|ipod|phone|blackberry|opera mini|windows phone/.test(agent)) return "mobile";
  if (/windows nt|macintosh|linux x86_64|x11|cros/.test(agent)) return "desktop";
  return "other";
}

export function deviceBlocked(security = {}, userAgent = "") {
  const deviceType = detectDeviceType(userAgent);
  const blockedDevices = Array.isArray(security.blockedDevices) ? security.blockedDevices : [];
  return {
    blocked: blockedDevices.includes(deviceType),
    deviceType
  };
}
