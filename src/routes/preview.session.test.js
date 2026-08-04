import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import http from "node:http";

function requestAsPreviewHost(baseUrl, route, options = {}) {
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

test("signed-in users exchange one-time links for isolated preview cookies", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH,
    PREVIEW_BASE_URL: process.env.PREVIEW_BASE_URL,
    PORTAL_BASE_URL: process.env.PORTAL_BASE_URL,
    APP_BASE_URL: process.env.APP_BASE_URL,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    RENDER: process.env.RENDER,
    RENDER_SERVICE_TYPE: process.env.RENDER_SERVICE_TYPE
  };
  const originalFetch = globalThis.fetch;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-preview-route-"));
  const dbPath = path.join(tempRoot, "db.json");
  const portalToken = "route-test-portal-token";
  const now = new Date().toISOString();

  process.env.NODE_ENV = "production";
  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  process.env.PREVIEW_BASE_URL = "https://preview.example";
  process.env.PORTAL_BASE_URL = "https://portal.example";
  process.env.APP_BASE_URL = "https://portal.example";
  process.env.CORS_ORIGINS = "https://portal.example";
  process.env.RENDER = "true";
  process.env.RENDER_SERVICE_TYPE = "web";

  await fs.writeFile(dbPath, JSON.stringify({
    users: [{
      id: "user_route",
      name: "Route User",
      email: "route@example.com",
      role: "subscriber",
      status: "active",
      walletBalance: 0,
      collaboration: {},
      createdAt: now,
      updatedAt: now
    }],
    sessions: [{
      id: "session_route",
      userId: "user_route",
      tokenHash: createHash("sha256").update(portalToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      createdAt: now
    }],
    packages: [{
      id: "pkg_route",
      slug: "route-preview",
      name: "Route Preview",
      version: "v1",
      status: "published",
      sourceType: "github",
      repoUrl: "https://github.com/example/route-preview.git",
      billingPeriods: { weekly: 25 },
      screens: [{ file: "index.html", name: "Login", role: "entry" }],
      assets: ["logo.png"],
      cssFiles: [],
      designTokens: {},
      packageManifest: {
        github: { owner: "example", repo: "route-preview", branch: "main" },
        screens: [{ file: "index.html", name: "Login", role: "entry" }],
        files: [{ path: "index.html" }, { path: "logo.png" }]
      },
      publishedAt: now,
      createdAt: now,
      updatedAt: now
    }],
    packagePreviewSessions: []
  }));

  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://raw.githubusercontent.com/")) {
      return new Response("<!doctype html><html><body><img src=\"logo.png\"><form><button>Continue</button></form></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    }
    return originalFetch(input, init);
  };

  const { createApp } = await import("../app.js?preview-route-test=" + Date.now());
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = "http://127.0.0.1:" + address.port;

  try {
    const launch = await globalThis.fetch(baseUrl + "/api/packages/pkg_route/preview-session", {
      method: "POST",
      headers: { Authorization: "Bearer " + portalToken }
    });
    assert.equal(launch.status, 201);
    const launchBody = await launch.json();
    const launchUrl = new URL(launchBody.previewUrl);
    assert.equal(launchUrl.origin, "https://preview.example");
    assert.match(launchUrl.pathname, /^\/session\/[A-Za-z0-9_-]+$/);

    const exchange = await requestAsPreviewHost(baseUrl, launchUrl.pathname);
    assert.equal(exchange.status, 303);
    assert.equal(exchange.headers.get("location"), "/p");
    const cookie = String(exchange.headers.get("set-cookie") || "").split(";")[0];
    assert.match(cookie, /^deuce_preview_session=/);
    assert.match(exchange.headers.get("set-cookie") || "", /HttpOnly/i);
    assert.match(exchange.headers.get("set-cookie") || "", /SameSite=Strict/i);

    const replay = await requestAsPreviewHost(baseUrl, launchUrl.pathname);
    assert.equal(replay.status, 401);

    const preview = await requestAsPreviewHost(baseUrl, "/p", {
      headers: { Cookie: cookie }
    });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-security-policy") || "", /sandbox allow-scripts allow-forms/);
    assert.match(await preview.text(), /src="\/p\/asset\?file=logo\.png"/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
