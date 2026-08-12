import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("server-side traffic reporting records denied visits and returns unique-session totals", async () => {
  const previous = {
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH,
    NODE_ENV: process.env.NODE_ENV,
    RENDER: process.env.RENDER,
    RENDER_SERVICE_TYPE: process.env.RENDER_SERVICE_TYPE,
    IP_REPUTATION_DISABLED: process.env.IP_REPUTATION_DISABLED
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-traffic-report-"));
  const dbPath = path.join(tempRoot, "db.json");
  const now = new Date().toISOString();
  const relaySecret = "traffic_report_relay_secret";

  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  process.env.NODE_ENV = "development";
  process.env.RENDER = "true";
  process.env.RENDER_SERVICE_TYPE = "web";
  process.env.IP_REPUTATION_DISABLED = "true";

  await fs.writeFile(dbPath, JSON.stringify({
    users: [{
      id: "user_traffic",
      email: "traffic@example.test",
      name: "Traffic User",
      passwordHash: "unused",
      role: "subscriber",
      status: "active",
      createdAt: now
    }],
    sessions: [{
      id: "auth_traffic",
      userId: "user_traffic",
      tokenHash: "1f3a07b0207b3b4946a6a7f86422caa550448f766e3c6161263d6bb009ef20d5",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now
    }],
    userPages: [{
      id: "page_traffic",
      userId: "user_traffic",
      packageId: "package_traffic",
      packageVersion: "v1",
      name: "Traffic Page",
      slug: "traffic-page",
      domain: "client.example",
      status: "active",
      subscription: { adminFreeSubscription: true },
      securityConfig: {
        bannedIps: ["198.51.100.44"],
        whitelistIps: [],
        blockedDevices: [],
        vpnProxyRules: {}
      },
      hostingConfig: { domain: "client.example", relaySecret },
      resultSettings: { retentionDays: 30 },
      createdAt: now,
      updatedAt: now
    }],
    trafficEvents: []
  }));

  const originalToken = "traffic_test_token";
  const crypto = await import("node:crypto");
  const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
  db.sessions[0].tokenHash = crypto.createHash("sha256").update(originalToken).digest("hex");
  await fs.writeFile(dbPath, JSON.stringify(db));

  const { createApp } = await import("../app.js?traffic-report-test=" + Date.now());
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  const relayHeaders = {
    "Content-Type": "application/json",
    "x-deuce-relay-secret": relaySecret,
    "x-deuce-client-host": "client.example",
    "x-deuce-client-ip": "198.51.100.44"
  };

  try {
    const denied = await fetch(baseUrl + "/api/runtime/config?userPageId=page_traffic&sessionId=session_blocked", {
      headers: relayHeaders
    });
    assert.equal(denied.status, 403);

    const allowedIp = { ...relayHeaders, "x-deuce-client-ip": "198.51.100.45" };
    for (const event of ["page_load", "screen_view"]) {
      const response = await fetch(baseUrl + "/api/runtime/traffic", {
        method: "POST",
        headers: allowedIp,
        body: JSON.stringify({
          userPageId: "page_traffic",
          sessionId: "session_allowed",
          hostname: "client.example",
          event
        })
      });
      assert.equal(response.status, 201);
    }

    const report = await fetch(baseUrl + "/api/user-pages/page_traffic/traffic?limit=100", {
      headers: { Cookie: `deuce_session=${originalToken}` }
    });
    assert.equal(report.status, 200);
    const body = await report.json();
    assert.equal(body.trafficSummary.uniqueVisits, 2);
    assert.equal(body.trafficSummary.cleanVisits, 1);
    assert.equal(body.trafficSummary.blockedVisits, 1);
    assert.equal(body.trafficSummary.blockEvents, 1);
    assert.equal(body.trafficSummary.totalEvents, 3);
    assert.equal(body.trafficEvents.some((event) => event.event === "security_denied" && event.result === "blocked"), true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
