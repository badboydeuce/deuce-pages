import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("portal exposes account-level and per-page Telegram notification controls", async () => {
  const [html, script, styles] = await Promise.all([
    fs.readFile(new URL("../../index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../../script.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../../styles.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /data-route="#notifications"/);
  assert.match(script, /function renderTelegramSettings\(/);
  assert.match(script, /data-user-config="telegramNotifyOnResult"/);
  assert.match(script, /data-telegram-connect/);
  assert.match(script, /data-telegram-test/);
  assert.match(script, /data-telegram-disconnect/);
  assert.match(script, /Telegram receives only a notification and a link back to DEUCE/);
  assert.match(styles, /\.telegram-settings-view/);
  assert.match(styles, /\.telegram-page-toggle/);
});
