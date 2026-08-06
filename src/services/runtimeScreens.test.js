import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuntimePackageSnapshot,
  runtimePackageForUserPage,
  runtimeRedirectScreensFromPackage,
  runtimeScreenForFile,
  runtimeScreenForId,
  runtimeScreensFromPackage,
  runtimeScreenTargetUrl
} from "./runtimeScreens.js";

const importedPackage = {
  id: "pkg_local",
  slug: "local-page",
  name: "Local page",
  version: "v2",
  sourceType: "r2",
  updatedAt: "2026-07-28T10:00:00.000Z",
  packageManifest: {
    schemaVersion: 2,
    entryScreenId: "scr_login",
    finalScreenId: "scr_complete",
    r2: { prefix: "packages/local-page/v2/import-1" },
    files: [
      { path: "index.html", type: "html" },
      { path: "steps/verify-code.html", type: "html" },
      { path: "complete.htm", type: "html" },
      { path: "styles/app.css", type: "css" }
    ],
    screens: [
      { id: "scr_verify", file: "steps/verify-code.html", buttonLabel: "Verify code", stage: "verification", state: "default", enabled: true, showInRedirects: true, order: 0 },
      { id: "scr_login", file: "index.html", buttonLabel: "Sign in", stage: "form", state: "default", enabled: true, showInRedirects: true, order: 1 },
      { id: "scr_complete", file: "complete.htm", buttonLabel: "Complete", stage: "success", state: "default", enabled: true, showInRedirects: false, order: 2 }
    ]
  }
};

test("keeps every mapped HTML screen in saved package order", () => {
  const screens = runtimeScreensFromPackage(importedPackage);
  assert.deepEqual(screens.map((screen) => screen.file), [
    "steps/verify-code.html",
    "index.html",
    "complete.htm"
  ]);
  assert.deepEqual(screens.map((screen) => screen.name), ["Verify code", "Sign in", "Complete"]);
  assert.deepEqual(screens.map((screen) => screen.role), ["verification", "entry", "success"]);
  assert.deepEqual(runtimeRedirectScreensFromPackage(importedPackage).map((screen) => screen.id), ["scr_verify", "scr_login"]);
  assert.equal(runtimeScreenForId(importedPackage, "scr_complete")?.file, "complete.htm");
});

test("does not invent canonical or fallback screens", () => {
  const otpOnly = {
    packageManifest: {
      files: [{ path: "otp.html" }],
      screens: [{ file: "otp.html", name: "OTP" }]
    }
  };
  assert.deepEqual(runtimeScreensFromPackage(otpOnly).map((screen) => screen.file), ["otp.html"]);
  assert.equal(runtimeScreenForFile(otpOnly, "otp2.html"), null);
});

test("rejects unmapped, missing, and traversal redirect targets", () => {
  assert.equal(runtimeScreenForFile(importedPackage, "missing.html"), null);
  assert.equal(runtimeScreenForFile(importedPackage, "../index.html"), null);
  assert.equal(runtimeScreenForFile(importedPackage, "styles/app.css"), null);
  assert.equal(runtimeScreenForFile(importedPackage, "STEPS/VERIFY-CODE.HTML")?.file, "steps/verify-code.html");
});

test("creates a stable subscription snapshot and server runtime URL", () => {
  const snapshot = createRuntimePackageSnapshot(importedPackage);
  const userPage = { configs: { runtimePackageSnapshot: snapshot } };
  const selected = runtimePackageForUserPage(userPage, { ...importedPackage, version: "v3" });
  assert.equal(selected.version, "v2");
  assert.equal(selected.packageManifest.r2.prefix, "packages/local-page/v2/import-1");
  assert.equal(
    runtimeScreenTargetUrl("user_page_1", "steps/verify-code.html"),
    "/api/runtime/source?userPageId=user_page_1&file=steps%2Fverify-code.html"
  );
});
