import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Telegram broadcasts fan out only to opted-in active connections", async () => {
  const previous = Object.fromEntries(["NODE_ENV", "LOCAL_JSON_DB", "JSON_DB_PATH", "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET", "PUBLIC_BASE_URL"].map((key) => [key, process.env[key]]));
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-broadcast-"));
  const dbPath = path.join(tempRoot, "db.json");
  const now = new Date().toISOString();
  process.env.NODE_ENV = "test";
  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST";
  process.env.TELEGRAM_BOT_USERNAME = "DPanelBot";
  process.env.TELEGRAM_WEBHOOK_SECRET = "telegram_webhook_secret_123";
  process.env.PUBLIC_BASE_URL = "https://dpanel.live";
  await fs.writeFile(dbPath, JSON.stringify({
    users: [{ id: "admin", role: "admin" }, { id: "opted", role: "subscriber" }, { id: "not_opted", role: "subscriber" }],
    telegramConnections: [
      { userId: "opted", chatId: "101", status: "active", broadcastOptIn: true },
      { userId: "not_opted", chatId: "102", status: "active", broadcastOptIn: false }
    ],
    telegramBroadcasts: [],
    telegramBroadcastDeliveries: []
  }));

  try {
    const repository = await import(`../repositories/telegramBroadcastRepository.js?broadcast-test=${Date.now()}`);
    const service = await import(`./telegram.js?broadcast-test=${Date.now()}`);
    assert.throws(() => repository.normalizeBroadcastInput({ title: "Bad", message: "Message", buttonLabel: "Open", buttonUrl: "http://example.com" }), /HTTPS/);
    const draft = await repository.createTelegramBroadcast("admin", { title: "Maintenance", message: "DPanel maintenance begins at 22:00 UTC.", buttonLabel: "Open DPanel", buttonUrl: "https://dpanel.live/portal" });
    const queued = await repository.queueTelegramBroadcast(draft.id);
    assert.equal(queued.totalRecipients, 1);
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const result = await service.dispatchTelegramBroadcastsOnce({ fetchImpl });
    assert.deepEqual(result, { claimed: 1, sent: 1, failed: 0 });
    assert.equal(requests[0].body.chat_id, "101");
    assert.equal(requests[0].body.text, "DPanel maintenance begins at 22:00 UTC.");
    assert.equal(requests[0].body.reply_markup.inline_keyboard[0][0].url, "https://dpanel.live/portal");
    const stored = JSON.parse(await fs.readFile(dbPath, "utf8"));
    assert.equal(stored.telegramBroadcasts[0].status, "completed");
    assert.equal(stored.telegramBroadcasts[0].sentCount, 1);
    assert.equal(stored.telegramBroadcastDeliveries.length, 1);
    assert.equal(stored.telegramBroadcastDeliveries[0].telegramMessageId, "77");
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
