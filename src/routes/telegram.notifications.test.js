import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

test("Telegram connects securely and sends payload-free per-page result notifications", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH,
    APP_BASE_URL: process.env.APP_BASE_URL,
    PORTAL_BASE_URL: process.env.PORTAL_BASE_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET
  };
  const nativeFetch = globalThis.fetch;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-telegram-"));
  const dbPath = path.join(tempRoot, "db.json");
  const authToken = "telegram-owner-session";
  const now = new Date().toISOString();
  const telegramRequests = [];

  process.env.NODE_ENV = "test";
  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  process.env.APP_BASE_URL = "https://d-panel.onrender.com";
  process.env.PORTAL_BASE_URL = "https://d-panel.onrender.com";
  process.env.PUBLIC_BASE_URL = "https://d-panel.onrender.com";
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_BOT_TOKEN";
  process.env.TELEGRAM_BOT_USERNAME = "DeuceResultsBot";
  process.env.TELEGRAM_WEBHOOK_SECRET = "deuce_telegram_webhook_secret_12345";

  await fs.writeFile(dbPath, JSON.stringify({
    users: [{ id: "user_telegram", name: "Telegram Owner", email: "telegram@example.com", role: "subscriber", status: "active", walletBalance: 0, collaboration: {}, createdAt: now, updatedAt: now }],
    sessions: [{ id: "session_telegram", userId: "user_telegram", tokenHash: createHash("sha256").update(authToken).digest("hex"), expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now }],
    userPages: [{
      id: "user_page_telegram",
      userId: "user_telegram",
      packageId: "pkg_telegram",
      packageVersion: "v1",
      name: "Banner Live",
      slug: "banner-live",
      domain: "",
      status: "active",
      subscription: { billingPeriod: "weekly", renewalDate: "2099-01-01" },
      flow: [],
      configs: {},
      securityConfig: { captcha: false, vpnProxyRules: {} },
      hostingConfig: {},
      resultSettings: { retentionDays: 30, notifyOnResult: false, telegramNotifyOnResult: false },
      generatedFile: {},
      uiPreferences: {},
      createdAt: now,
      updatedAt: now
    }]
  }));

  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://api.telegram.org/")) {
      telegramRequests.push({ url: String(url), body: JSON.parse(options.body || "{}") });
      return new Response(JSON.stringify({ ok: true, result: { message_id: telegramRequests.length } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return nativeFetch(url, options);
  };

  const { createApp } = await import(`../app.js?telegram-route-test=${Date.now()}`);
  const { dispatchTelegramDeliveriesOnce } = await import(`../services/telegram.js?telegram-dispatch-test=${Date.now()}`);
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const initialStatus = await nativeFetch(`${baseUrl}/api/telegram/status`, { headers: authHeaders(authToken) });
    assert.equal(initialStatus.status, 200);
    assert.deepEqual(await initialStatus.json(), {
      configured: true,
      botUsername: "DeuceResultsBot",
      webhookConfigured: true,
      connected: false,
      connection: null
    });

    const linkResponse = await nativeFetch(`${baseUrl}/api/telegram/link`, {
      method: "POST",
      headers: authHeaders(authToken),
      body: "{}"
    });
    assert.equal(linkResponse.status, 201);
    const link = await linkResponse.json();
    const linkUrl = new URL(link.linkUrl);
    assert.equal(linkUrl.hostname, "t.me");
    assert.equal(linkUrl.pathname, "/DeuceResultsBot");
    const connectionToken = linkUrl.searchParams.get("start");
    assert.match(connectionToken, /^[A-Za-z0-9_-]{1,64}$/);

    const rejectedWebhook = await nativeFetch(`${baseUrl}/api/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "wrong-secret-value" },
      body: JSON.stringify({ update_id: 1 })
    });
    assert.equal(rejectedWebhook.status, 401);

    const linkedWebhook = await nativeFetch(`${baseUrl}/api/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": process.env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        update_id: 778899,
        message: {
          text: `/start ${connectionToken}`,
          chat: { id: 90807060, type: "private" },
          from: { id: 90807060, is_bot: false, username: "deuceowner", first_name: "Deuce" }
        }
      })
    });
    assert.equal(linkedWebhook.status, 200);
    assert.equal((await linkedWebhook.json()).linked, true);
    assert.equal(telegramRequests.length, 1);
    assert.match(telegramRequests[0].body.text, /notifications are connected/i);

    const connectedStatus = await nativeFetch(`${baseUrl}/api/telegram/status`, { headers: authHeaders(authToken) });
    const connected = await connectedStatus.json();
    assert.equal(connected.connected, true);
    assert.equal(connected.connection.username, "deuceowner");
    assert.equal("chatId" in connected.connection, false);
    assert.equal("telegramUserId" in connected.connection, false);

    const enablePage = await nativeFetch(`${baseUrl}/api/user-pages/user_page_telegram/config`, {
      method: "PATCH",
      headers: authHeaders(authToken),
      body: JSON.stringify({ resultSettings: { notifyOnResult: false, telegramNotifyOnResult: true } })
    });
    assert.equal(enablePage.status, 200);

    const resultResponse = await nativeFetch(`${baseUrl}/api/page-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userPageId: "user_page_telegram",
        pageId: "banner-live",
        sessionId: "private-session-123",
        screen: "Login",
        data: { Password: "never-send-this", Email: "private@example.com" }
      })
    });
    assert.equal(resultResponse.status, 201);

    const dispatch = await dispatchTelegramDeliveriesOnce({ fetchImpl: globalThis.fetch });
    assert.deepEqual(dispatch, { claimed: 1, sent: 1, failed: 0 });
    assert.equal(telegramRequests.length, 2);
    const resultAlert = telegramRequests[1].body;
    assert.match(resultAlert.text, /New result received/);
    assert.match(resultAlert.text, /Page: Banner Live/);
    assert.equal(resultAlert.reply_markup.inline_keyboard[0][0].url, "https://d-panel.onrender.com/portal#results-user_page_telegram");
    const serializedAlert = JSON.stringify(resultAlert);
    assert.doesNotMatch(serializedAlert, /never-send-this|private@example\.com|private-session-123|Password|Email/i);

    const inAppNotifications = await nativeFetch(`${baseUrl}/api/notifications`, { headers: authHeaders(authToken) });
    const inAppBody = await inAppNotifications.json();
    assert.equal(inAppBody.notifications.length, 0);
    assert.equal(inAppBody.unreadCount, 0);

    const testMessage = await nativeFetch(`${baseUrl}/api/telegram/test`, { method: "POST", headers: authHeaders(authToken), body: "{}" });
    assert.equal(testMessage.status, 200);
    const repeatedTest = await nativeFetch(`${baseUrl}/api/telegram/test`, { method: "POST", headers: authHeaders(authToken), body: "{}" });
    assert.equal(repeatedTest.status, 429);

    const disconnect = await nativeFetch(`${baseUrl}/api/telegram/connection`, { method: "DELETE", headers: authHeaders(authToken) });
    assert.equal(disconnect.status, 200);
    assert.equal((await disconnect.json()).connected, false);

    const stored = JSON.parse(await fs.readFile(dbPath, "utf8"));
    assert.equal(stored.telegramConnections[0].status, "disconnected");
    assert.equal(stored.telegramNotificationDeliveries[0].status, "sent");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = nativeFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
