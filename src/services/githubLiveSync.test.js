import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedGithubRuntimeFile, scanGitHubRepository } from "./githubImport.js";
import { createPersistentFieldManifest } from "./resultCapture.js";
import {
  checkGitHubLivePackage,
  diffGitHubFileInventory,
  githubScreenDrift,
  publicGitHubLiveStatus,
  reconcileGitHubScreenManifest
} from "./githubLiveSync.js";

const pagePackage = {
  id: "pkg_live",
  slug: "live-page",
  sourceType: "github",
  repoUrl: "https://github.com/example/live-page",
  packageManifest: {
    github: { owner: "example", repo: "live-page", branch: "main" },
    files: [
      { path: "index.html", type: "html", size: 10, sha: "sha-entry" },
      { path: "sms.html", type: "html", size: 12, sha: "sha-otp" },
      { path: "old.html", type: "html", size: 9, sha: "sha-old" },
      { path: "style.css", type: "css", size: 8, sha: "sha-css" }
    ],
    screens: [
      { id: "scr_entry", file: "index.html", buttonLabel: "Sign in", stage: "form", enabled: true, showInRedirects: true },
      { id: "scr_otp", file: "sms.html", buttonLabel: "Security code", stage: "verification", enabled: true, showInRedirects: true },
      { id: "scr_old", file: "old.html", buttonLabel: "Old screen", stage: "other", enabled: true, showInRedirects: true }
    ],
    entryScreenId: "scr_entry"
  }
};

const scan = {
  files: [
    { path: "index.html", type: "html", size: 11, sha: "sha-entry-edited" },
    { path: "verify.html", type: "html", size: 12, sha: "sha-otp" },
    { path: "done.html", type: "html", size: 7, sha: "sha-done" },
    { path: "style.css", type: "css", size: 8, sha: "sha-css" }
  ]
};

test("diffs live GitHub files and recognizes blob-preserving renames", () => {
  const diff = diffGitHubFileInventory(pagePackage.packageManifest.files, scan.files);

  assert.equal(diff.renamed.length, 1);
  assert.deepEqual(diff.renamed[0], {
    previous: pagePackage.packageManifest.files[1],
    current: scan.files[1]
  });
  assert.deepEqual(diff.added.map((file) => file.path), ["done.html"]);
  assert.deepEqual(diff.removed.map((file) => file.path), ["old.html"]);
  assert.deepEqual(diff.modified.map(({ current }) => current.path), ["index.html"]);
  assert.equal(diff.changed, true);
});

test("reconciles structural drift without losing custom screen identity", () => {
  const diff = diffGitHubFileInventory(pagePackage.packageManifest.files, scan.files);
  const drift = githubScreenDrift(pagePackage, scan, diff);
  const { manifest } = reconcileGitHubScreenManifest(pagePackage, scan, diff);

  assert.deepEqual(drift.renamedScreens, [{ from: "sms.html", to: "verify.html" }]);
  assert.deepEqual(drift.addedScreens, ["done.html"]);
  assert.deepEqual(drift.missingScreens, ["old.html"]);
  assert.deepEqual(drift.modifiedScreens, ["index.html"]);
  assert.equal(drift.hasStructuralChanges, true);

  const renamed = manifest.screens.find((screen) => screen.file === "verify.html");
  assert.equal(renamed.id, "scr_otp");
  assert.equal(renamed.buttonLabel, "Security code");
  assert.equal(renamed.needsReview, true);

  const missing = manifest.screens.find((screen) => screen.id === "scr_old");
  assert.equal(missing.enabled, false);
  assert.equal(missing.showInRedirects, false);
  assert.equal(missing.needsReview, true);

  const added = manifest.screens.find((screen) => screen.file === "done.html");
  assert.equal(added.enabled, false);
  assert.equal(added.showInRedirects, false);
  assert.equal(added.needsReview, true);
  assert.equal(manifest.entryScreenId, "scr_entry");
});

test("detects and reconciles field-level drift on an existing screen", () => {
  const previousFields = createPersistentFieldManifest(
    '<form><input name="email" aria-label="Email"></form>',
    { screenFile: "index.html", screenId: "scr_entry" }
  );
  previousFields.fields[0].label = "Account email";
  const currentFields = createPersistentFieldManifest(
    '<form><input name="email" aria-label="Email"><select name="country" aria-label="Country"></select></form>',
    { screenFile: "index.html", screenId: "scr_entry" }
  );
  const currentPackage = {
    ...pagePackage,
    packageManifest: {
      ...pagePackage.packageManifest,
      screens: pagePackage.packageManifest.screens.map((screen) => (
        screen.id === "scr_entry" ? { ...screen, fieldManifest: previousFields } : screen
      ))
    }
  };
  const currentScan = {
    ...scan,
    screenManifest: {
      screens: [{ id: "scr_entry", file: "index.html", fieldManifest: currentFields }]
    }
  };
  const diff = diffGitHubFileInventory(currentPackage.packageManifest.files, currentScan.files);
  const drift = githubScreenDrift(currentPackage, currentScan, diff);
  const reconciled = reconcileGitHubScreenManifest(currentPackage, currentScan, diff);
  assert.equal(drift.hasFieldChanges, true);
  assert.equal(drift.requiresReview, true);
  assert.equal(drift.fieldChanges[0].added.length, 1);
  const entry = reconciled.manifest.screens.find((screen) => screen.id === "scr_entry");
  assert.equal(entry.fieldManifest.fields[0].label, "Account email");
  assert.equal(entry.fieldManifest.fields.length, 2);
  assert.equal(entry.needsReview, true);
});

test("GitHub runtime inventory excludes repository and secret files", () => {
  assert.equal(isAllowedGithubRuntimeFile("public/index.html"), true);
  assert.equal(isAllowedGithubRuntimeFile("public/app.js"), true);
  assert.equal(isAllowedGithubRuntimeFile("package.json"), false);
  assert.equal(isAllowedGithubRuntimeFile("public/credentials.json"), false);
  assert.equal(isAllowedGithubRuntimeFile(".github/workflows/deploy.yml"), false);
  assert.equal(isAllowedGithubRuntimeFile("server.js.map"), false);
});

test("GitHub import maps result fields from HTML blobs", async () => {
  const originalFetch = global.fetch;
  const html = '<form><input name="full_name" aria-label="Full name"><select name="country" aria-label="Country"></select></form>';
  global.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith("/repos/example/field-page")) return Response.json({ default_branch: "main" });
    if (href.includes("/git/trees/main")) {
      return Response.json({
        sha: "tree-fields",
        truncated: false,
        tree: [{ path: "index.html", type: "blob", size: Buffer.byteLength(html), sha: "sha-fields" }]
      });
    }
    if (href.includes("/git/blobs/sha-fields")) {
      return Response.json({ encoding: "base64", content: Buffer.from(html).toString("base64") });
    }
    if (href.includes("/commits/main")) {
      return Response.json({ sha: "commit-fields", commit: { committer: { date: "2026-08-06T10:00:00.000Z" } } });
    }
    return Response.json({ message: "not found" }, { status: 404 });
  };
  try {
    const imported = await scanGitHubRepository({ repoUrl: "https://github.com/example/field-page", branch: "main" });
    assert.equal(imported.screenManifest.screens[0].fieldManifest.fields.length, 2);
    assert.equal(imported.summary.fields, 2);
    assert.equal(imported.screenManifest.screens[0].fieldManifest.fields[1].type, "select");
  } finally {
    global.fetch = originalFetch;
  }
});

test("admin status responses omit the internal scan payload", () => {
  const status = publicGitHubLiveStatus({ currentCommitSha: "abc", scan: { files: [{ path: "index.html" }] } });
  assert.equal(status.currentCommitSha, "abc");
  assert.equal("scan" in status, false);
});

test("checks the configured mutable branch and returns commit-level drift", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith("/repos/example/live-page")) {
      return Response.json({ default_branch: "main" });
    }
    if (href.includes("/git/trees/main")) {
      return Response.json({
        sha: "tree-latest",
        truncated: false,
        tree: [
          { path: "index.html", type: "blob", size: 11, sha: "sha-entry-edited" },
          { path: "sms.html", type: "blob", size: 12, sha: "sha-otp" },
          { path: "old.html", type: "blob", size: 9, sha: "sha-old" },
          { path: "style.css", type: "blob", size: 8, sha: "sha-css" }
        ]
      });
    }
    if (href.includes("/commits/main")) {
      return Response.json({
        sha: "commit-latest",
        html_url: "https://github.com/example/live-page/commit/commit-latest",
        commit: { committer: { date: "2026-08-06T10:00:00.000Z" }, tree: { sha: "tree-latest" } }
      });
    }
    return Response.json({ message: "not found" }, { status: 404 });
  };

  try {
    const status = await checkGitHubLivePackage({
      ...pagePackage,
      packageManifest: {
        ...pagePackage.packageManifest,
        github: {
          ...pagePackage.packageManifest.github,
          lastSyncedCommitSha: "commit-previous",
          lastSyncedAt: "2026-08-05T10:00:00.000Z"
        }
      }
    });
    assert.equal(status.branch, "main");
    assert.equal(status.currentCommitSha, "commit-latest");
    assert.equal(status.commitChanged, true);
    assert.deepEqual(status.fileDiff.modified.map(({ current }) => current.path), ["index.html"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("live checks do not silently fall back from the configured branch", async () => {
  const originalFetch = global.fetch;
  let mainTreeRequested = false;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith("/repos/example/live-page")) return Response.json({ default_branch: "main" });
    if (href.includes("/git/trees/main")) mainTreeRequested = true;
    return Response.json({ message: "Not Found" }, { status: 404 });
  };

  try {
    await assert.rejects(() => checkGitHubLivePackage({
      ...pagePackage,
      packageManifest: {
        ...pagePackage.packageManifest,
        github: { ...pagePackage.packageManifest.github, branch: "release" }
      }
    }), /release/);
    assert.equal(mainTreeRequested, false);
  } finally {
    global.fetch = originalFetch;
  }
});
