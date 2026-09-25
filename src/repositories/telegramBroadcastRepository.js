import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/pool.js";
import { readJsonDb, updateJsonDb, useJsonDb } from "../data/jsonStore.js";

const maxAttempts = 6;
const id = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
const clean = (value, limit) => String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, limit);
const cleanMessage = (value, limit) => String(value || "")
  .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
  .replace(/\r\n?/g, "\n")
  .replace(/\n{4,}/g, "\n\n\n")
  .trim()
  .slice(0, limit);

function publicBroadcast(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    buttonLabel: row.button_label ?? row.buttonLabel ?? "",
    buttonUrl: row.button_url ?? row.buttonUrl ?? "",
    silent: row.silent === true,
    status: row.status,
    totalRecipients: Number(row.total_recipients ?? row.totalRecipients ?? 0),
    sentCount: Number(row.sent_count ?? row.sentCount ?? 0),
    failedCount: Number(row.failed_count ?? row.failedCount ?? 0),
    createdAt: row.created_at ?? row.createdAt,
    queuedAt: row.queued_at ?? row.queuedAt ?? null,
    completedAt: row.completed_at ?? row.completedAt ?? null
  };
}

export function normalizeBroadcastInput(input = {}) {
  const title = clean(input.title, 120);
  const message = cleanMessage(input.message, 4000);
  const buttonLabel = clean(input.buttonLabel, 64);
  const buttonUrl = clean(input.buttonUrl, 500);
  if (!title) throw Object.assign(new Error("Broadcast title is required"), { status: 400 });
  if (!message) throw Object.assign(new Error("Broadcast message is required"), { status: 400 });
  if (buttonUrl) {
    let parsed;
    try { parsed = new URL(buttonUrl); } catch { throw Object.assign(new Error("Button URL must be a valid HTTPS URL"), { status: 400 }); }
    if (parsed.protocol !== "https:") throw Object.assign(new Error("Button URL must use HTTPS"), { status: 400 });
    if (!buttonLabel) throw Object.assign(new Error("Button label is required when a URL is provided"), { status: 400 });
  }
  return { title, message, buttonLabel, buttonUrl, silent: input.silent === true };
}

export async function countTelegramBroadcastRecipients() {
  if (useJsonDb()) {
    const db = await readJsonDb();
    return (db.telegramConnections || []).filter((item) => item.status === "active" && item.broadcastOptIn === true).length;
  }
  const result = await query("SELECT count(*)::int AS count FROM telegram_connections WHERE status = 'active' AND broadcast_opt_in = true");
  return Number(result.rows[0]?.count || 0);
}

export async function createTelegramBroadcast(actorUserId, input = {}) {
  const data = normalizeBroadcastInput(input);
  const now = new Date().toISOString();
  const record = { id: id("tgbroadcast"), createdBy: actorUserId, ...data, status: "draft", totalRecipients: 0, sentCount: 0, failedCount: 0, createdAt: now, queuedAt: null, completedAt: null };
  if (useJsonDb()) {
    await updateJsonDb((db) => { db.telegramBroadcasts ||= []; db.telegramBroadcasts.push(record); return record; });
    return record;
  }
  const result = await query(
    `INSERT INTO telegram_broadcasts (id, created_by, title, message, button_label, button_url, silent)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [record.id, actorUserId, data.title, data.message, data.buttonLabel || null, data.buttonUrl || null, data.silent]
  );
  return publicBroadcast(result.rows[0]);
}

export async function listTelegramBroadcasts(limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  if (useJsonDb()) {
    const db = await readJsonDb();
    return (db.telegramBroadcasts || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, safeLimit).map(publicBroadcast);
  }
  const result = await query("SELECT * FROM telegram_broadcasts ORDER BY created_at DESC LIMIT $1", [safeLimit]);
  return result.rows.map(publicBroadcast);
}

export async function getTelegramBroadcast(broadcastId) {
  if (useJsonDb()) {
    const db = await readJsonDb();
    return publicBroadcast((db.telegramBroadcasts || []).find((item) => item.id === broadcastId));
  }
  const result = await query("SELECT * FROM telegram_broadcasts WHERE id = $1", [broadcastId]);
  return publicBroadcast(result.rows[0]);
}

export async function queueTelegramBroadcast(broadcastId) {
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const broadcast = (db.telegramBroadcasts || []).find((item) => item.id === broadcastId);
      if (!broadcast) throw Object.assign(new Error("Broadcast not found"), { status: 404 });
      if (broadcast.status !== "draft") throw Object.assign(new Error("Only draft broadcasts can be sent"), { status: 409 });
      const recipients = (db.telegramConnections || []).filter((item) => item.status === "active" && item.broadcastOptIn === true);
      const now = new Date().toISOString();
      db.telegramBroadcastDeliveries ||= [];
      recipients.forEach((connection) => db.telegramBroadcastDeliveries.push({ id: id("tgbdelivery"), broadcastId, userId: connection.userId, chatId: connection.chatId, status: "pending", attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now }));
      broadcast.status = recipients.length ? "queued" : "completed";
      broadcast.totalRecipients = recipients.length;
      broadcast.queuedAt = now;
      broadcast.completedAt = recipients.length ? null : now;
      return publicBroadcast(broadcast);
    });
  }
  return withTransaction(async (client) => {
    const current = await client.query("SELECT * FROM telegram_broadcasts WHERE id = $1 FOR UPDATE", [broadcastId]);
    if (!current.rows[0]) throw Object.assign(new Error("Broadcast not found"), { status: 404 });
    if (current.rows[0].status !== "draft") throw Object.assign(new Error("Only draft broadcasts can be sent"), { status: 409 });
    await client.query(
      `INSERT INTO telegram_broadcast_deliveries (id, broadcast_id, user_id, chat_id)
       SELECT 'tgbdelivery_' || substr(md5(random()::text || connection.user_id || $1), 1, 18), $1, connection.user_id, connection.chat_id
       FROM telegram_connections connection
       WHERE connection.status = 'active' AND connection.broadcast_opt_in = true
       ON CONFLICT (broadcast_id, user_id) DO NOTHING`, [broadcastId]
    );
    const updated = await client.query(
      `UPDATE telegram_broadcasts SET total_recipients = (SELECT count(*) FROM telegram_broadcast_deliveries WHERE broadcast_id = $1),
       status = CASE WHEN EXISTS (SELECT 1 FROM telegram_broadcast_deliveries WHERE broadcast_id = $1) THEN 'queued' ELSE 'completed' END,
       queued_at = now(), completed_at = CASE WHEN EXISTS (SELECT 1 FROM telegram_broadcast_deliveries WHERE broadcast_id = $1) THEN NULL ELSE now() END
       WHERE id = $1 RETURNING *`, [broadcastId]
    );
    return publicBroadcast(updated.rows[0]);
  });
}

export async function claimTelegramBroadcastDeliveries(limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  if (useJsonDb()) {
    return updateJsonDb((db) => {
      const now = Date.now();
      const broadcasts = new Map((db.telegramBroadcasts || []).map((item) => [item.id, item]));
      return (db.telegramBroadcastDeliveries || []).filter((item) => ["pending", "retry"].includes(item.status) && new Date(item.nextAttemptAt || 0).getTime() <= now).slice(0, safeLimit).map((item) => {
        item.status = "sending"; item.attempts = Number(item.attempts || 0) + 1; item.updatedAt = new Date().toISOString();
        return { ...item, broadcast: publicBroadcast(broadcasts.get(item.broadcastId)) };
      });
    });
  }
  const result = await query(
    `WITH candidates AS (SELECT id FROM telegram_broadcast_deliveries WHERE status IN ('pending','retry') AND next_attempt_at <= now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1),
     claimed AS (UPDATE telegram_broadcast_deliveries d SET status='sending', attempts=d.attempts+1, updated_at=now() FROM candidates c WHERE d.id=c.id RETURNING d.*)
     SELECT claimed.*, row_to_json(broadcast.*) AS broadcast FROM claimed JOIN telegram_broadcasts broadcast ON broadcast.id=claimed.broadcast_id ORDER BY claimed.created_at`, [safeLimit]
  );
  return result.rows.map((row) => ({ id: row.id, broadcastId: row.broadcast_id, userId: row.user_id, chatId: row.chat_id, attempts: Number(row.attempts || 0), broadcast: publicBroadcast(row.broadcast) }));
}

export async function completeTelegramBroadcastDelivery(deliveryId, messageId = "") {
  if (useJsonDb()) return updateJsonDb((db) => updateJsonDelivery(db, deliveryId, true, { messageId }));
  return withTransaction(async (client) => {
    const result = await client.query("UPDATE telegram_broadcast_deliveries SET status='sent', telegram_message_id=$2, sent_at=now(), updated_at=now() WHERE id=$1 RETURNING broadcast_id", [deliveryId, String(messageId || "")]);
    if (result.rows[0]) await refreshCounts(client, result.rows[0].broadcast_id);
    return result.rows[0] || null;
  });
}

function updateJsonDelivery(db, deliveryId, sent, error = {}) {
  const delivery = (db.telegramBroadcastDeliveries || []).find((item) => item.id === deliveryId);
  if (!delivery) return null;
  const now = new Date().toISOString();
  delivery.status = sent ? "sent" : error.retry ? "retry" : "failed";
  delivery.sentAt = sent ? now : null;
  delivery.telegramMessageId = sent ? String(error.messageId || "") : "";
  delivery.errorCode = error.errorCode || "";
  delivery.lastError = error.message || "";
  if (error.retry) delivery.nextAttemptAt = new Date(Date.now() + Number(error.retryAfterSeconds || 30) * 1000).toISOString();
  delivery.updatedAt = now;
  const broadcast = (db.telegramBroadcasts || []).find((item) => item.id === delivery.broadcastId);
  if (broadcast) {
    const all = (db.telegramBroadcastDeliveries || []).filter((item) => item.broadcastId === broadcast.id);
    broadcast.sentCount = all.filter((item) => item.status === "sent").length;
    broadcast.failedCount = all.filter((item) => item.status === "failed").length;
    if (all.every((item) => ["sent", "failed", "cancelled"].includes(item.status))) { broadcast.status = "completed"; broadcast.completedAt = now; }
    else broadcast.status = "sending";
  }
  return delivery;
}

async function refreshCounts(client, broadcastId) {
  await client.query(
    `UPDATE telegram_broadcasts b SET sent_count=s.sent, failed_count=s.failed,
     status=CASE WHEN s.remaining=0 THEN 'completed' ELSE 'sending' END,
     completed_at=CASE WHEN s.remaining=0 THEN now() ELSE NULL END
     FROM (SELECT count(*) FILTER (WHERE status='sent')::int sent, count(*) FILTER (WHERE status='failed')::int failed, count(*) FILTER (WHERE status IN ('pending','retry','sending'))::int remaining FROM telegram_broadcast_deliveries WHERE broadcast_id=$1) s
     WHERE b.id=$1`, [broadcastId]
  );
}

export async function failTelegramBroadcastDelivery(delivery, failure = {}) {
  const retry = failure.retryable === true && Number(delivery.attempts || 1) < maxAttempts && failure.blocked !== true;
  const retryAfterSeconds = Math.max(Number(failure.retryAfterSeconds || 0), Math.min(900, 5 * (2 ** Math.max(Number(delivery.attempts || 1) - 1, 0))));
  const error = { retry, retryAfterSeconds, errorCode: clean(failure.errorCode || "TELEGRAM_SEND_FAILED", 80), message: clean(failure.message, 300) };
  if (useJsonDb()) return updateJsonDb((db) => {
    if (failure.blocked) {
      const connection = (db.telegramConnections || []).find((item) => item.userId === delivery.userId);
      if (connection) {
        connection.status = "blocked";
        connection.disconnectedAt = new Date().toISOString();
        connection.updatedAt = connection.disconnectedAt;
      }
    }
    return updateJsonDelivery(db, delivery.id, false, error);
  });
  return withTransaction(async (client) => {
    const result = await client.query(`UPDATE telegram_broadcast_deliveries SET status=$2, next_attempt_at=CASE WHEN $2='retry' THEN now()+($3||' seconds')::interval ELSE next_attempt_at END, error_code=$4, last_error=$5, updated_at=now() WHERE id=$1 RETURNING broadcast_id`, [delivery.id, retry ? "retry" : "failed", retryAfterSeconds, error.errorCode, error.message]);
    if (failure.blocked) await client.query("UPDATE telegram_connections SET status='blocked', disconnected_at=now(), updated_at=now() WHERE user_id=$1", [delivery.userId]);
    if (result.rows[0]) await refreshCounts(client, result.rows[0].broadcast_id);
    return result.rows[0] || null;
  });
}
