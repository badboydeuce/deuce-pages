import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("page-list visibility is owner-only and remains editable after subscription expiry", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-page-preferences-"));
  const dbPath = path.join(tempRoot, "db.json");
  const ownerToken = "page-preferences-owner-token";
  const otherToken = "page-preferences-other-token";
  const now = new Date().toISOString();

  process.env.NODE_ENV = "test";
  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;

  await fs.writeFile(dbPath, JSON.stringify({
    users: [
      { id: "user_owner", name: "Owner", email: "owner@example.com", role: "subscriber", status: "active", walletBalance: 0, collaboration: {}, createdAt: now, updatedAt: now },
      { id: "user_other", name: "Other", email: "other@example.com", role: "subscriber", status: "active", walletBalance: 0, collaboration: {}, createdAt: now, updatedAt: now }
    ],
    sessions: [
      { id: "session_owner", userId: "user_owner", tokenHash: createHash("sha256").update(ownerToken).digest("hex"), expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now },
      { id: "session_other", userId: "user_other", tokenHash: createHash("sha256").update(otherToken).digest("hex"), expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now }
    ],
    userPages: [{
      id: "page_preferences",
      userId: "user_owner",
      packageId: "pkg_preferences",
      packageVersion: "v1",
      name: "Preference Page",
      slug: "preference-page",
      domain: "",
      status: "active",
      subscription: { billingPeriod: "weekly", renewalDate: "2000-01-01", renewalStatus: "expired" },
      flow: [],
      configs: {},
      securityConfig: {},
      hostingConfig: {},
      resultSettings: {},
      generatedFile: {},
      uiPreferences: {},
      createdAt: now,
      updatedAt: now
    }]
  }));

  const { createApp } = await import(`../app.js?page-preferences-test=${Date.now()}`);
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const updatePreference = (token, value) => fetch(`${baseUrl}/api/user-pages/page_preferences/ui-preferences`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ hiddenInMyPages: value })
  });

  try {
    const hidden = await updatePreference(ownerToken, true);
    assert.equal(hidden.status, 200);
    const hiddenBody = await hidden.json();
    assert.equal(hiddenBody.userPage.uiPreferences.hiddenInMyPages, true);
    assert.ok(hiddenBody.userPage.uiPreferences.hiddenAt);
    assert.equal(hiddenBody.userPage.subscriptionState.status, "expired");
    assert.equal(hiddenBody.userPage.capabilities.editConfig, false);

    const denied = await updatePreference(otherToken, false);
    assert.equal(denied.status, 404);

    const invalid = await fetch(`${baseUrl}/api/user-pages/page_preferences/ui-preferences`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hiddenInMyPages: "yes" })
    });
    assert.equal(invalid.status, 400);

    const restored = await updatePreference(ownerToken, false);
    assert.equal(restored.status, 200);
    const restoredBody = await restored.json();
    assert.equal(restoredBody.userPage.uiPreferences.hiddenInMyPages, false);
    assert.equal(restoredBody.userPage.uiPreferences.hiddenAt, null);

    const persisted = JSON.parse(await fs.readFile(dbPath, "utf8"));
    const storedPage = persisted.userPages.find((page) => page.id === "page_preferences");
    assert.equal(storedPage.status, "active");
    assert.equal(storedPage.uiPreferences.hiddenInMyPages, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.LOCAL_JSON_DB === undefined) delete process.env.LOCAL_JSON_DB;
    else process.env.LOCAL_JSON_DB = previous.LOCAL_JSON_DB;
    if (previous.JSON_DB_PATH === undefined) delete process.env.JSON_DB_PATH;
    else process.env.JSON_DB_PATH = previous.JSON_DB_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
