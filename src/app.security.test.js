import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import http from "node:http";

function requestAsHost(baseUrl, route, options = {}) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: route,
      method: options.method || "GET",
      headers: { Host: "preview.example", ...(options.headers || {}) }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: response.headers
      })));
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

test("production HTTP security middleware protects portal and preview responses", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigins = process.env.CORS_ORIGINS;
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  const previousPortalBaseUrl = process.env.PORTAL_BASE_URL;
  const previousPreviewBaseUrl = process.env.PREVIEW_BASE_URL;
  const previousRender = process.env.RENDER;
  const previousRenderServiceType = process.env.RENDER_SERVICE_TYPE;
  process.env.NODE_ENV = "production";
  process.env.CORS_ORIGINS = "https://portal.example";
  process.env.APP_BASE_URL = "https://portal.example";
  process.env.PORTAL_BASE_URL = "https://portal.example";
  process.env.PREVIEW_BASE_URL = "https://preview.example";
  process.env.RENDER = "true";
  process.env.RENDER_SERVICE_TYPE = "web";

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
    assert.equal(allowed.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
    assert.equal(allowed.headers.get("x-powered-by"), null);
    assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
    assert.equal(allowed.headers.get("referrer-policy"), "no-referrer");
    assert.match(allowed.headers.get("strict-transport-security") || "", /max-age=31536000/);
    assert.match(allowed.headers.get("permissions-policy") || "", /camera=\(\)/);
    assert.match(allowed.headers.get("content-security-policy") || "", /object-src 'none'/);
    assert.match(allowed.headers.get("content-security-policy") || "", /frame-ancestors 'self'/);

    const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), "/blog/");

    const blog = await fetch(`${baseUrl}/blog/`);
    assert.equal(blog.status, 200);
    assert.equal(blog.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
    assert.match(await blog.text(), /name="robots" content="noindex, nofollow, noarchive, nosnippet"/);

    const login = await fetch(`${baseUrl}/login`);
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("cache-control"), "no-store");
    const loginHtml = await login.text();
    assert.match(loginHtml, /id="loginForm"/);
    assert.doesNotMatch(loginHtml, /Authorized access only|PRIVATE OPERATOR WORKSPACE|Read the guide/);
    assert.doesNotMatch(loginHtml, /class="access-header"|class="access-intro"|<footer/);

    const protectedPortal = await fetch(`${baseUrl}/portal`, { redirect: "manual" });
    assert.equal(protectedPortal.status, 303);
    assert.equal(protectedPortal.headers.get("location"), "/login");

    const protectedScript = await fetch(`${baseUrl}/portal/assets/script.js`, { redirect: "manual" });
    assert.equal(protectedScript.status, 303);
    assert.equal(protectedScript.headers.get("location"), "/login");

    const protectedPackages = await fetch(`${baseUrl}/api/packages`);
    assert.equal(protectedPackages.status, 401);

    const protectedPreview = await fetch(`${baseUrl}/preview/example`);
    assert.equal(protectedPreview.status, 404);

    const isolatedPreview = await requestAsHost(baseUrl, "/p");
    assert.equal(isolatedPreview.status, 401);
    assert.equal(isolatedPreview.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.match(isolatedPreview.headers.get("content-security-policy") || "", /sandbox allow-scripts allow-forms allow-modals allow-same-origin/);
    assert.match(isolatedPreview.headers.get("content-security-policy") || "", /frame-ancestors 'self' https:\/\/portal\.example/);
    assert.match(await isolatedPreview.text(), /Preview session required/);

    const previewApi = await requestAsHost(baseUrl, "/api/health");
    assert.equal(previewApi.status, 404);

    const spoofedPreviewHost = await fetch(`${baseUrl}/p`, {
      headers: { "X-Forwarded-Host": "preview.example", "X-Forwarded-Proto": "https" }
    });
    assert.equal(spoofedPreviewHost.status, 404);

    const sourceFile = await fetch(`${baseUrl}/src/app.js`);
    assert.equal(sourceFile.status, 404);
    const packageFile = await fetch(`${baseUrl}/package.json`);
    assert.equal(packageFile.status, 404);

    const robots = await fetch(`${baseUrl}/robots.txt`);
    assert.match(await robots.text(), /Disallow: \/portal/);

    const deniedGet = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://attacker.example" }
    });
    assert.equal(deniedGet.status, 403);
    assert.equal(deniedGet.headers.get("access-control-allow-origin"), null);

    const deniedPreflight = await fetch(`${baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "GET"
      }
    });
    assert.equal(deniedPreflight.status, 403);

    const previewPreflight = await requestAsHost(baseUrl, "/p", {
      method: "OPTIONS",
      headers: {
        Origin: "https://portal.example",
        "Access-Control-Request-Method": "GET"
      }
    });
    assert.equal(previewPreflight.status, 403);
    assert.equal(previewPreflight.headers.get("access-control-allow-origin"), null);
    assert.equal(previewPreflight.headers.get("cross-origin-resource-policy"), "cross-origin");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousCorsOrigins;
    if (previousAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousAppBaseUrl;
    if (previousPortalBaseUrl === undefined) delete process.env.PORTAL_BASE_URL;
    else process.env.PORTAL_BASE_URL = previousPortalBaseUrl;
    if (previousPreviewBaseUrl === undefined) delete process.env.PREVIEW_BASE_URL;
    else process.env.PREVIEW_BASE_URL = previousPreviewBaseUrl;
    if (previousRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = previousRender;
    if (previousRenderServiceType === undefined) delete process.env.RENDER_SERVICE_TYPE;
    else process.env.RENDER_SERVICE_TYPE = previousRenderServiceType;
  }
});
