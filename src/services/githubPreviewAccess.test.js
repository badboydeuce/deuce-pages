import assert from "node:assert/strict";
import test from "node:test";
import {
  createGitHubPreviewTicket,
  normalizeGitHubFilePath,
  verifyGitHubPreviewTicket
} from "./githubPreviewAccess.js";
import { normalizeRepoUrl } from "./githubImport.js";

const env = {
  NODE_ENV: "production",
  GITHUB_PREVIEW_SECRET: "test-only-preview-secret-with-enough-entropy"
};
const now = Date.parse("2026-07-31T12:00:00Z");

test("creates short-lived GitHub preview tickets bound to one exact file", () => {
  const ticket = createGitHubPreviewTicket({
    repoUrl: "https://github.com/example/site",
    branch: "main",
    file: "pages/index.html",
    kind: "page",
    userId: "admin-1"
  }, { env, now });

  const access = verifyGitHubPreviewTicket(ticket, "page", { env, now: now + 60_000 });
  assert.deepEqual(access, {
    repoUrl: "https://github.com/example/site",
    owner: "example",
    repo: "site",
    branch: "main",
    file: "pages/index.html",
    userId: "admin-1",
    expiresAt: Math.floor(now / 1000) + 300
  });
  assert.throws(() => verifyGitHubPreviewTicket(ticket, "asset", { env, now }), /authorization/i);
});

test("rejects tampered and expired GitHub preview tickets", () => {
  const ticket = createGitHubPreviewTicket({
    repoUrl: "https://github.com/example/site",
    branch: "main",
    file: "index.html",
    kind: "page"
  }, { env, now });

  assert.throws(() => verifyGitHubPreviewTicket(`${ticket}x`, "page", { env, now }), /authorization/i);
  assert.throws(() => verifyGitHubPreviewTicket(ticket, "page", { env, now: now + 301_000 }), /expired/i);
});

test("rejects lookalike GitHub hosts and unsafe file paths", () => {
  assert.throws(() => normalizeRepoUrl("https://attacker.example/github.com/owner/repo"), /valid GitHub/i);
  assert.throws(() => normalizeRepoUrl("https://github.com.attacker.example/owner/repo"), /valid GitHub/i);
  assert.throws(() => normalizeGitHubFilePath("../secret.txt"), /file path/i);
  assert.throws(() => normalizeGitHubFilePath("assets\\app.js"), /file path/i);
});
