const trafficDeviceTypes = new Set(["mobile", "desktop", "tablet", "bot", "other"]);

export function trafficDeviceType(event = {}) {
  const stored = String(event.metadata?.deviceType || event.deviceType || "").toLowerCase();
  if (trafficDeviceTypes.has(stored)) return stored;

  const agent = String(event.userAgent || "").toLowerCase();
  if (!agent) return "other";
  if (/bot|crawler|spider|slurp|headless|preview|scanner|curl|wget|python-requests|httpclient/.test(agent)) return "bot";
  if (/ipad|tablet|kindle|silk|playbook/.test(agent)) return "tablet";
  if (/mobi|android|iphone|ipod|phone|blackberry|opera mini|windows phone/.test(agent)) return "mobile";
  if (/windows nt|macintosh|linux x86_64|x11|cros/.test(agent)) return "desktop";
  return "other";
}

function eventTime(event = {}) {
  const value = new Date(event.createdAt || event.time || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function visitKey(event = {}, index = 0) {
  const sessionId = String(event.sessionId || "").trim();
  if (sessionId) return `session:${sessionId}`;
  return `event:${String(event.id || index)}`;
}

export function summarizeTrafficEvents(events = [], options = {}) {
  const visits = new Map();
  let blockEvents = 0;

  events.forEach((event, index) => {
    const key = visitKey(event, index);
    const createdAt = eventTime(event);
    const blocked = String(event.result || "").toLowerCase() === "blocked";
    const deviceType = trafficDeviceType(event);
    const current = visits.get(key) || {
      firstSeenAt: createdAt,
      blocked: false,
      deviceType,
      events: 0
    };

    if (!current.firstSeenAt || (createdAt && createdAt < current.firstSeenAt)) current.firstSeenAt = createdAt;
    if (current.deviceType === "other" && deviceType !== "other") current.deviceType = deviceType;
    current.blocked = current.blocked || blocked;
    current.events += 1;
    visits.set(key, current);
    if (blocked) blockEvents += 1;
  });

  const devices = { mobile: 0, desktop: 0, tablet: 0, bot: 0, other: 0 };
  let blockedVisits = 0;
  for (const visit of visits.values()) {
    devices[visit.deviceType] = (devices[visit.deviceType] || 0) + 1;
    if (visit.blocked) blockedVisits += 1;
  }

  const windowHours = Math.min(Math.max(Number(options.windowHours) || 24, 1), 168);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const cutoff = now - windowHours * 60 * 60 * 1000;
  const buckets = new Map();

  for (const visit of visits.values()) {
    if (!visit.firstSeenAt || visit.firstSeenAt < cutoff || visit.firstSeenAt > now) continue;
    const hour = new Date(visit.firstSeenAt);
    hour.setUTCMinutes(0, 0, 0);
    const at = hour.toISOString();
    const bucket = buckets.get(at) || { at, visits: 0, blockedVisits: 0 };
    bucket.visits += 1;
    if (visit.blocked) bucket.blockedVisits += 1;
    buckets.set(at, bucket);
  }

  const uniqueVisits = visits.size;
  return {
    uniqueVisits,
    cleanVisits: Math.max(0, uniqueVisits - blockedVisits),
    blockedVisits,
    blockEvents,
    totalEvents: events.length,
    devices,
    timeline: [...buckets.values()].sort((a, b) => a.at.localeCompare(b.at)),
    windowHours
  };
}
