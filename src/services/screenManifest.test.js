import assert from "node:assert/strict";
import test from "node:test";
import {
  createScreenManifestV2,
  screenManifestV2ForPackage,
  validateScreenManifestV2
} from "./screenManifest.js";

test("creates flexible screen mappings without requiring index.html", () => {
  const manifest = createScreenManifestV2({
    packageKey: "flexible-page",
    screens: [
      { file: "start.htm", buttonLabel: "Login", stage: "form" },
      { file: "sms.html", buttonLabel: "OTP", stage: "verification" },
      { file: "pin.html", buttonLabel: "4-Digit PIN", stage: "verification" }
    ]
  });

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.screens.length, 3);
  assert.equal(manifest.entryScreenId, manifest.screens[0].id);
  assert.equal(manifest.screens[1].buttonLabel, "OTP");
  assert.match(manifest.screenRevision, /^sha256:[a-f0-9]{64}$/);
});

test("keeps entry and final selection independent from screen order", () => {
  const manifest = createScreenManifestV2({
    packageKey: "ordered-page",
    entryScreenId: "scr_login",
    finalScreenId: "scr_success",
    screens: [
      { id: "scr_otp", file: "sms.html", buttonLabel: "OTP", stage: "verification", order: 0 },
      { id: "scr_login", file: "index.html", buttonLabel: "Login", stage: "form", order: 1 },
      { id: "scr_success", file: "done.html", buttonLabel: "Success", stage: "success", order: 2 }
    ]
  });

  assert.equal(manifest.screens[0].id, "scr_otp");
  assert.equal(manifest.entryScreenId, "scr_login");
  assert.equal(manifest.finalScreenId, "scr_success");
});

test("adapts legacy mappings and produces stable ids", () => {
  const pagePackage = {
    id: "pkg_legacy",
    packageManifest: {
      files: [{ path: "index.html" }, { path: "sms2.html" }],
      screens: [
        { file: "index.html", name: "Login", role: "entry" },
        { file: "sms2.html", name: "OTP Error", role: "verification" }
      ]
    }
  };
  const first = screenManifestV2ForPackage(pagePackage);
  const second = screenManifestV2ForPackage(pagePackage);

  assert.deepEqual(first, second);
  assert.equal(first.screens[1].state, "error");
  assert.equal(first.entryScreenId, first.screens[0].id);
});

test("derives legacy screen files when top-level screens contain display names", () => {
  const manifest = screenManifestV2ForPackage({
    id: "pkg_labels_only",
    screens: ["Login", "OTP"],
    packageManifest: {
      files: [{ path: "start.htm" }, { path: "sms.html" }]
    }
  });
  assert.deepEqual(manifest.screens.map((screen) => screen.file), ["start.htm", "sms.html"]);
  assert.deepEqual(manifest.screens.map((screen) => screen.buttonLabel), ["Login", "OTP"]);
});

test("publishing rejects duplicate redirect names and missing files", () => {
  const pagePackage = {
    id: "pkg_invalid",
    packageManifest: {
      schemaVersion: 2,
      files: [{ path: "login.html" }],
      screens: [
        { id: "scr_login", file: "login.html", buttonLabel: "Login", stage: "form", enabled: true, showInRedirects: true },
        { id: "scr_error", file: "login2.html", buttonLabel: "Login", stage: "form", state: "error", enabled: true, showInRedirects: true }
      ],
      entryScreenId: "scr_login"
    }
  };
  const validation = validateScreenManifestV2(pagePackage, { publishing: true });

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.includes("missing from the package")));
  assert.ok(validation.issues.some((issue) => issue.includes("Duplicate redirect button name")));
});

test("screen revision ignores unrelated package metadata", () => {
  const base = {
    id: "pkg_revision",
    packageManifest: {
      files: [{ path: "login.html" }],
      screens: [{ id: "scr_login", file: "login.html", buttonLabel: "Login", stage: "form" }],
      entryScreenId: "scr_login"
    }
  };
  const first = screenManifestV2ForPackage({ ...base, name: "Package A", billingPeriods: { weekly: 20 } });
  const second = screenManifestV2ForPackage({ ...base, name: "Package B", billingPeriods: { weekly: 40 } });
  assert.equal(first.screenRevision, second.screenRevision);
});
