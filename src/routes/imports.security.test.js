import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { importsRouter } from "./imports.js";
import { createGitHubPreviewTicket } from "../services/githubPreviewAccess.js";

function localRequest(server, requestPath) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: "127.0.0.1",
      port: address.port,
      path: requestPath
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.on("error", reject);
  });
}

test("GitHub preview endpoints require file-bound tickets and sandbox HTML", async () => {
  const previousSecret = process.env.GITHUB_PREVIEW_SECRET;
  const originalFetch = globalThis.fetch;
  const upstreamRequests = [];
  process.env.GITHUB_PREVIEW_SECRET = "route-test-preview-secret-with-enough-entropy";

  globalThis.fetch = async (url) => {
    const target = String(url);
    upstreamRequests.push(target);
    if (target.includes("index.html")) {
      return new Response('<!doctype html><link rel="stylesheet" href="../assets/app.css"><h1>Preview</h1>', {
        status: 200,
        headers: { "Content-Type": "text/html", "Content-Length": "82" }
      });
    }
    if (target.includes("assets/app.css")) {
      return new Response("body{color:#111}", {
        status: 200,
        headers: { "Content-Type": "text/css", "Content-Length": "16" }
      });
    }
    return new Response("Not found", { status: 404 });
  };

  const app = express();
  app.use("/api/admin/import", importsRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const unauthorized = await localRequest(server, "/api/admin/import/github/preview?repoUrl=https://github.com/example/site&branch=main&file=pages/index.html");
    assert.equal(unauthorized.status, 401);
    assert.equal(upstreamRequests.length, 0);

    const ticket = createGitHubPreviewTicket({
      repoUrl: "https://github.com/example/site",
      branch: "main",
      file: "pages/index.html",
      kind: "page",
      userId: "admin-1"
    });
    const preview = await localRequest(server, `/api/admin/import/github/preview?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers["content-security-policy"] || "", /sandbox allow-scripts/);
    assert.doesNotMatch(preview.headers["content-security-policy"] || "", /allow-same-origin/);
    assert.equal(preview.headers["cache-control"], "no-store");
    assert.doesNotMatch(preview.body, /repoUrl=/);

    const assetUrl = preview.body.match(/href="([^"]*\/github\/asset\?ticket=[^"]+)"/)?.[1];
    assert.ok(assetUrl);
    const asset = await localRequest(server, assetUrl);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers["content-type"], "text/css; charset=utf-8");
    assert.equal(asset.body, "body{color:#111}");

    const tampered = await localRequest(server, `/api/admin/import/github/preview?ticket=${encodeURIComponent(ticket)}x`);
    assert.equal(tampered.status, 401);
    assert.equal(upstreamRequests.length, 2);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    globalThis.fetch = originalFetch;
    if (previousSecret === undefined) delete process.env.GITHUB_PREVIEW_SECRET;
    else process.env.GITHUB_PREVIEW_SECRET = previousSecret;
  }
});
