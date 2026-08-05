import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("runtime config reflects CAPTCHA changes without replacing the launcher", async () => {
  const previous = {
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH,
    NODE_ENV: process.env.NODE_ENV
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-runtime-config-"));
  const dbPath = path.join(tempRoot, "db.json");
  const now = new Date().toISOString();
  const relaySecret = "deuce_runtime_config_test_secret";

  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  process.env.NODE_ENV = "development";

  await fs.writeFile(dbPath, JSON.stringify({
    packages: [{
      id: "package_live",
      slug: "package-live",
      name: "Private GitHub Package",
      version: "v1",
      status: "published",
      sourceType: "github",
      repoUrl: "https://github.com/example/private-package.git",
      packageManifest: {
        thumbnailDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        github: { owner: "example", repo: "private-package", branch: "main" },
        files: ["index.html"],
        screens: [{ file: "index.html", name: "Home", role: "entry" }]
      },
      createdAt: now,
      updatedAt: now
    }],
    userPages: [{
      id: "page_live",
      userId: "user_live",
      packageId: "package_live",
      packageVersion: "v1",
      name: "Live Config Page",
      slug: "live-config-page",
      domain: "client.example",
      status: "active",
      subscription: { adminFreeSubscription: true },
      flow: [],
      configs: {},
      securityConfig: {
        captcha: false,
        domains: ["client.example"],
        turnstile: {
          siteKey: "initial_site_key",
          secretKey: "initial_secret_key",
          displayDomain: "client.example"
        },
        bannedIps: [],
        whitelistIps: [],
        blockedDevices: [],
        vpnProxyRules: {}
      },
      hostingConfig: {
        domain: "client.example",
        connectionType: "cloudflare-worker",
        relaySecret
      },
      resultSettings: { retentionDays: 30 },
      generatedFile: { version: "build-001" },
      createdAt: now,
      updatedAt: now
    }]
  }));

  const repository = await import("../repositories/appRepository.js?runtime-config-repository-test=" + Date.now());
  const { createApp } = await import("../app.js?runtime-config-app-test=" + Date.now());
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = "http://127.0.0.1:" + address.port;

  async function requestLiveConfig() {
    return fetch(baseUrl + "/api/runtime/config?userPageId=page_live", {
      headers: {
        "x-deuce-relay-secret": relaySecret,
        "x-deuce-client-host": "client.example"
      }
    });
  }

  async function requestBranding(secret = relaySecret) {
    return fetch(baseUrl + "/api/runtime/branding?userPageId=page_live", {
      headers: {
        "x-deuce-relay-secret": secret,
        "x-deuce-client-host": "client.example"
      }
    });
  }

  try {
    const initial = await requestLiveConfig();
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get("cache-control"), "no-store");
    const initialBody = await initial.json();
    assert.equal(initialBody.config.security.captcha, false);
    const publicConfig = JSON.stringify(initialBody);
    assert.equal(publicConfig.includes("data:image"), false);
    assert.equal(publicConfig.includes("github.com/example/private-package"), false);

    const branding = await requestBranding();
    assert.equal(branding.status, 200);
    assert.equal(branding.headers.get("content-type"), "image/png");
    assert.equal(branding.headers.get("cache-control"), "no-store");
    assert.equal(branding.headers.get("x-content-type-options"), "nosniff");
    assert.equal(branding.headers.get("cross-origin-resource-policy"), "cross-origin");
    const brandingBytes = Buffer.from(await branding.arrayBuffer());
    assert.equal(brandingBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

    const deniedBranding = await requestBranding("wrong_relay_secret");
    assert.equal(deniedBranding.status, 403);


    await repository.updateUserPageConfig("page_live", {
      securityConfig: {
        captcha: true,
        turnstile: {
          siteKey: "live_site_key",
          secretKey: "live_secret_key",
          displayDomain: "client.example"
        }
      }
    }, "user_live");

    const enabled = await requestLiveConfig();
    assert.equal(enabled.status, 200);
    const enabledBody = await enabled.json();
    assert.equal(enabledBody.config.security.captcha, true);
    assert.equal(enabledBody.config.security.turnstile.enabled, true);
    assert.equal(enabledBody.config.security.turnstile.siteKey, "live_site_key");
    assert.equal(JSON.stringify(enabledBody).includes("live_secret_key"), false);

    await repository.updateUserPageConfig("page_live", {
      securityConfig: { captcha: false }
    }, "user_live");

    const disabled = await requestLiveConfig();
    assert.equal(disabled.status, 200);
    const disabledBody = await disabled.json();
    assert.equal(disabledBody.config.security.captcha, false);
    assert.equal(disabledBody.config.security.turnstile.enabled, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("generated launchers refresh live security before booting", async () => {
  const source = await fs.readFile(path.resolve(process.cwd(), "script.js"), "utf8");
  assert.equal((source.match(/async function refreshLiveConfig\(\)/g) || []).length, 2);
  assert.equal((source.match(/fetch\(config\.runtime\.configEndpoint/g) || []).length, 2);
  assert.equal((source.match(/\/branding\?userPageId=/g) || []).length, 2);
  assert.match(source, /id="deuceGateLogo"/);
  assert.match(source, /id="captchaBrandImage"/);
  assert.equal((source.match(/Protected by Cloudflare Turnstile/g) || []).length, 2);
  assert.match(source, /Confirming verification\.\.\./);
  assert.match(source, /Verification failed\. Please try again\./);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /sessionId,/);
  assert.match(source, /config\.security\?\.captchaRequired/);
  assert.ok((source.match(/cache: "no-store"/g) || []).length >= 2);
  assert.ok((source.match(/SECURITY CONFIGURATION UNAVAILABLE/g) || []).length >= 2);
  assert.match(source, /await withButtonBusy\(saveSecurityButton, "Saving"/);
  assert.match(source, /SECURITY SETTINGS SAVED \/ LIVE ON NEXT REFRESH/);
});
