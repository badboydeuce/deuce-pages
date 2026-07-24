const secretKeys = new Map([
  ["secretkey", "secretConfigured"],
  ["turnstilesecretkey", "turnstileSecretConfigured"],
  ["relaysecret", "relaySecretConfigured"],
  ["webhooksigningsecret", "webhookSigningSecretConfigured"],
  ["apitoken", "apiTokenConfigured"]
]);

export function sanitizeResponseSecrets(value) {
  if (Array.isArray(value)) return value.map(sanitizeResponseSecrets);
  if (!value || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) return value;

  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    const flag = secretKeys.get(String(key).toLowerCase());
    if (flag) {
      clean[flag] = Boolean(item) || clean[flag] === true;
      continue;
    }
    if (/configured$/i.test(key) && clean[key] === true && item === false) continue;
    clean[key] = sanitizeResponseSecrets(item);
  }
  return clean;
}
