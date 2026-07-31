import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

test("production HTTP security middleware protects portal and preview responses", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigins = process.env.CORS_ORIGINS;
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  process.env.NODE_ENV = "production";
  process.env.CORS_ORIGINS = "https://portal.example";
  process.env.APP_BASE_URL = "https://portal.example";

  const { createApp } = await import(`./app.js?security-test=${Date.now()}`);
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://portal.example" }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://portal.example");
    assert.equal(allowed.headers.get("cache-control"), "no-store");
    assert.equal(allowed.headers.get("x-powered-by"), null);
    assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
    assert.equal(allowed.headers.get("referrer-policy"), "no-referrer");
    assert.match(allowed.headers.get("strict-transport-security") || "", /max-age=31536000/);
    assert.match(allowed.headers.get("permissions-policy") || "", /camera=\(\)/);
    assert.match(allowed.headers.get("content-security-policy") || "", /object-src 'none'/);
    assert.match(allowed.headers.get("content-security-policy") || "", /frame-ancestors 'self'/);

    const deniedGet = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://attacker.example" }
    });
    assert.equal(deniedGet.status, 200);
    assert.equal(deniedGet.headers.get("access-control-allow-origin"), null);

    const deniedPreflight = await fetch(`${baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "GET"
      }
    });
    assert.equal(deniedPreflight.status, 403);

    const previewPreflight = await fetch(`${baseUrl}/preview/example`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://portal.example",
        "Access-Control-Request-Method": "GET"
      }
    });
    assert.equal(previewPreflight.status, 204);
    assert.equal(previewPreflight.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.match(previewPreflight.headers.get("content-security-policy") || "", /worker-src 'none'/);
    assert.match(previewPreflight.headers.get("content-security-policy") || "", /script-src-attr 'unsafe-inline'/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousCorsOrigins;
    if (previousAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousAppBaseUrl;
  }
});
