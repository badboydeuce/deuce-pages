import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  githubPushChangedFiles,
  verifyGitHubWebhookSignature
} from "./githubWebhook.js";

function signature(body, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function postJson(baseUrl, route, body, headers = {}) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: route,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, body: raw ? JSON.parse(raw) : {} });
      });
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

test("GitHub webhook signatures use the exact raw request bytes", () => {
  const secret = "test-signing-secret-that-is-long-enough";
  const body = Buffer.from('{"ref":"refs/heads/main", "value":1}');
  assert.equal(verifyGitHubWebhookSignature(body, signature(body, secret), secret), true);
  assert.throws(
    () => verifyGitHubWebhookSignature(Buffer.from('{"ref":"refs/heads/main","value":1}'), signature(body, secret), secret),
    /Invalid GitHub webhook signature/
  );
  assert.throws(() => verifyGitHubWebhookSignature(body, "sha256=bad", secret), /Invalid GitHub webhook signature/);
  assert.throws(() => verifyGitHubWebhookSignature(body, signature(body, secret), "short"), /not configured/);
});

test("GitHub push file extraction normalizes, deduplicates, and rejects traversal", () => {
  assert.deepEqual(githubPushChangedFiles({
    commits: [
      { added: ["/index.html", "../secret.txt"], modified: ["assets\\app.js"], removed: [] },
      { added: [], modified: ["index.html"], removed: ["old.html"] }
    ],
    head_commit: { modified: ["assets/app.js"] }
  }), ["index.html", "assets/app.js", "old.html"]);
});

test("signed GitHub pushes create one inbox event and move structural package changes to review", async () => {
  const envBefore = {
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
    NODE_ENV: process.env.NODE_ENV
  };
  const databasePath = path.join(os.tmpdir(), `deuce-github-webhook-${process.pid}-${Date.now()}.json`);
  const secret = "integration-webhook-secret-that-is-long-enough";
  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = databasePath;
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.GITHUB_WEBHOOK_SECRET = secret;
  process.env.NODE_ENV = "test";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/acme/demo") {
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("https://api.github.com/repos/acme/demo/git/trees/main")) {
      return new Response(JSON.stringify({
        sha: "tree-after",
        truncated: false,
        tree: [
          { path: "index.html", type: "blob", size: 120, sha: "index-before" },
          { path: "otp.html", type: "blob", size: 90, sha: "otp-after" }
        ]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://api.github.com/repos/acme/demo/commits/main") {
      return new Response(JSON.stringify({
        sha: "after-commit-sha",
        html_url: "https://github.com/acme/demo/commit/after-commit-sha",
        commit: { committer: { date: "2026-08-06T08:00:00.000Z" } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, options);
  };

  const { createApp } = await import(`../app.js?github-webhook-test=${Date.now()}`);
  const repository = await import("../repositories/appRepository.js");
  const admin = await repository.createUser({ name: "Admin", email: "admin@example.com", password: "testing-password" });
  const pagePackage = await repository.createPackage({
    slug: "live-demo",
    name: "Live Demo",
    version: "v1.0",
    status: "published",
    sourceType: "github",
    repoUrl: "https://github.com/acme/demo",
    packageManifest: {
      schemaVersion: 2,
      entryScreenId: "screen-entry",
      screens: [{
        id: "screen-entry",
        file: "index.html",
        buttonLabel: "Login",
        stage: "form",
        state: "default",
        enabled: true,
        showInRedirects: true,
        needsReview: false,
        order: 0
      }],
      files: [{ path: "index.html", type: "html", size: 120, sha: "index-before" }],
      github: {
        owner: "acme",
        repo: "demo",
        branch: "main",
        folder: "",
        lastSyncedCommitSha: "before-commit-sha"
      }
    }
  });
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const payload = {
    ref: "refs/heads/main",
    before: "before-commit-sha",
    after: "after-commit-sha",
    compare: "https://github.com/acme/demo/compare/before...after",
    created: false,
    deleted: false,
    size: 1,
    distinct_size: 1,
    repository: { full_name: "acme/demo" },
    sender: { login: "octocat" },
    commits: [{ added: ["otp.html"], modified: [], removed: [] }],
    head_commit: { added: ["otp.html"], modified: [], removed: [] }
  };
  const body = JSON.stringify(payload);
  const headers = {
    "X-GitHub-Event": "push",
    "X-GitHub-Delivery": "delivery-structural-001",
    "X-Hub-Signature-256": signature(Buffer.from(body), secret)
  };

  try {
    const invalid = await postJson(baseUrl, "/api/webhooks/github", body, { ...headers, "X-Hub-Signature-256": signature(Buffer.from(`${body}x`), secret) });
    assert.equal(invalid.status, 401);

    const accepted = await postJson(baseUrl, "/api/webhooks/github", body, headers);
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.matchedPackages, 1);
    assert.equal(accepted.body.processedPackages, 1);

    const updatedPackage = await repository.findPackage(pagePackage.id);
    assert.equal(updatedPackage.status, "review");
    assert.equal(updatedPackage.packageManifest.github.health.state, "review");
    assert.equal(updatedPackage.packageManifest.github.lastWebhookDeliveryId, "delivery-structural-001");

    const events = await repository.listGitHubChangeEvents(pagePackage.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].status, "action_required");
    assert.equal(events[0].summary.classification, "screen_review");
    assert.deepEqual(events[0].summary.screens.added, ["otp.html"]);
    assert.equal(await repository.countUnresolvedGitHubChangeEvents(pagePackage.id), 1);

    const notices = await repository.listNotifications(admin.id);
    assert.equal(notices.unreadCount, 1);
    assert.equal(notices.notifications[0].eventType, "github.screen_review");
    assert.equal(notices.notifications[0].metadata.packageId, pagePackage.id);

    const duplicate = await postJson(baseUrl, "/api/webhooks/github", body, headers);
    assert.equal(duplicate.status, 202);
    assert.equal(duplicate.body.duplicatePackages, 1);
    assert.equal((await repository.listGitHubChangeEvents(pagePackage.id)).length, 1);
    assert.equal((await repository.listNotifications(admin.id)).notifications.length, 1);

    assert.equal(await repository.resolveGitHubChangeEventsForPackage(pagePackage.id, "applied"), 1);
    assert.equal((await repository.listGitHubChangeEvents(pagePackage.id))[0].status, "applied");
    assert.equal(await repository.countUnresolvedGitHubChangeEvents(pagePackage.id), 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(databasePath, { force: true });
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
