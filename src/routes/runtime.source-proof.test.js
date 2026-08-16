import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createChallengeProof,
  createSourceChallengeProof,
  verifyChallengeProof,
  verifySourceChallengeProof
} from "../services/challengeProof.js";
import { verifyResultFieldManifest } from "../services/resultCapture.js";

test("source proofs are scoped and cannot be reused as session proofs", () => {
  const identity = { userPageId: "page_scope", ip: "127.0.0.1" };
  const sourceProof = createSourceChallengeProof(identity);
  const sessionProof = createChallengeProof({ ...identity, sessionId: "session_scope" });

  assert.equal(verifySourceChallengeProof(sourceProof, identity), true);
  assert.equal(verifySourceChallengeProof(sessionProof, identity), false);
  assert.equal(verifySourceChallengeProof(sourceProof, { ...identity, userPageId: "other_page" }), false);
  assert.equal(verifySourceChallengeProof(sourceProof, { ...identity, ip: "127.0.0.2" }), false);
  assert.equal(verifyChallengeProof(sourceProof, { ...identity, sessionId: "" }), false);
  assert.equal(verifyChallengeProof(sessionProof, { ...identity, sessionId: "session_scope" }), true);
});

test("runtime source and assets require a verified HttpOnly proof", async () => {
  const previous = {
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH,
    NODE_ENV: process.env.NODE_ENV,
    RENDER: process.env.RENDER,
    RENDER_SERVICE_TYPE: process.env.RENDER_SERVICE_TYPE,
    IP_REPUTATION_DISABLED: process.env.IP_REPUTATION_DISABLED,
    CHALLENGE_PROOF_SECRET: process.env.CHALLENGE_PROOF_SECRET,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_ENDPOINT: process.env.R2_ENDPOINT
  };
  const originalFetch = globalThis.fetch;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-source-proof-"));
  const dbPath = path.join(tempRoot, "db.json");
  const now = new Date().toISOString();
  const relaySecret = "source_proof_relay_secret";
  let packageFetches = 0;

  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  process.env.NODE_ENV = "development";
  process.env.RENDER = "true";
  process.env.RENDER_SERVICE_TYPE = "web";
  process.env.IP_REPUTATION_DISABLED = "true";
  process.env.CHALLENGE_PROOF_SECRET = "source-proof-test-secret";
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.R2_BUCKET_NAME = "test-private-bucket";
  process.env.R2_ENDPOINT = "https://test-account.r2.cloudflarestorage.com";

  await fs.writeFile(dbPath, JSON.stringify({
    packages: [{
      id: "package_proof",
      slug: "package-proof",
      name: "Protected Package",
      version: "v1",
      status: "published",
      sourceType: "github",
      repoUrl: "https://github.com/example/protected-package.git",
      packageManifest: {
        github: { owner: "example", repo: "protected-package", branch: "main" },
        files: ["index.html", "assets/logo.png"],
        screens: [{
          id: "screen_home",
          file: "index.html",
          name: "Home",
          role: "entry",
          fieldManifest: {
            fields: [{ id: "legacy_email", label: "Email", type: "email", scopeId: "page", enabled: true }]
          }
        }]
      },
      createdAt: now,
      updatedAt: now
    }],
    userPages: [{
      id: "page_proof",
      userId: "user_proof",
      packageId: "package_proof",
      packageVersion: "v1",
      name: "Protected Page",
      slug: "protected-page",
      domain: "client.example",
      status: "active",
      subscription: { adminFreeSubscription: true },
      flow: [],
      configs: {},
      securityConfig: {
        captcha: false,
        contentDeterrence: true,
        domains: ["client.example"],
        turnstile: {
          siteKey: "source_proof_site_key",
          secretKey: "source_proof_secret_key",
          displayDomain: "client.example"
        },
        bannedIps: [],
        whitelistIps: [],
        blockedDevices: [],
        vpnProxyRules: {
          blockVpnProxies: true,
          reputationFailureMode: "challenge"
        }
      },
      hostingConfig: {
        domain: "client.example",
        connectionType: "cloudflare-worker",
        relaySecret
      },
      resultSettings: { retentionDays: 30 },
      generatedFile: { version: "proof-build" },
      createdAt: now,
      updatedAt: now
    }]
  }));

  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.startsWith("https://raw.githubusercontent.com/")) {
      packageFetches += 1;
      if (url.endsWith("assets/logo.png")) {
        return new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      return new Response(`<!doctype html><html><body><img src="assets/logo.png"><h1>Protected source</h1>
        <form><input name="email" type="email"><input name="id_front" aria-label="ID Front" type="file"><input name="id_back" aria-label="ID Back" type="file"></form>
      </body></html>`, {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    }
    return originalFetch(input, init);
  };

  const { createApp } = await import("../app.js?runtime-source-proof-test=" + Date.now());
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = "http://127.0.0.1:" + address.port;
  const relayHeaders = {
    "x-deuce-relay-secret": relaySecret,
    "x-deuce-client-host": "client.example",
    "x-deuce-client-ip": "198.51.100.80"
  };

  try {
    const config = await originalFetch(baseUrl + "/api/runtime/config?userPageId=page_proof", {
      headers: relayHeaders
    });
    assert.equal(config.status, 200);
    const configBody = await config.json();
    assert.equal(configBody.config.security.captcha, false);
    assert.equal(configBody.config.security.contentDeterrence, true);
    assert.equal(configBody.config.security.challengeRequired, true);
    assert.equal(configBody.config.security.captchaRequired, true);
    assert.equal(configBody.config.security.turnstile.enabled, true);

    const directSource = await originalFetch(baseUrl + "/api/runtime/source?userPageId=page_proof", {
      headers: relayHeaders
    });
    assert.equal(directSource.status, 403);
    assert.equal(packageFetches, 0);

    const verification = await originalFetch(baseUrl + "/api/runtime/verify-human", {
      method: "POST",
      headers: { ...relayHeaders, "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.10" },
      body: JSON.stringify({
        userPageId: "page_proof",
        hostname: "client.example",
        sessionId: "session_proof",
        token: "valid_turnstile_token"
      })
    });
    assert.equal(verification.status, 200);
    const verificationBody = await verification.json();
    assert.equal(verificationBody.verified, true);
    assert.ok(verificationBody.challengeProof);
    const setCookie = verification.headers.get("set-cookie") || "";
    assert.match(setCookie, /^deuce_source_proof=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api/i);
    const sourceCookie = setCookie.split(";")[0];

    const invalidProof = await originalFetch(baseUrl + "/api/runtime/source?userPageId=page_proof", {
      headers: { ...relayHeaders, Cookie: "deuce_source_proof=tampered", "X-Forwarded-For": "203.0.113.11" }
    });
    assert.equal(invalidProof.status, 403);
    assert.equal(packageFetches, 0);

    const verifiedSource = await originalFetch(baseUrl + "/api/runtime/source?userPageId=page_proof", {
      headers: { ...relayHeaders, Cookie: sourceCookie, "X-Forwarded-For": "203.0.113.12" }
    });
    assert.equal(verifiedSource.status, 200);
    const verifiedSourceHtml = await verifiedSource.text();
    assert.match(verifiedSourceHtml, /Protected source/);
    assert.match(verifiedSourceHtml, /contentDeterrence: true/);
    assert.match(verifiedSourceHtml, /addEventListener\("contextmenu"/);
    assert.match(verifiedSourceHtml, /send\("uploads\/start"/);
    assert.match(verifiedSourceHtml, /attachmentIds: attachmentIds \|\| \[\]/);
    assert.match(verifiedSourceHtml, /uploadSelectedFiles\(inputs\)/);
    const manifestToken = verifiedSourceHtml.match(/fieldManifestToken:\s*"([^"]+)"/)?.[1];
    assert.ok(manifestToken);
    const resultManifest = verifyResultFieldManifest(manifestToken, { userPageId: "page_proof", screenFile: "index.html" });
    assert.deepEqual(resultManifest.fields.map((field) => field.type), ["email", "file", "file"]);
    const uploadField = resultManifest.fields.find((field) => field.type === "file");
    const uploadStart = await originalFetch(baseUrl + "/api/runtime/uploads/start", {
      method: "POST",
      headers: { ...relayHeaders, Cookie: sourceCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        userPageId: "page_proof",
        hostname: "client.example",
        sessionId: "session_proof",
        screenFile: "index.html",
        fieldId: uploadField.id,
        manifestToken,
        manifestRevision: resultManifest.revision,
        mimeType: "image/png",
        sizeBytes: 1024
      })
    });
    assert.equal(uploadStart.status, 201);
    const uploadBody = await uploadStart.json();
    assert.equal(new URL(uploadBody.uploadUrl).hostname, "test-private-bucket.test-account.r2.cloudflarestorage.com");
    assert.equal(uploadBody.uploadHeaders["Content-Type"], "image/png");
    assert.equal(uploadBody.attachment.mimeType, "image/png");
    assert.equal(Object.hasOwn(uploadBody.attachment, "objectKey"), false);
    assert.equal(packageFetches, 1);

    const directAsset = await originalFetch(baseUrl + "/api/runtime/source/asset?userPageId=page_proof&file=assets%2Flogo.png", {
      headers: { ...relayHeaders, "X-Forwarded-For": "203.0.113.13" }
    });
    assert.equal(directAsset.status, 403);
    assert.equal(packageFetches, 1);

    const verifiedAsset = await originalFetch(baseUrl + "/api/runtime/source/asset?userPageId=page_proof&file=assets%2Flogo.png", {
      headers: { ...relayHeaders, Cookie: sourceCookie, "X-Forwarded-For": "203.0.113.14" }
    });
    assert.equal(verifiedAsset.status, 200);
    assert.equal(packageFetches, 2);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
