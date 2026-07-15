export function previewTurnstileSiteKey() {
  return process.env.PREVIEW_TURNSTILE_SITE_KEY || "";
}

export function turnstileEnabled(security = {}) {
  return Boolean(security.captcha && (security.turnstile?.siteKey || security.turnstileSiteKey));
}

export function publicTurnstileConfig(security = {}) {
  return {
    enabled: Boolean(security.captcha),
    provider: "turnstile",
    siteKey: security.turnstile?.siteKey || security.turnstileSiteKey || ""
  };
}

export function turnstileSecretFor(security = {}) {
  return security.turnstile?.secretKey || security.turnstileSecretKey || process.env.TURNSTILE_SECRET_KEY || "";
}

export async function verifyTurnstileToken({ token, secret, remoteIp }) {
  if (!secret) {
    return { success: false, error: "Turnstile secret key is not configured" };
  }
  if (!token) {
    return { success: false, error: "Turnstile token is required" };
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const result = await response.json().catch(() => ({}));
  return {
    success: Boolean(result.success),
    error: Array.isArray(result["error-codes"]) ? result["error-codes"].join(", ") : ""
  };
}

export function inferRedirectFile(html) {
  const redirectFieldMatch = String(html).match(/formData\.append\(\s*["']redirect["']\s*,\s*["']([^"']+)["']\s*\)/i);
  const replaceMatch = String(html).match(/window\.location\.replace\(\s*["']([^"']+)["']\s*\)/i);
  const redirect = redirectFieldMatch?.[1] || replaceMatch?.[1] || "";
  return redirect.replace(/^\/+/, "");
}

export function isCaptchaGatePage(html) {
  const source = String(html);
  return /\bcf-turnstile\b/i.test(source)
    && /\/verify-human\b/i.test(source)
    && Boolean(inferRedirectFile(source));
}

export function injectPreviewTurnstile(html, options = {}) {
  const siteKey = previewTurnstileSiteKey();
  const redirectFile = inferRedirectFile(html);

  let nextHtml = String(html);
  if (siteKey) {
    nextHtml = nextHtml
    .replace(/__CAPTCHA_SITE_KEY__/g, siteKey)
    .replace(/__TURNSTILE_SITE_KEY__/g, siteKey)
    .replace(/(\bsitekey\s*:\s*)["'][^"']*["']/gi, `$1"${siteKey}"`)
    .replace(/(\bsiteKey\s*:\s*)["'][^"']*["']/g, `$1"${siteKey}"`);

    nextHtml = nextHtml.replace(
      /(<[^>]*class=["'][^"']*\bcf-turnstile\b[^"']*["'][^>]*)(>)/gi,
      (match, start, end) => {
        const withoutOldKey = start.replace(/\sdata-sitekey=["'][^"']*["']/i, "");
        return `${withoutOldKey} data-sitekey="${siteKey}"${end}`;
      }
    );
  }

  const hasWidget = /\bcf-turnstile\b/i.test(nextHtml);
  const hasScript = /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/i.test(nextHtml);
  const bootstrap = [
    siteKey ? `<script>window.DEUCE_TURNSTILE_SITE_KEY=${JSON.stringify(siteKey)};<\/script>` : "",
    hasWidget && siteKey && !hasScript ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer><\/script>` : "",
    options.token && redirectFile ? `<script>
window.DEUCE_PREVIEW_NEXT=${JSON.stringify(`/preview/${encodeURIComponent(options.token)}/page?file=${redirectFile}`)};
window.addEventListener("load", function () {
  window.onTurnstileSuccess = function () {
    var statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Verification complete. Opening preview...";
    window.location.replace(window.DEUCE_PREVIEW_NEXT);
  };
});
<\/script>` : ""
  ].filter(Boolean).join("");

  if (!bootstrap) return nextHtml;
  if (/<\/head>/i.test(nextHtml)) {
    return nextHtml.replace(/<\/head>/i, `${bootstrap}</head>`);
  }
  return `${bootstrap}${nextHtml}`;
}
