(function installDeucePublicErrors(global) {
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

  function fallbackForStatus(status, fallback = "") {
    if (fallback) return fallback;
    if (statusMessages.has(status)) return statusMessages.get(status);
    if (status >= 500) return "The service is temporarily unavailable. Please try again.";
    return defaultMessage;
  }

  function normalizedMessage(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSafeMessage(value) {
    const message = normalizedMessage(value);
    return Boolean(message)
      && message.length <= 180
      && !unsafePatterns.some((pattern) => pattern.test(message));
  }

  function message(error, fallback = "") {
    const status = Number(error?.status || 0);
    const raw = typeof error === "string" ? error : error?.message;
    const clean = normalizedMessage(raw);
    return isSafeMessage(clean) ? clean : fallbackForStatus(status, fallback);
  }

  global.DeucePublicErrors = Object.freeze({ message, isSafeMessage });
})(window);
