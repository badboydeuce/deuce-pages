const defaultMessage = "Request could not be completed. Please try again.";

const statusMessages = new Map([
  [0, "Connection failed. Please try again."],
  [400, "Please check the submitted information and try again."],
  [401, "Your session has expired. Please sign in again."],
  [403, "You do not have permission to perform this action."],
  [404, "The requested item was not found."],
  [409, "This action conflicts with the current state. Refresh and try again."],
  [413, "The submitted file is too large."],
  [429, "Too many requests. Please wait and try again."]
]);

const unsafePatterns = [
  /\bhttps?:\/\/\S+/i,
  /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?/i,
  /(?:^|[\s"'`])\/(?:api|portal|preview|runtime|invite|login)(?:\/|\b)/i,
  /\b[a-z]:[\\/](?:users|windows|program files|temp|tmp)(?:[\\/]|\b)/i,
  /(?:^|\s)\/(?:home|users|var|usr|srv|opt|tmp|app)(?:\/|\b)/i,
  /\b(?:user_page|result|session|invite|package|pkg|user)_[a-z0-9_-]{6,}\b/i,
  /\b[a-z][a-z0-9]*_[a-f0-9]{12,}\b/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  /[?&](?:token|key|secret|signature|invite|session)=[^\s&]+/i,
  /\b(?:bearer|authorization|api[_ -]?key|secret|password|token)\s*[:=]\s*\S+/i,
  /(?:^|\n)\s*at\s+\S+(?:\s+\(|:)/i,
  /\bat\s+\S+\s*\([^)]*:\d+:\d+\)/i,
  /\b[\w.-]+(?:[\\/][\w.-]+)+\.(?:js|mjs|cjs|ts|tsx|json|sql):\d+(?::\d+)?\b/i,
  /\b(?:select|insert|update|delete)\s+.+\b(?:from|into|set|where)\b/i,
  /\b(?:postgres|relation|constraint|column|syntax error|econnrefused|enotfound)\b/i,
  /<!doctype|<html|<script|<body/i,
  /^\s*[\[{].*[\]}]\s*$/s
];

const privateErrorKeys = new Set([
  "cause",
  "debug",
  "details",
  "exception",
  "path",
  "query",
  "raw",
  "stack",
  "trace",
  "url"
]);

function normalizedMessage(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function publicErrorFallback(status = 0, fallback = "") {
  const safeStatus = Number(status || 0);
  if (fallback) return fallback;
  if (statusMessages.has(safeStatus)) return statusMessages.get(safeStatus);
  if (safeStatus >= 500) return "The service is temporarily unavailable. Please try again.";
  return defaultMessage;
}

export function isSafePublicErrorMessage(value) {
  const message = normalizedMessage(value);
  return Boolean(message)
    && message.length <= 180
    && !unsafePatterns.some((pattern) => pattern.test(message));
}

export function publicErrorMessage(error, options = {}) {
  const status = Number(options.status || error?.status || 0);
  const raw = typeof error === "string" ? error : error?.message;
  const message = normalizedMessage(raw);
  return isSafePublicErrorMessage(message)
    ? message
    : publicErrorFallback(status, options.fallback || "");
}

function sanitizeErrorValue(value, status, key = "") {
  if (privateErrorKeys.has(String(key).toLowerCase())) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeErrorValue(item, status, key))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) {
    if (typeof value !== "string") return value;
    if (/error|issue|message|reason/i.test(key)) return publicErrorMessage(value, { status });
    return value;
  }
  const clean = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const sanitized = sanitizeErrorValue(childValue, status, childKey);
    if (sanitized !== undefined) clean[childKey] = sanitized;
  }
  return clean;
}

export function sanitizeErrorResponse(body, status = 500) {
  if (Number(status) < 400 || !body || typeof body !== "object") return body;
  if (Array.isArray(body)) return { error: publicErrorFallback(status) };
  const clean = sanitizeErrorValue(body, status);
  const sourceError = body.error || body.message;
  if (sourceError || !clean.error) {
    clean.error = publicErrorMessage(sourceError, { status });
  }
  delete clean.message;
  return clean;
}
